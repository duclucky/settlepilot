import { Address, CHAIN_ID, isBridgePending, isPending, type OverridablePolicyReason, type State, type Obligation } from './domain.ts';
import { verifiedCrosschainBalances } from './treasury.ts';
import { actionBinding } from './action-binding.ts';

export function availableCrosschainUnits(state: State, now = Date.now()): string {
  if (!state.bridgePolicy.enabled) return '0';
  return verifiedCrosschainBalances(state, now)
    .reduce((total, item) => total + BigInt(item.balance), 0n).toString();
}

function ownerOverride(state: State, obligation: Obligation, reason: OverridablePolicyReason, now: number) {
  return state.approvals.some(approval => approval.actor === 'owner' && approval.obligationId === obligation.id && approval.obligationVersion === obligation.version && approval.policyVersion === state.policy.version && approval.stateVersion === state.financialVersion && Date.parse(approval.expiresAt) > now && (approval.reason ?? 'NEEDS_APPROVAL') === reason);
}

export function evaluate(state: State, obligation: Obligation, now = Date.now()): string {
  const p = state.policy;
  if (state.paused) return 'PAUSED';
  if (p.chainId !== CHAIN_ID || state.snapshot.chainId !== CHAIN_ID) return 'WRONG_CHAIN';
  if (!p.enabled || Date.parse(p.authorityExpiresAt) <= now || !Number.isFinite(Date.parse(p.authorityExpiresAt))) return 'NO_AUTHORITY';
  if (!Address.safeParse(p.sender).success || !Address.safeParse(obligation.recipient).success || !p.allowlist.includes(obligation.recipient.toLowerCase()) || obligation.recipient.toLowerCase() === p.sender.toLowerCase()) return 'RECIPIENT_BLOCKED';
  if(obligation.archived)return 'SCENARIO_CLOSED';
  if (obligation.paid) return 'ALREADY_PAID';
  const source=state.autonomy?.records.find(r=>`${r.sourceId}-${r.externalId}`===obligation.id);
  if(source&&(!source.active||source.amendment))return 'SOURCE_REVIEW_REQUIRED';
  if(state.autonomy?.observationPaused)return 'CHAIN_REVIEW_REQUIRED';
  if((state.autonomy?.deferredUntil?.[obligation.id]??0)>now)return 'OWNER_DEFERRED';
  if (state.autonomy?.rejectionBindings.some(d => d.obligationId === obligation.id && d.binding === actionBinding(state, obligation.id))) return 'OWNER_REJECTED';
  if (!obligation.accepted || obligation.disputed) return 'NEEDS_EVIDENCE';
  if ((!Number.isFinite(Date.parse(obligation.due)) || Date.parse(obligation.due) > now + 14 * 86400000) && !ownerOverride(state, obligation, 'OUTSIDE_PLANNING_WINDOW', now)) return 'OUTSIDE_PLANNING_WINDOW';
  if (BigInt(obligation.amount) <= 0n) return 'INVALID_AMOUNT';
  // One unsettled transfer per operating wallet prevents ambiguous snapshot/reservation accounting.
  if (state.intents.some(isPending) || state.bridgeIntents.some(isBridgePending)) return 'RECONCILE_REQUIRED';
  const age = now - Date.parse(state.snapshot.observedAt);
  if (!Number.isFinite(age) || age > 30_000 || age < -5_000) return 'STALE_BALANCE';
  const spent = state.intents.filter(i => ['SETTLED', 'SIMULATED'].includes(i.status)).reduce((n, i) => n + BigInt(i.amount), 0n);
  if (spent + BigInt(obligation.amount) > BigInt(p.totalBudget) && !ownerOverride(state, obligation, 'BUDGET_EXCEEDED', now)) return 'BUDGET_EXCEEDED';
  if (BigInt(obligation.amount) > BigInt(p.perObligation) && !ownerOverride(state, obligation, 'NEEDS_APPROVAL', now)) return 'NEEDS_APPROVAL';
  const balanceAfterGas = BigInt(state.snapshot.balance) - BigInt(p.gasLimit);
  if (balanceAfterGas < BigInt(obligation.amount)) return 'INSUFFICIENT_FUNDS';
  if (balanceAfterGas - BigInt(p.reserve) < BigInt(obligation.amount) && !ownerOverride(state, obligation, 'RESERVE_CONFLICT', now)) return 'RESERVE_CONFLICT';
  return 'ALLOW';
}

export function planningEligibility(state: State, obligation: Obligation, now = Date.now()): string {
  const result = evaluate(state, obligation, now);
  return ['INSUFFICIENT_FUNDS', 'RESERVE_CONFLICT'].includes(result) && BigInt(availableCrosschainUnits(state, now)) > 0n ? 'FUNDING_REQUIRED' : result;
}
