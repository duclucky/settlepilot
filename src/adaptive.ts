import type { Runtime } from './config.ts';
import { event } from './store.ts';
import { refreshCrosschainBalances } from './treasury.ts';
import { enqueue } from './scheduler-core.ts';

export async function runAdaptive(runtime: Runtime, receivableId?: string, depth = 0, refreshInventory = true): Promise<{ runId: string; bridgeId?: string }> {
  const { store, engine, sources, bridge } = runtime;
  const stopStale=(runId:string)=>{store.change(state=>{const run=state.runs.find(r=>r.id===runId)!;run.status='ERROR';run.executionStatus='INVALIDATED';run.failureCode='MODEL_NO_PROGRESS';run.error='RUN_FAILED_CHECK_CONFIGURATION_OR_INPUT';event(state,'RUN_FAILURE_CODE',`${runId}: MODEL_NO_PROGRESS`);});return {runId};};
  if (store.read().mode !== 'testnet') return { runId: await engine.run() };
  if (!sources || !bridge || !runtime.bridgeEnabled) {
    if (sources) await refreshCrosschainBalances(store, sources, false);
    return { runId: await engine.run() };
  }
  if (refreshInventory) await refreshCrosschainBalances(store, sources, true);
  const runId = await engine.plan();
  const run = store.read().runs.find(item => item.id === runId);
  if (!run || run.status !== 'DONE') return { runId };
  // Tool calls and review can outlive the 30-second observation window.
  // Refresh actual cash before deriving a bridge gap; changed facts require a new LLM plan.
  await refreshCrosschainBalances(store, sources, true);
  const snapshot = await engine.gateway.snapshot();
  store.change(state => { state.snapshot = snapshot; });
  const observed = store.read();
  if (run.financialVersion !== observed.financialVersion || run.policyVersion !== observed.policy.version) {
    store.change(state => { state.runs.find(item => item.id === runId)!.executionStatus = 'INVALIDATED'; });
    if (depth >= 1) return stopStale(runId);
    return runAdaptive(runtime, undefined, depth + 1, false);
  }
  const bridgeId = receivableId ? await bridge.fund(receivableId, runId) : await bridge.fundFromInventory(runId);
  if (!bridgeId) {
    const current = store.read();
    if (run.financialVersion !== current.financialVersion) return depth>=1?stopStale(runId):runAdaptive(runtime, undefined, depth + 1, false);
    await engine.executePlanned(runId);
    return { runId };
  }
  if (store.read().bridgeIntents.find(item => item.id === bridgeId)?.status !== 'SETTLED') return { runId, bridgeId };
  // A verified settlement creates one durable continuation, not another nested
  // model loop with a new run budget. The scheduler coalesces fresh observations.
  store.change(state => {event(state,'ADAPTIVE_CONTINUATION_QUEUED',runId);enqueue(state,'BRIDGE_SETTLED_CONTINUATION',`bridge-continuation:${bridgeId}`);});
  return {runId,bridgeId};
}
