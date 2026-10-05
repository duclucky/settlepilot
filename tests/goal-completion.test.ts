import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,money,type State,type PaymentGateway} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {AgentWorkspace} from '../src/agent-workspace.ts';
import {refreshGoalPlans} from '../src/goal-plans.ts';

function savedSettlement(mode:'testnet'|'simulation'='testnet'){
  const s=fixture();s.mode=mode;s.obligations=s.obligations.slice(0,1);
  const store=new Store(':memory:',s);
  new AgentWorkspace(store).recordPlan({obligationId:'A',objective:'Settle with independently verified proof.',steps:[{action:'PAY_NOW',reason:'Verify settlement.',sourceChain:null}]});
  const saved=store.read();store.close();
  saved.obligations[0].paid=true;saved.obligations[0].version++;
  saved.intents.push({id:'settlement',runId:'original-run',obligationId:'A',obligationVersion:1,
    policyVersion:saved.policy.version,amount:saved.obligations[0].amount,recipient:saved.obligations[0].recipient,
    sender:saved.policy.sender,chainId:5042002,idempotencyKey:'offline-proof',createdAt:new Date().toISOString(),
    settledAt:new Date().toISOString(),status:mode==='testnet'?'SETTLED':'SIMULATED',
    ...(mode==='testnet'?{hash:`0x${'a'.repeat(64)}`}:{})});
  return saved;
}

test('real engine reconciliation completes a goal on the pre-payment version and survives restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'settlepilot-goal-completion-')),path=join(dir,'state.db');
  const s=fixture();s.mode='testnet';s.obligations=s.obligations.slice(0,1);s.evidence=[];s.snapshot.balance=money('20');
  let store=new Store(path,s),submits=0,verified=false;
  const gateway:PaymentGateway={mode:'testnet',snapshot:async()=>({...s.snapshot,observedAt:new Date().toISOString()}),
    estimate:async()=>money('0.01'),submit:async()=>{submits++;return {providerId:'offline-provider'};},
    reconcile:async()=>verified?{status:'confirmed',hash:`0x${'b'.repeat(64)}`}:{status:'pending'}};
  try{
    new AgentWorkspace(store).recordPlan({obligationId:'A',objective:'Pay the accepted obligation.',steps:[{action:'PAY_NOW',reason:'Settle with verified receipt.',sourceChain:null}]});
    const planner={name:'Offline scripted planner',plan:async()=>[{obligationId:'A',action:'PAY_NOW' as const,reason:'Accepted and funded.',evidenceIds:[]}]};
    const engine=new Engine(store,gateway,planner);
    await engine.run();assert.equal(submits,1);assert.equal(store.read().obligations[0].paid,false);
    verified=true;await engine.reconcile();
    let final=store.read();assert.equal(final.obligations[0].version,2);assert.equal(final.intents[0].obligationVersion,1);
    assert.equal(final.autonomy!.plans![0].status,'COMPLETED');
    assert.equal(final.autonomy!.plans![0].steps[0].proofId,final.intents[0].id);
    assert.equal(final.autonomy!.plans![0].steps[0].status,'VERIFIED');
    await engine.reconcile();assert.equal(store.read().obligations[0].version,2);assert.equal(submits,1);
    store.close();store=new Store(path,s);
    store.change(refreshGoalPlans);final=store.read();assert.equal(final.autonomy!.plans![0].status,'COMPLETED');
    assert.equal(final.autonomy!.plans![0].needsReassessment,false);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('existing wrongly superseded settlement goals recover from stored proof without changing money',()=>{
  const s=savedSettlement();s.autonomy!.plans![0].status='SUPERSEDED';
  const before=JSON.stringify([s.obligations,s.intents,s.snapshot,s.approvals,s.policy]);
  refreshGoalPlans(s);
  assert.equal(s.autonomy!.plans![0].status,'COMPLETED');
  assert.equal(s.autonomy!.plans![0].steps[0].status,'VERIFIED');
  assert.equal(s.autonomy!.plans![0].steps[0].proofId,'settlement');
  assert.equal(JSON.stringify([s.obligations,s.intents,s.snapshot,s.approvals,s.policy]),before);
  refreshGoalPlans(s);assert.equal(s.autonomy!.plans![0].status,'COMPLETED');
});

test('amendments, unverified outcomes and mismatched identities cannot complete a historical goal',()=>{
  const mutations:((s:State)=>void)[]=[
    s=>{s.obligations[0].version=3;},s=>{s.obligations[0].paid=false;},
    s=>{s.obligations[0].amount='1';},s=>{s.obligations[0].recipient=s.policy.sender;},
    s=>{s.intents[0].obligationVersion=2;},s=>{s.intents[0].policyVersion++;},
    s=>{s.intents[0].sender=s.obligations[0].recipient;},s=>{s.intents[0].chainId=1 as 5042002;},
    s=>{s.intents[0].status='HASH_OBSERVED';},s=>{s.intents[0].status='EXECUTION_UNKNOWN';},
    s=>{delete s.intents[0].hash;},s=>{s.intents[0].status='SIMULATED';},
    s=>{s.obligations[0].archived=true;},
  ];
  for(const [index,mutate] of mutations.entries()){
    const s=savedSettlement();mutate(s);refreshGoalPlans(s);
    assert.notEqual(s.autonomy!.plans![0].status,'COMPLETED',`mutation ${index}`);
    assert.notEqual(s.autonomy!.plans![0].steps[0].status,'VERIFIED',`mutation ${index}`);
  }
});

test('simulation completion remains labelled simulated after the same reconciliation version increment',()=>{
  const s=savedSettlement('simulation');refreshGoalPlans(s);
  assert.equal(s.autonomy!.plans![0].status,'COMPLETED');
  assert.equal(s.autonomy!.plans![0].steps[0].status,'SIMULATED');
  assert.equal(s.intents.length,1);
});
