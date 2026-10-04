import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { actionBinding } from './action-binding.ts';
import { enqueue } from './scheduler-core.ts';
import { Store, event } from './store.ts';
import { recoveryContext, recoveryKey } from './autonomy-recovery.ts';
import { planningEligibility } from './policy.ts';
import type { AgentUserDecisionRequest } from './agent-escalation.ts';
import type { WaitCondition } from './autonomy-types.ts';
import type { ReviewObservation } from './planning-types.ts';
import { recordGoalPlan, refreshGoalPlans } from './goal-plans.ts';
import { reviewCaseBinding } from './review-binding.ts';

const SkillName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const MemoryInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), kind: z.enum(['FACT', 'LESSON']), content: z.string().trim().min(1).max(600) }).strict(),
  z.object({ action: z.literal('replace'), entryId: z.string().uuid(), kind: z.enum(['FACT', 'LESSON']), content: z.string().trim().min(1).max(600) }).strict(),
  z.object({ action: z.literal('remove'), entryId: z.string().uuid() }).strict(),
]);
const secretLike = /(private[_ -]?key|mnemonic|seed phrase|recovery phrase|api[_ -]?key|entity[_ -]?secret|sk-[A-Za-z0-9_-]{16,})/i;

export interface SkillIndexEntry { name: string; description: string }

function frontmatter(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('INVALID_SKILL_FRONTMATTER');
  const fields = Object.fromEntries(match[1].split(/\r?\n/).map(line => {
    const index = line.indexOf(':');
    return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : ['', ''];
  }).filter(([key]) => key));
  return { fields, body: text.slice(match[0].length).trim() };
}

