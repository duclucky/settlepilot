import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money, type SourceChain } from '../src/domain.ts';
import { availableCrosschainUnits } from '../src/policy.ts';
import { Store } from '../src/store.ts';
import { refreshCrosschainBalances, type SourceBalanceReader } from '../src/treasury.ts';
import { decisionKey } from '../src/scheduler-core.ts';
import { recoveryContext } from '../src/autonomy-recovery.ts';

test('treasury refresh verifies every configured source independently and excludes failed RPCs', async () => {
  const state = fixture();
  state.bridgePolicy.enabled = true;
  state.bridgePolicy.sourceChains = ['AVAX-FUJI', 'BASE-SEPOLIA', 'UNI-SEPOLIA'];
  const store = new Store(':memory:', state);
  const reader = (chainId: number, balance: string): SourceBalanceReader => ({ snapshot: async () => ({ balance, chainId, block: '7', observedAt: new Date().toISOString() }) });
  const sources = new Map<SourceChain, SourceBalanceReader>([
    ['AVAX-FUJI', reader(43113, money('2.5'))],
    ['BASE-SEPOLIA', { snapshot: async () => { throw new Error('RPC_DOWN'); } }],
    ['UNI-SEPOLIA', reader(1301, money('4.25'))],
  ]);
  const balances = await refreshCrosschainBalances(store, sources, true);
  assert.equal(balances.filter(item => item.status === 'VERIFIED').length, 2);
  assert.equal(balances.find(item => item.sourceChain === 'BASE-SEPOLIA')?.status, 'UNAVAILABLE');
  assert.equal(availableCrosschainUnits(store.read()), money('6.75'));
  store.close();
});

test('disabled CCTP invalidates cached source liquidity', async () => {
  const state = fixture(); state.bridgePolicy.enabled = true;
  state.crosschainBalances.push({ sourceChain: 'AVAX-FUJI', balance: money('9'), chainId: 43113, block: '1', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  const store = new Store(':memory:', state);
  await refreshCrosschainBalances(store, new Map(), false);
  assert.equal(availableCrosschainUnits(store.read()), '0');
  assert.ok(store.read().crosschainBalances.every(item => item.status === 'UNAVAILABLE'));
  store.close();
});

test('source balances remain observed when execution is disabled without becoming funding liquidity', async () => {
  const state=fixture();state.bridgePolicy.enabled=true;state.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  const store=new Store(':memory:',state);let reads=0;
  const sources=new Map<SourceChain,SourceBalanceReader>([['BASE-SEPOLIA',{snapshot:async()=>{reads++;return {balance:money('11'),chainId:84532,block:'7',observedAt:new Date().toISOString()};}}]]);
  const balances=await refreshCrosschainBalances(store,sources,false);
  assert.equal(reads,1);assert.equal(balances[0].status,'VERIFIED');assert.equal(balances[0].balance,money('11'));
  assert.equal(availableCrosschainUnits(store.read()),'0');
  assert.deepEqual(recoveryContext(store.read()).unavailableSourceChains,[]);
  assert.equal(recoveryContext(store.read()).sourceObservations[0].spendable,false);
  const before=store.read(),key=decisionKey(before);
  await refreshCrosschainBalances(store,sources,true);
  assert.equal(availableCrosschainUnits(store.read()),money('11'));
  assert.ok(store.read().financialVersion>before.financialVersion);assert.notEqual(decisionKey(store.read()),key);
  store.close();
});

test('disabled bridge policy still allows read-only source balance verification',async()=>{
  const state=fixture();state.bridgePolicy.enabled=false;state.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  const store=new Store(':memory:',state);
  await refreshCrosschainBalances(store,new Map([['BASE-SEPOLIA',{snapshot:async()=>({balance:money('3'),chainId:84532,block:'8',observedAt:new Date().toISOString()})}]]),false);
  assert.equal(store.read().crosschainBalances[0].status,'VERIFIED');assert.equal(availableCrosschainUnits(store.read()),'0');store.close();
});
