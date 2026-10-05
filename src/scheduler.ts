import { randomUUID } from 'node:crypto';
import type { State } from './domain.ts';
import { isPending, isBridgePending } from './domain.ts';
import type { Runtime } from './config.ts';
import { Store } from './store.ts';
import { runAdaptive } from './adaptive.ts';
import { refreshGoalPlans } from './goal-plans.ts';
import {modelFailureCodes} from './model-requests.ts';
import {evaluationKey, resolveEvaluationFailures} from './evaluation-control.ts';

import { enqueue, decisionKey, externalInputKey } from './scheduler-core.ts';
export { enqueue, decisionKey, externalInputKey } from './scheduler-core.ts';
export function scheduleDeadlines(store: Store, now = Date.now()) {
  store.change(s => {
    refreshGoalPlans(s);
    for(const wait of s.autonomy!.waits??[]) {
      if(!s.obligations.some(o=>o.id===wait.obligationId&&!o.paid&&!o.archived))
        for(const job of s.autonomy!.jobs.filter(j=>j.key===`recheck:${wait.id}`&&j.status==='READY')){job.status='DONE';job.error='WAIT_NO_LONGER_RELEVANT';}
    }
    for(const job of s.autonomy!.jobs.filter(j=>j.status==='READY'&&j.key.startsWith('deadline:'))){
      const [,id,version]=job.key.split(':');if(!s.obligations.some(o=>o.id===id&&!o.paid&&!o.archived&&String(o.version)===version)){job.status='DONE';job.error='DEADLINE_NO_LONGER_RELEVANT';}
    }
    for (const o of s.obligations.filter(o => !o.paid&&!o.archived)) {
      const due = Date.parse(o.due);
      if (!Number.isFinite(due)) continue;
      for (const [label, offset] of [['WINDOW',14*86400000],['SOON',86400000],['DUE',0]] as const) {
        enqueue(s, `DEADLINE_${label}`, `deadline:${o.id}:${o.version}:${label}`, due-offset);
      }
    }

  });
}

