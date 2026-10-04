import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { monitorRevenue } from '../src/revenue.ts';
import type { Runtime } from '../src/config.ts';

test('registered incoming payment triggers one run despite duplicate emitter logs and repeated polling', async () => {
  const s=fixture(); s.mode='testnet';
  s.receivables.push({id:'invoice-1',source:s.obligations[0].recipient,amount:money('10'),invoice:'INV-001',cursor:'9',createdAt:new Date().toISOString()});
  const store=new Store(':memory:',s); let runs=0; let verifies=0;
  const hash=`0x${'a'.repeat(64)}`;
  const runtime={store,arc:{incoming:async()=>[hash,hash],verify:async()=>{verifies++;}},engine:{gateway:{snapshot:async()=>({...s.snapshot,balance:money('16'),block:'10'})},run:async()=>{runs++;}}} as unknown as Runtime;
  await Promise.all([monitorRevenue(runtime),monitorRevenue(runtime)]);
  await monitorRevenue(runtime);
  assert.equal(runs,1); assert.equal(store.read().revenues.length,1); assert.equal(store.read().receivables[0].receivedHash,hash);
  assert.ok(verifies>=1); store.close();
});
test('unverified incoming transfer does not change cursor, revenue, or initiate payments', async () => {
  const s=fixture(); s.mode='testnet'; s.receivables.push({id:'i',source:s.obligations[0].recipient,amount:money('10'),invoice:'I',cursor:'9',createdAt:new Date().toISOString()});
  const store=new Store(':memory:',s); let runs=0;
  const runtime={store,arc:{incoming:async()=>['hash'],verify:async()=>{throw new Error('invalid receipt');}},engine:{gateway:{snapshot:async()=>({...s.snapshot,block:'10'})},run:async()=>{runs++;}}} as unknown as Runtime;
  await assert.rejects(monitorRevenue(runtime)); assert.equal(runs,0); assert.equal(store.read().revenues.length,0); assert.equal(store.read().receivables[0].cursor,'9'); store.close();
});
