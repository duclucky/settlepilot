import { CHAIN_ID, type State, type Obligation } from '../domain.ts';

export function paymentOutcome(state: State, obligation: Obligation): 'verified' | 'simulated' | undefined {
  const matching = state.intents.filter(i => i.obligationId === obligation.id && i.obligationVersion === obligation.version && i.amount === obligation.amount && i.recipient === obligation.recipient && i.sender === state.policy.sender && i.chainId === CHAIN_ID);
  if (state.mode === 'testnet' && matching.some(i => i.status === 'SETTLED' && /^0x[0-9a-fA-F]{64}$/.test(i.hash ?? ''))) return 'verified';
  if (state.mode === 'simulation' && matching.some(i => i.status === 'SIMULATED')) return 'simulated';
}

export function localSummary(state: State) {
  const obligations = state.obligations.filter(o => !o.archived);
  const unpaid = obligations.filter(o => !paymentOutcome(state, o)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const paid = obligations.filter(o => !!paymentOutcome(state, o));
  const seen = new Set<string>();
  const revenues = state.revenues.filter(r => {
    if (state.mode === 'testnet' ? r.simulated || !/^0x[0-9a-fA-F]{64}$/.test(r.hash ?? '') : !r.simulated) return false;
    const key = r.hash ? `${r.sourceChain ?? 'ARC-TESTNET'}:${r.hash.toLowerCase()}` : r.id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const sum = (items: {amount: string}[]) => items.reduce((n, i) => n + BigInt(i.amount), 0n).toString();
  return { unpaid, paid, revenues, received: sum(revenues), remaining: sum(unpaid), settled: sum(paid) };
}
