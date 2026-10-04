import { CHAIN_ID, isBridgePending, isPending, type State } from './domain.ts';
import { evaluate } from './policy.ts';
import { observedCrosschainBalances, verifiedCrosschainBalances } from './treasury.ts';

const positive = (n: bigint) => n > 0n ? n : 0n;
const day = 86_400_000;

/** Facts and conservative scenarios, never a payment selection or an authorization. */
export function analyzeLiquidity(state: State, now = Date.now()) {
  const open = state.obligations.filter(o => !o.paid && !o.archived);
  const age = now - Date.parse(state.snapshot.observedAt);
  const arcFresh = state.snapshot.chainId === CHAIN_ID && Number.isFinite(age) && age >= -5_000 && age <= 30_000;
  const arc = BigInt(state.snapshot.balance), reserve = BigInt(state.policy.reserve), gas = BigInt(state.policy.gasLimit);
  const spent = state.intents.filter(i => ['SETTLED', 'SIMULATED'].includes(i.status)).reduce((n, i) => n + BigInt(i.amount), 0n);
  const pendingOperations = state.intents.filter(isPending).length + state.bridgeIntents.filter(isBridgePending).length;
  const fundingSources = verifiedCrosschainBalances(state, now);
  const sources = observedCrosschainBalances(state, now).map(source => {
    const enabled = fundingSources.some(s => s.sourceChain === source.sourceChain);
    const afterFee = positive(BigInt(source.balance) - BigInt(state.bridgePolicy.maxFee));
    const capacity = enabled ? (afterFee < BigInt(state.bridgePolicy.maxAmount) ? afterFee : BigInt(state.bridgePolicy.maxAmount)) : 0n;
    return { sourceChain: source.sourceChain, observedUnits: source.balance, fundingEnabled: enabled,
      conservativeMintPerBridgeUnits: capacity.toString(), feeCeilingUnits: state.bridgePolicy.maxFee };
  });
  // One bridge per observed source. More rounds may be possible, but require new observations and decisions.
  const conditionalFunding = sources.reduce((n, s) => n + BigInt(s.conservativeMintPerBridgeUnits), 0n);
  const horizons = ([['OVERDUE', 0], ['NEXT_24_HOURS', day], ['NEXT_7_DAYS', 7 * day], ['NEXT_14_DAYS', 14 * day]] as const).map(([horizon, offset]) => {
    const due = open.filter(o => Number.isFinite(Date.parse(o.due)) && Date.parse(o.due) <= now + offset);
    const principal = due.reduce((n, o) => n + BigInt(o.amount), 0n);
    const gasCeiling = BigInt(due.length) * gas;
    const target = due.length ? principal + gasCeiling + reserve : 0n;
    return { horizon, dueBy: new Date(now + offset).toISOString(), obligationCount: due.length,
      acceptedCount: due.filter(o => o.accepted && !o.disputed).length,
      principalUnits: principal.toString(), gasCeilingUnits: gasCeiling.toString(), targetArcUnits: target.toString(),
      arcShortfallUnits: arcFresh ? positive(target - arc).toString() : null,
      conditionalShortfallUnits: arcFresh ? positive(target - arc - conditionalFunding).toString() : null,
      budgetGapUnits: positive(principal - positive(BigInt(state.policy.totalBudget) - spent)).toString() };
  });
  const expectedReceipts = (state.autonomy?.records ?? []).filter(r => r.kind === 'RECEIVABLE' && r.active && r.authoritative && !r.amendment && !r.retired).map(r => {
    const key = `${r.sourceId}:${r.externalId}`;
    const allocated = (state.autonomy?.allocations ?? []).filter(a => a.sourceRecordKey === key).reduce((n, a) => n + BigInt(a.amount), 0n);
    return { sourceRecordKey: key, due: r.due, outstandingUnits: positive(BigInt(r.amount) - allocated).toString() };
  }).filter(r => r.outstandingUnits !== '0');
  return {
    kind: 'CONSERVATIVE_LIQUIDITY_ANALYSIS' as const, asOf: new Date(now).toISOString(), mode: state.mode,
    executionAuthorized: false, costsAreProviderQuotes: false, expectedReceiptsIncludedInCash: false,
    arc: { observedUnits: state.snapshot.balance, observationFresh: arcFresh, observedAt: state.snapshot.observedAt,
      afterReserveUnits: arcFresh ? positive(arc - reserve).toString() : null, reserveUnits: state.policy.reserve, gasCeilingPerPayoutUnits: state.policy.gasLimit },
    remainingBudgetUnits: positive(BigInt(state.policy.totalBudget) - spent).toString(), pendingOperations,
    sources, conditionalMintOneBridgePerSourceUnits: conditionalFunding.toString(),
    unavailableSourceChains: state.bridgePolicy.sourceChains.filter(chain => !sources.some(s => s.sourceChain === chain)),
    horizons, expectedReceipts,
    obligations: open.map(o => ({ obligationId: o.id, due: o.due, amountUnits: o.amount, accepted: o.accepted && !o.disputed,
      policyResult: evaluate(state, o, now),
      gapToPayOnArcUnits: arcFresh ? positive(BigInt(o.amount) + gas + reserve - arc).toString() : null })),
  };
}

export type LiquidityAnalysis = ReturnType<typeof analyzeLiquidity>;
