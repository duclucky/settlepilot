import { SOURCE_CHAINS, type Snapshot, type SourceChain, type State } from './domain.ts';
import { Store, event } from './store.ts';

export interface SourceBalanceReader { snapshot(address: string): Promise<Snapshot> }

export function observedCrosschainBalances(state: State, now = Date.now()) {
  return state.crosschainBalances
    .filter(item => item.status === 'VERIFIED' && state.bridgePolicy.sourceChains.includes(item.sourceChain))
    .filter(item => item.chainId === SOURCE_CHAINS[item.sourceChain].chainId)
    .filter(item => {
      const age = now - Date.parse(item.observedAt);
      return Number.isFinite(age) && age >= -5_000 && age <= 30_000;
    });
}

/** Legacy observations had no execution flag; current refreshes always record it. */
export function verifiedCrosschainBalances(state: State, now = Date.now()) {
  return state.bridgePolicy.enabled
    ? observedCrosschainBalances(state, now).filter(item => item.fundingEnabled !== false)
    : [];
}

export async function refreshCrosschainBalances(
  store: Store,
  sources: Map<SourceChain, SourceBalanceReader>,
  enabled: boolean,
) {
  const state = store.read();
  const chains = state.bridgePolicy.sourceChains;
  const observedAt = new Date().toISOString();
  const results = await Promise.allSettled(chains.map(async sourceChain => {
        const snapshot = await sources.get(sourceChain)?.snapshot(state.policy.sender);
        if (!snapshot || snapshot.chainId !== SOURCE_CHAINS[sourceChain].chainId) throw new Error('SOURCE_SNAPSHOT_INVALID');
        return { sourceChain, ...snapshot, status: 'VERIFIED' as const, fundingEnabled: enabled && state.bridgePolicy.enabled };
      }));
  const balances = chains.map((sourceChain, index) => {
    const result = results[index];
    return result.status === 'fulfilled'
      ? result.value
      : { sourceChain, balance: '0', chainId: SOURCE_CHAINS[sourceChain].chainId, block: '0', observedAt, status: 'UNAVAILABLE' as const, fundingEnabled: false };
  });
  store.change(current => {
    current.crosschainBalances = balances;
    const verified = balances.filter(item => item.status === 'VERIFIED').length;
    event(current, 'MULTICHAIN_BALANCES_REFRESHED', `${verified}/${balances.length} source chains verified`);
  });
  return balances;
}
