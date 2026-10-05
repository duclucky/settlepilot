import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SOURCE_CHAIN_NAMES, CHAIN_ID, isPending, isBridgePending, type State, type Decision } from './domain.ts';
import { decisionKey } from './scheduler-core.ts';
import type { GoalPlan } from './planning-types.ts';

export const PlanInput=z.object({
  obligationId:z.string().min(1).max(80),objective:z.string().trim().min(1).max(300),
  steps:z.array(z.object({action:z.enum(['OBSERVE','PREVIEW','FUND_ARC','PAY_NOW','WAIT','OWNER_REVIEW']),reason:z.string().trim().min(1).max(300),sourceChain:z.enum(SOURCE_CHAIN_NAMES).nullable().describe('Use a source chain only for FUND_ARC; use null for every other action.')}).strict()).min(1).max(12),
}).strict();

export function recordGoalPlan(s:State,raw:unknown,now=Date.now()) {
  const input=PlanInput.parse(raw),o=s.obligations.find(o=>o.id===input.obligationId&&!o.paid&&!o.archived);
  if(!o)throw new Error('UNKNOWN_CANDIDATE');
  for(const step of input.steps){
    if(step.action==='FUND_ARC'&&(!step.sourceChain||!s.bridgePolicy.sourceChains.includes(step.sourceChain)))throw new Error('PLAN_SOURCE_NOT_ALLOWED');
    if(step.action!=='FUND_ARC'&&step.sourceChain)throw new Error('INVALID_PLAN_SOURCE');
  }
  refreshGoalPlans(s);
  const plans=s.autonomy!.plans??=[];
  const previous=plans.find(p=>p.obligationId===o.id&&p.obligationVersion===o.version&&p.policyVersion===s.policy.version&&p.bridgePolicyVersion===s.bridgePolicy.version&&p.status!=='SUPERSEDED');
  const steps=input.steps.map(step=>({...step,status:'PLANNED' as const,proofId:previous?.steps.find(old=>old.action===step.action&&old.sourceChain===step.sourceChain)?.proofId}));
  if(previous){previous.objective=input.objective;previous.steps=steps;previous.contextKey=decisionKey(s);previous.updatedAt=now;previous.needsReassessment=false;refreshGoalPlans(s);return {planId:previous.id};}
  const plan:GoalPlan={id:randomUUID(),obligationId:o.id,obligationVersion:o.version,policyVersion:s.policy.version,bridgePolicyVersion:s.bridgePolicy.version,objective:input.objective,steps,history:[],contextKey:decisionKey(s),createdAt:now,updatedAt:now,status:'ACTIVE',needsReassessment:false};
  if(plans.length>=1000){const removable=plans.findIndex(p=>['SUPERSEDED','COMPLETED'].includes(p.status));if(removable<0)throw new Error('PLAN_STORAGE_LIMIT');plans.splice(removable,1);}
  plans.push(plan);return {planId:plan.id};
}

export function recordPlanDecisions(s:State,decisions:Decision[],runId:string,now=Date.now()) {
  for(const d of decisions){
    const o=s.obligations.find(o=>o.id===d.obligationId);
    let plan=s.autonomy?.plans?.find(p=>p.obligationId===o?.id&&p.obligationVersion===o.version&&p.policyVersion===s.policy.version&&p.bridgePolicyVersion===s.bridgePolicy.version&&p.status!=='SUPERSEDED');
    // Retain the model's selected funding target even when it did not call record_plan.
    // These steps record intent only; refreshGoalPlans derives proof independently.
    if(!plan&&o&&s.autonomy&&d.action==='FUND_ARC'&&d.fundingSourceChain){
      const saved=recordGoalPlan(s,{obligationId:o.id,objective:'Settle the selected obligation after verified CCTP mint.',steps:[
        {action:'FUND_ARC',reason:d.reason.slice(0,300),sourceChain:d.fundingSourceChain},
        {action:'PAY_NOW',reason:'Reassess current evidence, authority and Arc cash after verified mint.',sourceChain:null},
      ]},now);
      plan=s.autonomy.plans!.find(p=>p.id===saved.planId);
    }
    if(!plan)continue;
    const item={runId,action:d.action,reason:d.reason,sourceChain:d.fundingSourceChain,review:d.review,at:now};
    const previous=plan.history.findIndex(h=>h.runId===runId);if(previous<0)plan.history.push(item);else plan.history[previous]=item;
    plan.history=plan.history.slice(-16);plan.contextKey=decisionKey(s);plan.updatedAt=now;
  }
  refreshGoalPlans(s);
}

export function refreshGoalPlans(s:State) {
  const key=decisionKey(s);
  for(const p of s.autonomy?.plans??[]){
    const o=s.obligations.find(o=>o.id===p.obligationId);
    if(!o||o.archived||o.version!==p.obligationVersion||s.policy.version!==p.policyVersion||s.bridgePolicy.version!==p.bridgePolicyVersion){p.status='SUPERSEDED';p.needsReassessment=true;continue;}
    p.needsReassessment=p.contextKey!==key;
    const proof=s.intents.find(i=>i.obligationId===o.id&&i.obligationVersion===o.version&&i.policyVersion===p.policyVersion&&i.amount===o.amount&&i.recipient===o.recipient&&i.sender===s.policy.sender&&i.chainId===CHAIN_ID&&(i.status==='SETTLED'&&!!i.hash||i.status==='SIMULATED'&&s.mode==='simulation'));
    const runIds=new Set(p.history.filter(h=>h.action==='FUND_ARC').map(h=>h.runId));
    const savedProofs=new Set(p.steps.filter(step=>step.action==='FUND_ARC'&&step.proofId).map(step=>step.proofId));
    const bridges=s.bridgeIntents.filter(i=>!!i.runId&&(runIds.has(i.runId)||savedProofs.has(i.id))&&i.sourceWallet===s.policy.sender&&i.recipient===s.policy.sender&&i.destinationChain==='ARC-TESTNET'&&i.policyVersion===p.bridgePolicyVersion);
    for(const step of p.steps){
      step.status='PLANNED';step.proofId=undefined;
      if(step.action==='PAY_NOW'&&o.paid&&proof){step.status=proof.status==='SETTLED'?'VERIFIED':'SIMULATED';step.proofId=proof.id;}
      if(step.action==='FUND_ARC'){
        const bridge=bridges.find(i=>i.sourceChain===step.sourceChain&&i.status==='SETTLED'&&!!i.mintHash);
        if(bridge){step.status='VERIFIED';step.proofId=bridge.id;}
      }
    }
    if(o.paid&&proof){p.status='COMPLETED';p.needsReassessment=false;continue;}
    if(s.intents.some(i=>i.obligationId===o.id&&isPending(i))||bridges.some(isBridgePending)){p.status='RECONCILING';continue;}
    if(s.autonomy?.requests.some(r=>r.scope===o.id&&r.status==='OPEN')||s.evidenceRequests.some(r=>r.obligationId===o.id&&r.status==='OPEN')||s.agentNotifications.some(n=>n.status==='OPEN'&&n.issues.some(i=>i.obligationId===o.id))){p.status='OWNER_REVIEW';continue;}
    const wait=s.autonomy?.waits?.filter(w=>w.obligationId===o.id).at(-1);
    if(wait&&s.autonomy?.jobs.some(j=>j.key===`recheck:${wait.id}`&&['READY','LEASED'].includes(j.status))){p.status='WAITING';for(const step of p.steps.filter(t=>t.action==='WAIT'))step.status='WAITING';continue;}
    p.status='ACTIVE';
  }
}
