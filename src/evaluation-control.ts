import {createHash} from 'node:crypto';
import type {State} from './domain.ts';
import {decisionKey} from './scheduler-core.ts';
import {modelFailureCodes} from './model-requests.ts';
import {CHAIN_ID} from './domain.ts';
import {verifiedCrosschainBalances} from './treasury.ts';

const recoverableEvaluationCodes=new Set([...modelFailureCodes,'INVALID_TOOL_SEQUENCE','MODEL_TOOL_LIMIT','INVALID_JEV_RESPONSE','MODEL_REQUEST_FAILED','JEV_REQUEST_FAILED']);

// Worker timestamps and job IDs are deliberately absent. Only changed business
// facts, meaningful deadlines or an explicit reset start a new retry allowance.
export function evaluationKey(state: State, now: number, includeObservationState=true) {
  const deadlines = state.obligations.filter(o => !o.paid && !o.archived).map(o => {
    const remaining = Date.parse(o.due) - now;
    return [o.id, !Number.isFinite(remaining) ? 'INVALID' : remaining <= 0 ? 'DUE' : remaining <= 86400000 ? 'SOON' : remaining <= 14 * 86400000 ? 'WINDOW' : 'FUTURE'];
  });
  const age=now-Date.parse(state.snapshot.observedAt);
  const observations=includeObservationState&&state.mode==='testnet'?[state.snapshot.chainId===CHAIN_ID&&Number.isFinite(age)&&age>=-5000&&age<=30000,verifiedCrosschainBalances(state,now).map(b=>b.sourceChain).sort()]:[];
  const authorityActive=Date.parse(state.policy.authorityExpiresAt)>now;
  const approvals=state.approvals.filter(a=>Date.parse(a.expiresAt)>now);
  const ownerDelays=Object.entries(state.autonomy?.deferredUntil??{}).map(([id,until])=>[id,until>now]).sort();
  return createHash('sha256').update(JSON.stringify([decisionKey(state), deadlines,observations,authorityActive,approvals,ownerDelays, state.modelControl?.resetVersion ?? 0, state.modelControl?.configurationVersion ?? 0])).digest('hex');
}

export function resolveEvaluationFailures(state: State, recoveredJobId: string) {
  const records = state.modelControl?.requests ?? [];
  for (const job of state.autonomy!.jobs.filter(j => j.id !== recoveredJobId && j.status === 'NEEDS_ATTENTION')) {
    const failed = state.runs.find(r => r.id === job.runId);
    if (!failed?.failureCode || !recoverableEvaluationCodes.has(failed.failureCode)) continue;
    const failures = records.filter(r => r.runId === failed.id && r.error);
    // A reset alone is not recovery. Failed provider requests require a later
    // successful response from that provider before their incident is closed.
    if (failures.some(f => !records.some(r => r.provider === f.provider && r.runId !== f.runId && r.completedAt !== undefined && r.completedAt >= (f.completedAt ?? f.at) && !r.error && r.status !== 'RESERVED'))) continue;
    job.status = 'DONE';
    job.error = 'EVALUATION_RECOVERED';
  }
}