export class AgentScheduler {
  readonly owner = randomUUID();
  private ticking = false;
  get active(){return this.ticking;}
  private readonly leaseMs = 90_000;
  constructor(readonly runtime: Runtime, private clock = () => Date.now()) {}
  wake(cause: string, key = `${cause}:${decisionKey(this.runtime.store.read())}`) {
    return this.runtime.store.change(s => enqueue(s,cause,key,this.clock()));
  }
  async tick() {
    if (this.ticking) return; this.ticking=true;
    let claimed: { id: string; fence: number; evaluationKey: string } | undefined;
    const store=this.runtime.store;
    try {
      scheduleDeadlines(store,this.clock());
      claimed=store.change(s => {
        const a=s.autonomy!, now=this.clock();
        if (s.paused || a.observationPaused || a.lease && a.lease.until > now) return;
        if(Object.values(s.modelControl?.blocks??{}).some(b=>b&&(b.retryAt===undefined||b.retryAt>now)))return;
        if (s.intents.some(isPending) || s.bridgeIntents.some(isBridgePending)) return;
        for (const old of a.jobs.filter(j => j.status==='LEASED' && (j.leaseUntil??0)<=now)) {
          old.status='READY';
          for(const run of s.runs.filter(r=>r.status==='RUNNING')) { run.status='ERROR'; run.error='INTERRUPTED_RECONCILE_BEFORE_REPLAN'; }
        }
        const jobs=a.jobs.filter(j=>j.status==='READY' && j.dueAt<=now).sort((x,y)=>x.dueAt-y.dueAt);
        if(!jobs.length) return;
        const failureKey=evaluationKey(s,now),failure=a.evaluationFailure;
        if(failure?.key===failureKey&&(failure.retryAt===undefined||failure.retryAt>now))return;
        const first=jobs[0];
        const previousAttempts=Math.max(failure?.key===failureKey?failure.attempts:0,...jobs.filter(j=>j.evaluationKey===failureKey).map(j=>j.attempts));
        // Drain equivalent wakeups in a single decision without dropping later events.
        for (const j of jobs.slice(1)) { j.status='DONE'; j.error='COALESCED';j.coalescedInto=first.id; }
        const key=decisionKey(s);
        const timeOrSettlementChanged=jobs.some(j=>j.attempts>0||j.cause==='AGENT_RECHECK'||j.cause==='OWNER_PROPOSAL_SUPERSEDED'||j.cause.startsWith('DEADLINE')||j.cause.startsWith('BRIDGE_SETTLED')||j.cause==='REQUEST_EXPIRED');
        if(a.lastDecisionKey===key && !timeOrSettlementChanged && !jobs.some(j=>['MODEL_CONNECTION_RESET','MODEL_CONFIGURATION_CHANGED'].includes(j.cause))) { first.status='DONE'; return; }
        a.fence++; a.lease={owner:this.owner,fence:a.fence,until:now+this.leaseMs};
        first.status='LEASED'; first.attempts=previousAttempts+1; first.evaluationKey=failureKey; first.leaseOwner=this.owner; first.leaseUntil=now+this.leaseMs; first.fence=a.fence;
        return {id:first.id,fence:a.fence,evaluationKey:failureKey};
      });
      if(!claimed) return;
      const claim=claimed;const inputKey=externalInputKey(store.read());
      const owned=()=>{const l=store.read().autonomy!.lease;return !!l&&l.owner===this.owner&&l.fence===claim.fence&&l.until>this.clock();};
      const previous=this.runtime.engine.executionGuard;
      const previousBridge=this.runtime.bridge?.executionGuard;
      this.runtime.engine.executionGuard=owned;
      if(this.runtime.bridge) this.runtime.bridge.executionGuard=owned;
      const heartbeat=setInterval(()=>{store.change(s=>{const l=s.autonomy!.lease;if(l?.owner===this.owner&&l.fence===claim.fence){l.until=this.clock()+this.leaseMs;const j=s.autonomy!.jobs.find(j=>j.id===claim.id)!;j.leaseUntil=l.until;}});},10_000);
      try {
        const result=await runAdaptive(this.runtime);
        store.change(s=>{
          if(!owned()) return;
          const job=s.autonomy!.jobs.find(j=>j.id===claim.id)!;
          job.runId=result.runId;
          for(const j of s.autonomy!.jobs.filter(j=>j.coalescedInto===claim.id))j.runId=result.runId;
          const run=s.runs.find(r=>r.id===result.runId);
          if(run?.status==='ERROR') {
            const code=run.failureCode??'',blocks=Object.values(s.modelControl?.blocks??{});
            const retryAt=Math.max(this.clock()+300_000,...blocks.flatMap(b=>b?.retryAt?[b.retryAt]:[]));
            const transient=['MODEL_RATE_LIMITED','MODEL_TEMPORARILY_UNAVAILABLE','MODEL_TIMEOUT','MODEL_CONNECTION_FAILED'].includes(code);
            const budget=code==='MODEL_BUDGET_EXCEEDED';
            job.status=budget||transient&&job.attempts<2?'READY':job.attempts>=3||modelFailureCodes.has(code)||['INVALID_TOOL_SEQUENCE','MODEL_TOOL_LIMIT'].includes(code)?'NEEDS_ATTENTION':'READY'; job.error='AGENT_RUN_FAILED';
            job.dueAt=budget||transient?retryAt:this.clock()+[5_000,15_000,45_000][Math.min(job.attempts-1,2)];
            s.autonomy!.evaluationFailure={key:claim.evaluationKey,attempts:job.attempts,code,jobId:job.id,...(job.status==='READY'?{retryAt:job.dueAt}:{})};
          } else {job.status='DONE';if(run?.status==='DONE'){resolveEvaluationFailures(s,job.id);s.autonomy!.evaluationFailure=undefined;}if(externalInputKey(s)!==inputKey){s.autonomy!.lastDecisionKey=undefined;enqueue(s,'INPUT_CHANGED_DURING_RUN',`changed:${claim.id}`,this.clock());}else s.autonomy!.lastDecisionKey=decisionKey(s);}
        });
      } catch {store.change(s=>{const j=s.autonomy!.jobs.find(j=>j.id===claim.id)!;if(j.fence!==claim.fence)return;j.status=j.attempts>=3?'NEEDS_ATTENTION':'READY';j.dueAt=this.clock()+15_000;j.error='JOB_FAILED';s.autonomy!.evaluationFailure={key:claim.evaluationKey,attempts:j.attempts,code:'JOB_FAILED',jobId:j.id,...(j.status==='READY'?{retryAt:j.dueAt}:{})};});}
      finally {clearInterval(heartbeat);this.runtime.engine.executionGuard=previous;if(this.runtime.bridge)this.runtime.bridge.executionGuard=previousBridge;}
    } finally {
      if(claimed) store.change(s=>{if(s.autonomy!.lease?.owner===this.owner&&s.autonomy!.lease.fence===claimed!.fence)s.autonomy!.lease=undefined;});
      this.ticking=false;
    }
  }
}
