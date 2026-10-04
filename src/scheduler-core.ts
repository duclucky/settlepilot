import { createHash, randomUUID } from 'node:crypto';
import type { State } from './domain.ts';
import { event } from './store.ts';

export function enqueue(state: State, cause: string, key: string, dueAt = Date.now()) {
  const a = state.autonomy!;
  const existing = a.jobs.find(job => job.key === key);
  if (existing) return existing.id;
  if(a.jobs.length>=10000)throw new Error('JOB_STORAGE_LIMIT');
  const id = randomUUID();
  a.jobs.push({ id, key, cause, dueAt, status: 'READY', attempts: 0 });
  event(state, 'AGENT_WAKE_QUEUED', cause); return id;
}
export function decisionKey(s: State) {
  return createHash('sha256').update(JSON.stringify([s.policy, s.bridgePolicy, s.paused, s.snapshot.balance,
    s.obligations, s.evidence, s.crosschainBalances.map(b => [b.sourceChain,b.balance,b.status,b.fundingEnabled !== false]),
    s.intents.map(i => [i.id,i.status]),s.bridgeIntents.map(i => [i.id,i.status]),
    s.autonomy?.responses,s.autonomy?.rejectionBindings,s.autonomy?.deferredUntil,
    s.autonomy?.records.map(r=>[r.sourceId,r.externalId,r.revision,r.hash,r.authoritative,r.active,r.amendment]),
    s.autonomy?.transfers.map(t=>[t.id,t.status,t.classification]),s.autonomy?.allocations])).digest('hex');
}

export function externalInputKey(s:State){return createHash('sha256').update(JSON.stringify([s.policy,s.bridgePolicy,s.paused,s.evidence,s.obligations.map(o=>[o.id,o.title,o.recipient,o.amount,o.due,o.accepted,o.disputed]),s.autonomy?.records,s.autonomy?.responses,s.autonomy?.rejectionBindings])).digest('hex');}
