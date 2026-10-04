import { createHash } from 'node:crypto';
import type { State } from './domain.ts';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function actionBinding(s:State,scope:string) {
  // Outcome review cannot authorize a transfer. Bind it to that operation,
  // not unrelated treasury observations that would recreate the same question.
  const payment=s.intents.find(i=>i.id===scope),bridge=s.bridgeIntents.find(i=>i.id===scope);
  if(payment)return hash(['payment',payment.id,payment.status,payment.sender,payment.recipient,payment.amount,payment.chainId,payment.policyVersion,payment.providerId,payment.hash,payment.agentDispatchAt]);
  if(bridge)return hash(['bridge',bridge.id,bridge.status,bridge.sourceChain,bridge.destinationChain,bridge.sourceWallet,bridge.recipient,bridge.amount,bridge.policyVersion,bridge.burnHash,bridge.mintHash]);
  const o=s.obligations.find(o=>o.id===scope);
  return hash([s.policy,s.bridgePolicy,o,s.snapshot.balance,s.crosschainBalances.map(b=>[b.sourceChain,b.balance,b.status]),
    s.evidence.filter(e=>e.obligationId===scope),s.intents.filter(i=>i.obligationId===scope).map(i=>[i.id,i.status]),
    s.autonomy?.records.filter(r=>`${r.sourceId}:${r.externalId}`===scope),
    s.autonomy?.transfers.filter(t=>t.id===scope),s.autonomy?.allocations.filter(x=>x.transferId===scope),
    s.autonomy?.transfers.some(t=>t.id===scope)?[s.autonomy.records.filter(r=>r.kind==='RECEIVABLE'),s.autonomy.allocations]:undefined]);
}
