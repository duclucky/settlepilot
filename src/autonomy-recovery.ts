import { createHash } from 'node:crypto';
import { isPending, isBridgePending, type State } from './domain.ts';
import { observedCrosschainBalances, verifiedCrosschainBalances } from './treasury.ts';
import { decisionKey } from './scheduler-core.ts';

export function recoveryContext(s: State, now = Date.now()) {
  const verified = verifiedCrosschainBalances(s, now);
  const observed = observedCrosschainBalances(s, now);
  const age = now - Date.parse(s.snapshot.observedAt);
  const expectedReceipts = [
    ...s.receivables.filter(r => !r.receivedHash).map(r => ({ id:r.id, amount:r.amount, source:r.source, chain:'ARC-TESTNET' })),
    ...s.crosschainReceivables.filter(r => !r.receivedHash).map(r => ({ id:r.id, amount:r.amount, source:r.source, chain:r.sourceChain })),
    ...(s.autonomy?.records ?? []).filter(r => r.kind==='RECEIVABLE' && r.active && r.authoritative && !r.amendment && !r.retired)
      .flatMap(r => {
        const remaining=BigInt(r.amount)-(s.autonomy?.allocations ?? []).filter(a=>a.sourceRecordKey===`${r.sourceId}:${r.externalId}`).reduce((n,a)=>n+BigInt(a.amount),0n);
        return remaining>0n ? [{ id:`${r.sourceId}:${r.externalId}`, amount:remaining.toString(), source:r.partyId, chain:'UNSPECIFIED', due:r.due }] : [];
      }),
  ];
  return {
    unavailableSourceChains:s.bridgePolicy.enabled ? s.bridgePolicy.sourceChains.filter(c=>!observed.some(b=>b.sourceChain===c)) : [],
    arcObservationStale:!Number.isFinite(age)||age>30000||age < -5000,
    sourceObservations:s.crosschainBalances.map(b=>({sourceChain:b.sourceChain,status:b.status,observedAt:b.observedAt,spendable:verified.some(v=>v.sourceChain===b.sourceChain)})),
    expectedReceipts, expectedReceiptsAreSpendable:false,
    workers:s.autonomy?.workers ?? [],
    pendingPayments:s.intents.filter(isPending).map(i=>({id:i.id,obligationId:i.obligationId,status:i.status})),
    pendingBridges:s.bridgeIntents.filter(isBridgePending).map(i=>({id:i.id,sourceChain:i.sourceChain,status:i.status})),
    waits:s.autonomy?.waits?.slice(-50) ?? [],
    waitLimits:{maxRetrySeconds:900,maxAttemptsPerUnchangedContext:5},
  };
}

// Ignore RPC timestamps and retry counters: repeated failures cannot reset the
// waiting limit. Changed money, evidence or owner instructions permit reassessment.
export function recoveryKey(s:State,now=Date.now()) {
  const r=recoveryContext(s,now);
  return createHash('sha256').update(JSON.stringify([decisionKey(s),r.unavailableSourceChains,r.arcObservationStale,r.expectedReceipts])).digest('hex');
}
