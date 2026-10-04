import type { Runtime } from './config.ts';
import { event } from './store.ts';
import { refreshCrosschainBalances } from './treasury.ts';
import { enqueue } from './scheduler-core.ts';

export async function runAdaptive(runtime: Runtime, receivableId?: string, depth = 0, refreshInventory = true): Promise<{ runId: string; bridgeId?: string }> {
  const { store, engine, sources, bridge } = runtime;
  if (store.read().mode !== 'testnet') return { runId: await engine.run() };
  if (!sources || !bridge || !runtime.bridgeEnabled) {
    if (sources) await refreshCrosschainBalances(store, sources, false);
    return { runId: await engine.run() };
  }
  if (refreshInventory) await refreshCrosschainBalances(store, sources, true);
  const runId = await engine.plan();
  const run = store.read().runs.find(item => item.id === runId);
  if (!run || run.status !== 'DONE') return { runId };
  const bridgeId = receivableId ? await bridge.fund(receivableId, runId) : await bridge.fundFromInventory(runId);
  if (!bridgeId) {
    const current = store.read();
    if (run.financialVersion !== current.financialVersion && depth < 8) return runAdaptive(runtime, undefined, depth + 1, false);
    await engine.executePlanned(runId);
    return { runId };
  }
  if (store.read().bridgeIntents.find(item => item.id === bridgeId)?.status !== 'SETTLED') return { runId, bridgeId };
  if (depth >= 8) {
    store.change(state => { event(state, 'ADAPTIVE_FUNDING_LIMIT_REACHED', runId);enqueue(state,'BRIDGE_SETTLED_CONTINUATION',`bridge-continuation:${bridgeId}`); });
    return { runId, bridgeId };
  }
  const next = await runAdaptive(runtime, undefined, depth + 1);
  return { ...next, bridgeId: next.bridgeId ?? bridgeId };
}
