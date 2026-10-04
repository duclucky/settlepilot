import { createHash, randomUUID } from 'node:crypto';
import { allocateReceipt } from './receipt-matching.ts';
import { z } from 'zod';
import { isPending, isBridgePending, OVERRIDABLE_POLICY_REASONS, type State } from './domain.ts';
import type { ActionRequest } from './autonomy-types.ts';
import { Store, event } from './store.ts';
import { enqueue } from './scheduler-core.ts';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
import { actionBinding } from './action-binding.ts';
export { actionBinding } from './action-binding.ts';
export function syncActionRequests(store:Store,now=Date.now()) {
  store.change(s=>{
    const a=s.autonomy!;
    const unknownReviews=new Set<string>();
    for(const r of a.requests.filter(r=>r.status==='OPEN')) {
      if(r.legacyId===`unknown:${r.scope}`){
        if(unknownReviews.has(r.legacyId)){r.status='SUPERSEDED';continue;}
        unknownReviews.add(r.legacyId);
      }
      if(r.legacyId===`unknown:${r.scope}`&&![...s.intents,...s.bridgeIntents].some(i=>i.id===r.scope&&['EXECUTION_UNKNOWN','DISPATCH_UNKNOWN'].includes(i.status))){r.status='SUPERSEDED';}
      else if(r.expiresAt<=now){r.status='EXPIRED';for(const old of s.evidenceRequests.filter(old=>old.id===r.legacyId&&old.status==='OPEN'))old.status='EXPIRED';enqueue(s,'REQUEST_EXPIRED',`request-expiry:${r.id}`,now);}
      else if(r.binding!==actionBinding(s,r.scope)){
        if(r.kind==='OPERATION'&&r.legacyId===`unknown:${r.scope}`){
          // New receipt evidence updates a comment-only review in place. An old
          // digest still fails; this never grants approval or permits resending.
          r.binding=actionBinding(s,r.scope);r.digest=hash([r.id,r.action,r.binding]);
        }else r.status='SUPERSEDED';
      }
      if(r.status!=='OPEN'){
        for(const old of s.evidenceRequests.filter(x=>x.id===r.legacyId&&x.status==='OPEN'))old.status=r.status==='EXPIRED'?'EXPIRED':'CANCELLED';
        for(const old of s.agentNotifications.filter(x=>x.id===r.legacyId&&x.status==='OPEN')){old.status='RESOLVED';old.resolvedAt=new Date(now).toISOString();}
      }
    }
    const add=(legacyId:string,kind:ActionRequest['kind'],scope:string,question:string,reason?:string,expiry=now+86400000)=>{
      const binding=actionBinding(s,scope);
      if(a.requests.some(r=>r.legacyId===legacyId&&r.binding===binding&&r.status!=='EXPIRED')||a.rejectionBindings.some(d=>d.obligationId===scope&&d.binding===binding))return;
      const o=s.obligations.find(o=>o.id===scope);
      const action={obligationId:o?.id,amount:o?.amount,recipient:o?.recipient,reason};
      const id=randomUUID();
      a.requests.push({id,legacyId,kind,scope,title:o?.contractor??'Operational review',question,action,digest:hash([id,action,binding]),binding,policyVersion:s.policy.version,obligationVersion:o?.version,expiresAt:expiry,status:'OPEN',createdAt:now});
    };
    for(const r of s.evidenceRequests.filter(r=>r.status==='OPEN')) add(r.id,'ACCEPTANCE',r.obligationId,r.question,undefined,Date.parse(r.expiresAt));
    for(const n of s.agentNotifications.filter(n=>n.status==='OPEN'&&n.type==='USER_DECISION_REQUIRED'&&n.issues.length===1)) {
      // A proposal bound to an old state cannot remain actionable in the panel
      // or Telegram, even if no ActionRequest was created before the state changed.
      const issue=n.issues[0];const o=s.obligations.find(o=>o.id===issue.obligationId);
      if(!o||o.paid||o.archived||o.version!==n.obligationVersion||s.policy.version!==n.policyVersion||s.financialVersion!==n.stateVersion){
        n.status='RESOLVED';n.resolvedAt=new Date(now).toISOString();
        event(s,'OWNER_PROPOSAL_SUPERSEDED',n.id);
        if(o&&!o.paid&&!o.archived)enqueue(s,'OWNER_PROPOSAL_SUPERSEDED',`proposal-recheck:${n.id}`,now);
        continue;
      }
      add(n.id,OVERRIDABLE_POLICY_REASONS.some(reason=>reason===issue.reason)?'POLICY':'OPERATION',issue.obligationId,n.question??n.message,issue.reason,Date.parse(n.createdAt)+86400000);
    }
    for(const n of s.agentNotifications.filter(n=>n.status==='OPEN'&&n.type==='POLICY_ESCALATION'))for(const issue of n.issues)add(n.id,'OPERATION',issue.obligationId,'The Agent could not find an authorized alternative. Add instructions in Comment.',issue.reason);
    for(const job of a.jobs.filter(j=>j.status==='NEEDS_ATTENTION'))add(`job:${job.id}`,'OPERATION',job.id,'The Agent could not complete its evaluation. Check connections and add instructions in Comment.');
    for(const intent of [...s.intents,...s.bridgeIntents].filter(i=>['EXECUTION_UNKNOWN','DISPATCH_UNKNOWN'].includes(i.status)))add(`unknown:${intent.id}`,'OPERATION',intent.id,'A transaction outcome is unknown. Reconciliation continues; approval cannot resend it.');
    if(a.observationPaused)add('chain-review','OPERATION','chain-review','Chain history changed. Execution is paused until the source is reviewed.');
    for(const r of a.records.filter(r=>{
      const party=a.parties.find(p=>p.id===r.partyId);
      return !r.retired&&(r.amendment||!r.active||!party||(r.kind==='OBLIGATION'&&!s.policy.allowlist.includes(party.address)));
    })) add(`source:${r.sourceId}:${r.externalId}:${r.revision}`,'OPERATION',`${r.sourceId}:${r.externalId}`,'The source record needs clarification before it can be used. Add context in Comment.');
  });
}
export const OwnerResponseInput=z.object({responseId:z.string().uuid(),kind:z.enum(['APPROVE','CANCEL','COMMENT']),digest:z.string().regex(/^[a-f0-9]{64}$/),comment:z.string().trim().max(1200).default('')}).strict();
export function respondToAction(store:Store,requestId:string,raw:unknown,actor='owner',now=Date.now()) {
  const input=OwnerResponseInput.parse(raw);
  if(actor!=='owner')throw new Error('OWNER_AUTHORITY_REQUIRED');
  if(input.kind==='COMMENT'&&!input.comment)throw new Error('COMMENT_REQUIRED');
  const result=store.change(s=>{
    const a=s.autonomy!;
    const previous=a.responses.find(r=>r.id===input.responseId);
    if(previous){if(previous.requestId!==requestId||previous.kind!==input.kind||previous.digest!==input.digest||previous.comment!==input.comment)throw new Error('RESPONSE_ID_REUSED');return {responseId:previous.id,jobId:a.jobs.find(j=>j.key===`owner:${input.responseId}`)?.id};}
    const r=a.requests.find(r=>r.id===requestId);
    if(!r||r.status!=='OPEN')throw new Error('ACTION_REQUEST_NOT_OPEN');
    if(r.expiresAt<=now){r.status='EXPIRED';return {error:'ACTION_REQUEST_EXPIRED'};}
    if(r.binding!==actionBinding(s,r.scope)){r.status='SUPERSEDED';return {error:'ACTION_REQUEST_STALE'};}
    if(r.digest!==input.digest)return {error:'ACTION_REQUEST_STALE'};
    if(input.kind!=='COMMENT'&&(s.intents.some(isPending)||s.bridgeIntents.some(isBridgePending)))throw new Error('RECONCILE_REQUIRED');
    if(input.kind==='APPROVE') {
      if(r.kind==='POLICY') {
        const n=s.agentNotifications.find(n=>n.id===r.legacyId&&n.status==='OPEN');
        const o=s.obligations.find(o=>o.id===r.action.obligationId&&!o.paid&&!o.archived);
        if(!n||!o||n.stateVersion!==s.financialVersion)throw new Error('ACTION_REQUEST_STALE');
        const reasons=['NEEDS_APPROVAL','BUDGET_EXCEEDED','OUTSIDE_PLANNING_WINDOW','RESERVE_CONFLICT'] as const;
        const reason=reasons.find(reason=>reason===r.action.reason);if(!reason)throw new Error('POLICY_OVERRIDE_NOT_ALLOWED');
        s.approvals.push({id:randomUUID(),obligationId:o.id,obligationVersion:o.version,policyVersion:s.policy.version,stateVersion:s.financialVersion,expiresAt:new Date(now+5*60000).toISOString(),actor,reason});
        n.status='RESOLVED';n.resolution='APPROVE_ONCE';n.response=input.comment;n.resolvedAt=new Date(now).toISOString();
      } else if(r.kind==='MATCH') {
        if(!r.action.transferId||!r.action.sourceRecordKey)throw new Error('RECEIPT_MATCH_INVALID');
        allocateReceipt(s,r.action.transferId,r.action.sourceRecordKey,r.action.amount);
      } else if(r.kind==='ACCEPTANCE') {
        const o=s.obligations.find(o=>o.id===r.action.obligationId&&!o.paid&&!o.archived);if(!o)throw new Error('OBLIGATION_NOT_OPEN');
        o.accepted=true;o.disputed=false;o.version++;
        for(const old of s.evidenceRequests.filter(old=>old.obligationId===o.id&&old.status==='OPEN')){old.status='RESOLVED';old.resolution='ACCEPTED';old.response=input.comment;old.resolvedAt=new Date(now).toISOString();}
      } else throw new Error('COMMENT_REQUIRED_FOR_OPERATIONAL_REVIEW');
      r.status='APPROVED';
    } else if(input.kind==='CANCEL') {
      r.status='REJECTED';a.rejectionBindings.push({obligationId:r.scope,binding:r.binding});
      for(const old of s.evidenceRequests.filter(old=>old.id===r.legacyId))old.status='CANCELLED';
      for(const old of s.agentNotifications.filter(old=>old.id===r.legacyId)){old.status='RESOLVED';old.resolution='KEEP_POLICY';old.response=input.comment;old.resolvedAt=new Date(now).toISOString();}
    } else {
      r.status='SUPERSEDED';
      for(const old of s.evidenceRequests.filter(old=>old.id===r.legacyId&&old.status==='OPEN'))old.status='CANCELLED';
      for(const old of s.agentNotifications.filter(old=>old.id===r.legacyId&&old.status==='OPEN')){old.status='RESOLVED';old.response=input.comment;old.resolvedAt=new Date(now).toISOString();}
    }
    a.responses.push({id:input.responseId,requestId,digest:r.digest,kind:input.kind,comment:input.comment,actor,at:now});
    if(a.responses.length>1000)throw new Error('OWNER_RESPONSE_LIMIT');
    const jobId=enqueue(s,'OWNER_RESPONDED',`owner:${input.responseId}`,now);
    event(s,'OWNER_RESPONSE_RECORDED',`${r.kind}: ${input.kind}`);
    return {responseId:input.responseId,jobId};
  });
  if('error' in result)throw new Error(result.error);
  return result;
}
