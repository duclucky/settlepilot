import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { syncActionRequests, respondToAction } from '../src/action-requests.ts';
import { ingestSource } from '../src/ingestion.ts';
test('A trusted source cannot silently introduce an unapproved payout recipient',()=>{
  const store=new Store(':memory:',fixture());
  ingestSource(store,{sourceId:'export',parties:[{id:'new',name:'New contractor',address:'0x9999999999999999999999999999999999999999'}],records:[{externalId:'bill',revision:1,kind:'OBLIGATION',partyId:'new',title:'Delivery',amount:'1',due:'2026-10-04T00:00:00.000Z',acceptance:'ACCEPTED'}]},true);
  syncActionRequests(store);
  assert.equal(store.read().obligations.some(o=>o.id==='export-bill'),false);
  assert.equal(store.read().autonomy!.requests.some(r=>r.scope==='export:bill'&&r.status==='OPEN'&&r.kind==='OPERATION'),true);
  store.close();
});
function setup(){const store=new Store(':memory:',fixture());store.change(s=>s.evidenceRequests.push({id:'legacy',runId:'run',obligationId:'C',obligationVersion:1,requestedFrom:'PROJECT_OWNER',question:'Confirm delivery',status:'OPEN',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}));syncActionRequests(store);return store;}

test('stale owner proposal is withdrawn before request creation without granting approval',()=>{
  const s=fixture();
  s.agentNotifications.push({id:'stale',runId:'old-run',type:'USER_DECISION_REQUIRED',status:'OPEN',title:'Reserve exception',message:'Approve?',issues:[{obligationId:'A',reason:'RESERVE_CONFLICT'}],createdAt:new Date().toISOString(),obligationVersion:s.obligations[0].version,policyVersion:s.policy.version,stateVersion:s.financialVersion-1});
  const store=new Store(':memory:',s);syncActionRequests(store);
  const state=store.read();assert.equal(state.agentNotifications[0].status,'RESOLVED');
  assert.equal(state.agentNotifications[0].resolution,undefined);assert.equal(state.approvals.length,0);assert.equal(state.autonomy!.requests.length,0);
  store.close();
});

test('unknown bridge keeps one owner request through treasury changes and withdraws it on settlement',()=>{
  const s=fixture();s.bridgeIntents.push({id:'bridge',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:'45001',fee:'19135',totalBurn:'64136',policyVersion:1,idempotencyKey:randomUUID(),status:'EXECUTION_UNKNOWN',createdAt:new Date().toISOString()});
  const store=new Store(':memory:',s);syncActionRequests(store);const first=store.read().autonomy!.requests[0];
  store.change(s=>{s.snapshot.balance='110000';s.crosschainBalances.push({sourceChain:'BASE-SEPOLIA',chainId:84532,balance:'11000000',block:'1',observedAt:new Date().toISOString(),status:'VERIFIED'});});
  syncActionRequests(store);assert.equal(store.read().autonomy!.requests.length,1);assert.equal(store.read().autonomy!.requests[0].id,first.id);assert.equal(store.read().autonomy!.requests[0].status,'OPEN');
  store.change(s=>{s.bridgeIntents[0].burnHash=`0x${'a'.repeat(64)}`;});syncActionRequests(store);
  assert.equal(store.read().autonomy!.requests.length,1);assert.equal(store.read().autonomy!.requests[0].id,first.id);assert.notEqual(store.read().autonomy!.requests[0].digest,first.digest);
  assert.throws(()=>respondToAction(store,first.id,{responseId:randomUUID(),kind:'COMMENT',digest:first.digest,comment:'Inspect the receipt'}),/STALE/);
  syncActionRequests(store);
  const current=store.read().autonomy!.requests.find(r=>r.status==='OPEN')!;
  store.change(s=>{s.autonomy!.requests.push({...current,id:randomUUID(),digest:'a'.repeat(64)});});syncActionRequests(store);
  assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN').length,1);
  store.change(s=>{s.bridgeIntents[0].status='SETTLED';});syncActionRequests(store);
  assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN').length,0);assert.equal(store.read().approvals.length,0);store.close();
});
test('Cancel rejects the proposal without manufacturing dispute or acceptance; replay is idempotent',()=>{
  const store=setup(),r=store.read().autonomy!.requests[0],before=store.read().obligations[2];
  const reply={responseId:randomUUID(),kind:'CANCEL',digest:r.digest};respondToAction(store,r.id,reply);respondToAction(store,r.id,reply);
  assert.equal(store.read().autonomy!.responses.length,1);assert.deepEqual(store.read().obligations[2],before);assert.equal(store.read().autonomy!.requests[0].status,'REJECTED');store.close();
});
test('Comment-only creates a wakeup without granting payment authority; stale approval fails',()=>{
  const store=setup(),r=store.read().autonomy!.requests[0];
  respondToAction(store,r.id,{responseId:randomUUID(),kind:'COMMENT',digest:r.digest,comment:'Wait until tomorrow; prioritize B.'});
  assert.equal(store.read().approvals.length,0);assert.equal(store.read().obligations[2].accepted,false);assert.equal(store.read().autonomy!.jobs.length,1);
  syncActionRequests(store);const next=store.read().autonomy!.requests.find(r=>r.status==='OPEN');
  if(next){store.change(s=>{s.snapshot.balance='1';});assert.throws(()=>respondToAction(store,next.id,{responseId:randomUUID(),kind:'APPROVE',digest:next.digest}),/STALE/);}
  store.close();
});
