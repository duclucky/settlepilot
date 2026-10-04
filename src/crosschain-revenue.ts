import { randomUUID } from 'node:crypto';
import { event } from './store.ts';
import type { Runtime } from './config.ts';
import type { State } from './domain.ts';
import { runAdaptive } from './adaptive.ts';

export function shouldEvaluateFunding(state: State, receivableId: string, now = Date.now()) {
  const evaluations = state.fundingEvaluations.filter(e => e.receivableId === receivableId);
  const latest = evaluations.at(-1);
  if (!latest) return true;
  if (latest.result === 'NO_BRIDGE_REQUIRED') return latest.financialVersion !== state.financialVersion;
  return latest.result === 'PLANNING_FAILED' && evaluations.length < 3 && now - Date.parse(latest.at) >= 30_000;
}

export async function processVerifiedCrosschainRevenue(runtime: Runtime, receivableId: string) {
  if (!runtime.bridge) throw new Error('CCTP_NOT_AVAILABLE');
  const { store } = runtime;
  const receivable = store.read().crosschainReceivables.find(r => r.id === receivableId && r.receivedHash && !r.bridgeId);
  if (!receivable) throw new Error('RECEIVABLE_NOT_READY');
  const previousAttempts = store.read().fundingEvaluations.filter(e => e.receivableId === receivableId).length;
  const result = await runAdaptive(runtime, receivableId);
  const { runId, bridgeId } = result;
  const run = store.read().runs.find(r => r.id === runId)!;
  if (run.status === 'ERROR') {
    store.change(s => s.fundingEvaluations.push({ receivableId, runId, attempt: previousAttempts + 1, at: new Date().toISOString(), financialVersion: s.financialVersion, result: 'PLANNING_FAILED' }));
    return { runId, bridgeId: undefined };
  }
  store.change(s => s.fundingEvaluations.push({ receivableId, runId, attempt: previousAttempts + 1, at: new Date().toISOString(), financialVersion: s.financialVersion, result: bridgeId ? 'BRIDGE_CREATED' : 'NO_BRIDGE_REQUIRED' }));
  return result;
}

export async function monitorCrosschainRevenue(runtime: Runtime) {
  if (!runtime.sources || !runtime.bridge || runtime.store.read().mode !== 'testnet') return;
  const { sources, store } = runtime;
  for (const receivable of store.read().crosschainReceivables.filter(r => r.receivedHash && !r.bridgeId)) {
    if (shouldEvaluateFunding(store.read(), receivable.id)) {
      await processVerifiedCrosschainRevenue(runtime, receivable.id);
      break;
    }
  }
  for (const receivable of store.read().crosschainReceivables.filter(r => !r.receivedHash)) {
    const reader = sources.get(receivable.sourceChain); if (!reader) continue;
    const sourceSnapshot = await reader.snapshot(store.read().policy.sender); const head = BigInt(sourceSnapshot.block);
    const from = BigInt(receivable.cursor) + 1n; if (from > head) continue;
    const end = from + 499n < head ? from + 499n : head;
    const hashes = await reader.incoming(receivable.source, store.read().policy.sender, from, end, receivable.amount);
    let recorded = false;
    for (const hash of hashes) {
      if (store.read().revenues.some(r => r.hash?.toLowerCase() === hash.toLowerCase())) continue;
      await reader.verifyIncoming(hash, { sender: receivable.source, recipient: store.read().policy.sender, amount: receivable.amount });
      recorded = store.change(s => {
        const r = s.crosschainReceivables.find(r => r.id === receivable.id)!;
        if (r.receivedHash || s.revenues.some(other => other.hash?.toLowerCase() === hash.toLowerCase())) return false;
        r.receivedHash = hash; r.cursor = end.toString();
        s.revenues.push({ id: randomUUID(), hash, source: r.source, amount: r.amount, invoice: r.invoice, createdAt: new Date().toISOString(), simulated: false, sourceChain: r.sourceChain, bridged: false });
        event(s, 'CROSSCHAIN_REVENUE_VERIFIED', `${r.invoice}: ${hash}`); return true;
      });
      if (recorded) {
        await processVerifiedCrosschainRevenue(runtime, receivable.id);
        break;
      }
    }
    if (!recorded) store.change(s => { s.crosschainReceivables.find(r => r.id === receivable.id)!.cursor = end.toString(); });
  }
}
