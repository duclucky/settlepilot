import { randomUUID } from 'node:crypto';
import { CHAIN_ID } from './domain.ts';
import { event } from './store.ts';
import type { Runtime } from './config.ts';
import { runAdaptive } from './adaptive.ts';

export async function monitorRevenue(runtime: Runtime) {
  if (!runtime.arc || runtime.store.read().mode !== 'testnet') return;
  const { arc, store, engine } = runtime;
  const snapshot = await engine.gateway.snapshot();
  const head = BigInt(snapshot.block);
  for (const receivable of store.read().receivables.filter(r => !r.receivedHash)) {
    const from = BigInt(receivable.cursor) + 1n;
    if (from > head) continue;
    const end = from + 499n < head ? from + 499n : head;
    const hashes = await arc.incoming(receivable.source, store.read().policy.sender, from, end, receivable.amount);
    let recorded = false;
    for (const hash of hashes) {
      if (store.read().revenues.some(r => r.hash?.toLowerCase() === hash.toLowerCase())) continue;
      // An exact direct transfer from the registered payer is the MVP matching contract.
      // A mismatch or RPC error keeps the cursor unchanged for review/reconciliation.
      await arc.verify(hash, { sender: receivable.source, recipient: store.read().policy.sender, amount: receivable.amount, chainId: CHAIN_ID });
      recorded = store.change(s => {
        const r = s.receivables.find(r => r.id === receivable.id)!;
        if (r.receivedHash || s.revenues.some(other => other.hash?.toLowerCase() === hash.toLowerCase())) return false;
        r.receivedHash = hash; r.cursor = end.toString();
        s.revenues.push({ id: randomUUID(), hash, source: r.source, amount: r.amount, invoice: r.invoice, simulated: false, createdAt: new Date().toISOString() });
        s.snapshot = snapshot; event(s, 'REVENUE_VERIFIED', `${r.invoice}: ${hash}`); return true;
      });
      if (recorded) { await runAdaptive(runtime); break; }
    }
    if (!recorded) store.change(s => { s.receivables.find(r => r.id === receivable.id)!.cursor = end.toString(); });
  }
}
