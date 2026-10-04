import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { observeChain, type ObserverReader } from '../src/chain-observer.ts';
test('observer starts at connection block and checkpoint commits only after valid proof',async()=>{
  const store=new Store(':memory:',fixture());let head=10;let fail=false;
  const reader:ObserverReader={head:async()=>({number:String(head),hash:`b${head}`,balance:'0'}),blockHash:async b=>`b${b}`,incoming:async()=>{if(fail)throw new Error('RPC');return [{id:'deposit',chain:'ARC-TESTNET',hash:'h',logIndex:0,sender:`0x${'9'.repeat(40)}`,recipient:store.read().policy.sender,amount:'1',block:String(head),blockHash:`b${head}`,status:'VERIFIED',classification:'UNMATCHED'}];}};
  await observeChain(store,'ARC-TESTNET',reader);head=11;fail=true;
  await assert.rejects(observeChain(store,'ARC-TESTNET',reader));assert.equal(store.read().autonomy!.checkpoints[0].nextBlock,'11');
  fail=false;await observeChain(store,'ARC-TESTNET',reader);await observeChain(store,'ARC-TESTNET',reader);
  assert.equal(store.read().autonomy!.transfers.length,1);assert.equal(store.read().autonomy!.transfers[0].classification,'UNMATCHED');store.close();
});