export class AgentWorkspace {
  readonly root: string;
  constructor(private readonly store?: Store, root = resolve('agent')) { this.root = root; }
  get memoryEnabled() { return !!this.store; }
  planningContext() {
    if(!this.store)return {plans:[],reviews:[]};
    return this.store.change(s=>{
      refreshGoalPlans(s);const plans=s.autonomy!.plans??[];
      return {plans:structuredClone([...plans.filter(p=>!['SUPERSEDED','COMPLETED'].includes(p.status)),...plans.filter(p=>['SUPERSEDED','COMPLETED'].includes(p.status)).slice(-5)]),reviews:structuredClone((s.autonomy!.reviews??[]).slice(-30))};
    });
  }
  recordPlan(raw:unknown) {
    if(!this.store)throw new Error('PLAN_STORAGE_UNAVAILABLE');
    if(secretLike.test(JSON.stringify(raw)))throw new Error('SECRET_LIKE_PLAN_REJECTED');
    return this.store.change(s=>recordGoalPlan(s,raw));
  }
  lookupReview(fingerprint:string,caseBinding:string) {
    const observations=this.store?.read().autonomy?.reviews??[];
    return observations.find(r=>r.caseBinding===caseBinding&&r.review.verdict==='BLOCK')??observations.find(r=>r.caseBinding===caseBinding&&r.fingerprint===fingerprint);
  }
  unresolvedReview(obligationId:string,caseBinding:string){
    const records=(this.store?.read().autonomy?.reviews??[]).filter(r=>r.obligationId===obligationId&&r.caseBinding===caseBinding);
    const record=records.find(r=>r.review.verdict==='BLOCK')??records.at(-1);
    return record&&(record.review.verdict!=='ALLOW'||record.review.confidence<(record.minimumConfidence??0.8))?record:undefined;
  }
  recordReview(observation:ReviewObservation) {
    if(!this.store)return;
    this.store.change(s=>{
      const reviews=s.autonomy!.reviews??=[];
      if(reviews.some(r=>r.fingerprint===observation.fingerprint&&r.caseBinding===observation.caseBinding))return;
      if(reviews.length>=1000){const removable=reviews.findIndex(r=>r.review.verdict!=='BLOCK'||!s.obligations.some(o=>o.id===r.obligationId&&!o.paid&&!o.archived&&reviewCaseBinding(s,o.id)===r.caseBinding));if(removable<0)throw new Error('REVIEW_STORAGE_LIMIT');reviews.splice(removable,1);}
      reviews.push(structuredClone(observation));event(s,'JEV_REVIEW_RECORDED',`${observation.obligationId}: ${observation.review.verdict}`);
    });
  }
  instructions() {
    const text = readFileSync(join(this.root, 'AGENTS.md'), 'utf8').trim();
    if (!text || text.length > 12_000) throw new Error('INVALID_AGENT_INSTRUCTIONS');
    return text;
  }
  policyConstitution() {
    const text = readFileSync(join(this.root, 'POLICY.md'), 'utf8').trim();
    if (!text || text.length > 12_000) throw new Error('INVALID_POLICY_CONSTITUTION');
    return text;
  }
  skills(): SkillIndexEntry[] {
    return readdirSync(join(this.root, 'skills'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && SkillName.safeParse(entry.name).success)
      .map(entry => {
        const parsed = frontmatter(readFileSync(join(this.root, 'skills', entry.name, 'SKILL.md'), 'utf8'));
        if (parsed.fields.name !== entry.name || !parsed.fields.description) throw new Error('INVALID_SKILL_METADATA');
        return { name: entry.name, description: parsed.fields.description };
      }).sort((a, b) => a.name.localeCompare(b.name));
  }
  readSkill(name: string) {
    const valid = SkillName.parse(name);
    if (!this.skills().some(skill => skill.name === valid)) throw new Error('UNKNOWN_SKILL');
    const text = readFileSync(join(this.root, 'skills', valid, 'SKILL.md'), 'utf8');
    if (text.length > 16_000) throw new Error('SKILL_TOO_LARGE');
    return text;
  }
  memorySnapshot() { return this.store?.read().agentMemory ?? []; }
  recordTool(runId: string | undefined, name: string, status: 'SUCCESS' | 'ERROR', detail: string) {
    if (!this.store || !runId) return;
    this.store.change(state => state.agentToolCalls.push({ id: randomUUID(), runId, name, status, detail: detail.slice(0, 240), at: new Date().toISOString() }));
  }
  memory(raw: unknown) {
    if (!this.store) throw new Error('MEMORY_UNAVAILABLE');
    const input = MemoryInput.parse(raw);
    if ('content' in input && secretLike.test(input.content)) throw new Error('SECRET_LIKE_MEMORY_REJECTED');
    return this.store.change(state => {
      const now = new Date().toISOString();
      if (input.action === 'add') state.agentMemory.push({ id: randomUUID(), kind: input.kind, content: input.content, createdAt: now, updatedAt: now });
      else {
        const index = state.agentMemory.findIndex(entry => entry.id === input.entryId);
        if (index < 0) throw new Error('MEMORY_ENTRY_NOT_FOUND');
        if (input.action === 'remove') state.agentMemory.splice(index, 1);
        else state.agentMemory[index] = { ...state.agentMemory[index], kind: input.kind, content: input.content, updatedAt: now };
      }
      if (state.agentMemory.reduce((total, entry) => total + entry.content.length, 0) > 4_000) throw new Error('MEMORY_LIMIT_EXCEEDED');
      return structuredClone(state.agentMemory);
    });
  }
  defer(obligationId:string,until:string,responseId:string) {
    if(!this.store)throw new Error('SCHEDULER_UNAVAILABLE');
    const due=Date.parse(until);if(!Number.isFinite(due)||due<=Date.now()||due>Date.now()+30*86400000)throw new Error('INVALID_DEFER_TIME');
    return this.store.change(s=>{
      const response=s.autonomy!.responses.find(r=>r.id===responseId&&r.kind==='COMMENT');
      const request=s.autonomy!.requests.find(r=>r.id===response?.requestId&&r.scope===obligationId);
      if(!response||!request||!s.obligations.some(o=>o.id===obligationId&&!o.paid&&!o.archived))throw new Error('OWNER_INSTRUCTION_REQUIRED');
      s.autonomy!.deferredUntil??={};s.autonomy!.deferredUntil[obligationId]=due;
      enqueue(s,'DEADLINE_OWNER_DEFER',`defer:${obligationId}:${responseId}:${due}`,due);return {deferredUntil:until};
    });
  }
  wait(obligationId:string,condition:WaitCondition,retryAfterSeconds:number,reason:string,now=Date.now()) {
    if(!this.store)throw new Error('SCHEDULER_UNAVAILABLE');
    if(!Number.isInteger(retryAfterSeconds)||retryAfterSeconds<5||retryAfterSeconds>900||!reason.trim()||reason.length>500)throw new Error('INVALID_WAIT');
    return this.store.change(s=>{
      const a=s.autonomy!,o=s.obligations.find(o=>o.id===obligationId&&!o.paid&&!o.archived);
      if(!o)throw new Error('UNKNOWN_CANDIDATE');
      const eligibility=planningEligibility(s,o,now);
      if(!['STALE_BALANCE','INSUFFICIENT_FUNDS','RESERVE_CONFLICT','FUNDING_REQUIRED','RECONCILE_REQUIRED'].includes(eligibility))throw new Error('WAIT_NOT_APPLICABLE');
      const context=recoveryContext(s,now);
      const supported=condition==='OBSERVATION_RECOVERY' ? context.arcObservationStale||context.unavailableSourceChains.length>0
        : condition==='EXPECTED_RECEIPT' ? context.expectedReceipts.length>0
        : condition==='OPERATION_RECONCILIATION' && context.pendingPayments.length+context.pendingBridges.length>0;
      if(!supported)throw new Error('WAIT_CONDITION_UNSUPPORTED');
      const contextKey=recoveryKey(s,now);a.waits??=[];
      const previous=a.waits.filter(w=>w.obligationId===obligationId).at(-1);
      if(previous?.contextKey===contextKey&&previous.dueAt>now&&a.jobs.some(j=>j.key===`recheck:${previous.id}`&&['READY','LEASED'].includes(j.status)))return {waitId:previous.id,recheckAt:new Date(previous.dueAt).toISOString(),attempt:previous.attempt};
      const attempt=previous?.contextKey===contextKey ? previous.attempt+1 : 1;
      if(attempt>5)throw new Error('WAIT_LIMIT_REACHED');
      let dueAt=now+retryAfterSeconds*1000;
      const deadline=Date.parse(o.due);if(deadline>now)dueAt=Math.min(dueAt,deadline);
      dueAt=Math.min(dueAt,Date.parse(s.policy.authorityExpiresAt));
      if(!Number.isFinite(dueAt)||dueAt<now+5000)throw new Error('WAIT_DEADLINE_IMMINENT');
      for(const old of a.waits.filter(w=>w.obligationId===obligationId))for(const j of a.jobs.filter(j=>j.key===`recheck:${old.id}`&&j.status==='READY')){j.status='DONE';j.error='WAIT_REPLACED';}
      const id=randomUUID();a.waits.push({id,obligationId,condition,reason,contextKey,attempt,createdAt:now,dueAt});
      if(a.waits.length>1000)a.waits.splice(0,a.waits.length-1000);
      enqueue(s,'AGENT_RECHECK',`recheck:${id}`,dueAt);event(s,'AGENT_WAIT_SCHEDULED',`${obligationId}: ${condition}; attempt ${attempt}`);
      return {waitId:id,recheckAt:new Date(dueAt).toISOString(),attempt};
    });
  }
  queueOwnerRequest(request:AgentUserDecisionRequest,runId?:string,planningAt=Date.now(),reviewObservation?:ReviewObservation) {
    if(!this.store)throw new Error('OWNER_REQUEST_UNAVAILABLE');
    return this.store.change(s=>{
      const o=s.obligations.find(o=>o.id===request.obligationId&&!o.paid&&!o.archived);
      if(!o||o.version!==request.obligationVersion||s.policy.version!==request.policyVersion||s.financialVersion!==request.stateVersion)throw new Error('OWNER_REQUEST_STALE');
      const eligibility=planningEligibility(s,o,planningAt);
      if(request.policyReason==='REVIEW_REQUIRED'){
        if(!reviewObservation||reviewObservation.obligationId!==o.id||reviewObservation.caseBinding!==reviewCaseBinding(s,o.id)||!s.autonomy!.reviews?.some(r=>r.fingerprint===reviewObservation.fingerprint&&r.caseBinding===reviewObservation.caseBinding))throw new Error('REVIEW_CONTEXT_REQUIRED');
      }else if(request.policyReason!=='OWNER_INSTRUCTION_REQUIRED'&&eligibility!==request.policyReason)throw new Error('POLICY_REASON_MISMATCH');
      if(request.policyReason==='OWNER_INSTRUCTION_REQUIRED'&&['ALLOW','FUNDING_REQUIRED','OWNER_DEFERRED','NEEDS_EVIDENCE'].includes(eligibility))throw new Error('OWNER_HELP_NOT_APPLICABLE');
      if(s.autonomy!.rejectionBindings.some(r=>r.obligationId===o.id&&r.binding===actionBinding(s,o.id)))throw new Error('OWNER_REJECTED');
      const existing=s.agentNotifications.find(n=>n.status==='OPEN'&&n.type==='USER_DECISION_REQUIRED'&&n.issues.length===1&&n.issues[0].obligationId===o.id&&n.issues[0].reason===request.policyReason&&n.obligationVersion===o.version&&n.policyVersion===s.policy.version&&n.stateVersion===s.financialVersion);
      if(existing)return {requestId:existing.id};
      const id=randomUUID();s.agentNotifications.push({id,runId:runId??'SCOPED_OWNER_REQUEST',type:'USER_DECISION_REQUIRED',status:'OPEN',title:'This payment needs your decision',message:'Other authorized payments can continue.',issues:[{obligationId:o.id,reason:request.policyReason}],question:request.question,obligationVersion:o.version,policyVersion:s.policy.version,stateVersion:s.financialVersion,createdAt:new Date().toISOString()});
      event(s,'AGENT_USER_ACTION_REQUIRED',o.id);return {requestId:id};
    });
  }
  proposeReceiptMatch(transferId:string,sourceRecordKey:string,question:string) {
    if(!this.store)throw new Error('RECEIPT_MATCH_UNAVAILABLE');
    return this.store.change(s=>{
      const a=s.autonomy!,t=a.transfers.find(t=>t.id===transferId&&t.status==='VERIFIED'&&t.classification==='UNMATCHED');
      const record=a.records.find(r=>`${r.sourceId}:${r.externalId}`===sourceRecordKey&&r.active&&r.authoritative&&r.kind==='RECEIVABLE');
      if(!t||!record||!a.parties.some(p=>p.id===record.partyId&&p.address.toLowerCase()===t.sender.toLowerCase()))throw new Error('RECEIPT_MATCH_INVALID');
      const binding=actionBinding(s,transferId);if(a.rejectionBindings.some(d=>d.obligationId===transferId&&d.binding===binding))throw new Error('OWNER_REJECTED');
      const previous=a.requests.find(r=>r.scope===transferId&&r.binding===binding&&r.status==='OPEN');if(previous)return {requestId:previous.id};
      const remaining=BigInt(t.amount)-a.allocations.filter(x=>x.transferId===transferId).reduce((n,x)=>n+BigInt(x.amount),0n);
      const owed=BigInt(record.amount)-a.allocations.filter(x=>x.sourceRecordKey===sourceRecordKey).reduce((n,x)=>n+BigInt(x.amount),0n);
      const allocation=remaining<owed?remaining:owed;if(allocation<=0n)throw new Error('RECEIPT_ALREADY_ALLOCATED');
      const id=randomUUID(),action={transferId,sourceRecordKey,amount:allocation.toString()};
      const digest=createHash('sha256').update(JSON.stringify([id,action,binding])).digest('hex');
      a.requests.push({id,kind:'MATCH',scope:transferId,title:record.title,question,action,binding,digest,policyVersion:s.policy.version,status:'OPEN',expiresAt:Date.now()+86400000,createdAt:Date.now()});return {requestId:id};
    });
  }
  promptContext() {
    return { projectInstructions: this.instructions(), policyConstitution: this.policyConstitution(), skills: this.skills(), memory: this.memorySnapshot() };
  }
}
