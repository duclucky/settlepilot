import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { IndependentWorkers } from '../src/worker-health.ts';
import { AutonomousOperations } from '../src/operations.ts';
import type { Runtime } from '../src/config.ts';
test('failed RPC worker cannot skip Telegram and retries with durable backoff',async()=>{
  const store=new Store(':memory:',fixture());let alerts=0,calls=0;const workers=new IndependentWorkers(store,()=>1000);
  await Promise.all([workers.run('chain',async()=>{calls++;throw new Error('secret provider body');}),workers.run('telegram',async()=>{alerts++;})]);
  await workers.run('chain',async()=>{calls++;});assert.equal(alerts,1);assert.equal(calls,1);
  assert.equal(store.read().autonomy!.workers.find(w=>w.name==='chain')!.error,'SOURCE_OR_PROVIDER_UNAVAILABLE');store.close();
});

test('Arc wallet connection failure cannot skip independent source balance observation',async()=>{
  const state=fixture();state.mode='testnet';state.bridgePolicy.enabled=false;state.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  const store=new Store(':memory:',state);let sourceReads=0;
  const runtime={store,bridgeEnabled:false,engine:{reconcile:async()=>{},gateway:{snapshot:async()=>{throw Error('WALLET_NOT_CONNECTED');}}},sources:new Map([['BASE-SEPOLIA',{snapshot:async()=>{sourceReads++;return {balance:'3000000',chainId:84532,block:'1',observedAt:new Date().toISOString()};}}]])} as unknown as Runtime;
  await new AutonomousOperations(runtime).tick();
  assert.equal(sourceReads,1);assert.equal(store.read().crosschainBalances[0].balance,'3000000');
  assert.equal(store.read().autonomy!.workers.find(w=>w.name==='treasury')?.status,'DEGRADED');store.close();
});
