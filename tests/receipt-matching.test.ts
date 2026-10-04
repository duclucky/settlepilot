import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { ingestSource } from '../src/ingestion.ts';
import { matchReceipts } from '../src/receipt-matching.ts';
test('partial receipts allocate once and ambiguity never chooses an invoice by amount',()=>{
  const store=new Store(':memory:',fixture());const address=`0x${'9'.repeat(40)}`;
  const record={externalId:'a',revision:1,kind:'RECEIVABLE',partyId:'customer',title:'Invoice',amount:'2',due:new Date().toISOString()};
  ingestSource(store,{sourceId:'books',parties:[{id:'customer',name:'Customer',address}],records:[record]},true);
  store.change(s=>{s.autonomy!.transfers.push({id:'one',chain:'ARC-TESTNET',hash:`0x${'a'.repeat(64)}`,logIndex:0,sender:address,recipient:s.policy.sender,amount:'1000000',block:'1',blockHash:'b',status:'VERIFIED',classification:'UNMATCHED'});matchReceipts(s);matchReceipts(s);});
  assert.equal(store.read().autonomy!.allocations.length,1);assert.equal(store.read().revenues[0].amount,'1000000');
  ingestSource(store,{sourceId:'books',records:[{...record,externalId:'b'}]},true);
  store.change(s=>{s.autonomy!.transfers.push({...s.autonomy!.transfers[0],id:'two',classification:'UNMATCHED'});matchReceipts(s);});
  assert.equal(store.read().autonomy!.allocations.length,1);store.close();
});
