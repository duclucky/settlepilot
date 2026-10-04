import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, money } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { RulesPlanner } from '../src/planner.ts';
import { SimulationGateway } from '../src/adapters/simulation.ts';
import { createApp } from '../src/app.ts';
import { createDecisionRecord, exportDecisionRecord, verifyDecisionRecord } from '../src/decision-record.ts';

test('decision record survives restart, freezes context and detects changed money, evidence or choices',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'settlepilot-proof-')),path=join(dir,'state.db');let store=new Store(path,fixture());
  try{
    const engine=new Engine(store,new SimulationGateway(store),new RulesPlanner(),false);
    const id=await engine.plan();const original=exportDecisionRecord(store.read(),id);
    assert.equal(verifyDecisionRecord(original.record),true);
    assert.equal(JSON.stringify(original).includes('The project owner accepted'),false);
    store.change(s=>{s.policy.reserve=money('99');s.obligations[0].amount=money('99');});
    store.close();store=new Store(path,fixture());
    assert.deepEqual(exportDecisionRecord(store.read(),id).record,original.record);
    const modified=structuredClone(original.record);modified.payload.context.obligations[0].amount='1';
    assert.equal(verifyDecisionRecord(modified),false);
    modified.payload.context.obligations[0].amount=original.record.payload.context.obligations[0].amount;
    modified.payload.decisions[0].action='HOLD';assert.equal(verifyDecisionRecord(modified),false);
    assert.equal(original.integrityOnly,true);assert.equal(original.settlementIndependentlyVerifiedByExport,false);
    assert.equal(store.read().intents.length,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('record is written before submission and simulated outcomes remain separate from the decision digest',async()=>{
  const s=fixture();s.snapshot.balance=money('20');s.obligations=[s.obligations[0]];
  const store=new Store(':memory:',s),gateway=new SimulationGateway(store);let observed=false;
  const original=gateway.submit.bind(gateway);gateway.submit=async intent=>{observed=verifyDecisionRecord(store.read().runs.find(r=>r.id===intent.runId)?.decisionRecord);return original(intent);};
  try{
    const id=await new Engine(store,gateway,new RulesPlanner()).run();const result=exportDecisionRecord(store.read(),id);
    assert.equal(observed,true);assert.equal(result.execution.payments[0].status,'SIMULATED');
    assert.equal(result.execution.payments[0].hash,undefined);
    assert.equal(result.record.payload.context.obligations[0].paid,false);assert.equal(store.read().obligations[0].paid,true);
    assert.equal(verifyDecisionRecord(result.record),true);
  }finally{store.close();}
});

test('local decision export requires a session and old runs have no fabricated records',async()=>{
  const store=new Store(':memory:',fixture()),engine=new Engine(store,new SimulationGateway(store),new RulesPlanner(),false);
  const server=createApp({store,engine,arc:undefined,sources:undefined,bridge:undefined,sendEnabled:false,bridgeEnabled:false,useModel:false,walletProvider:'simulation'},'test-session').listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/runs/`;
  try{
    const id=await engine.plan();assert.equal((await fetch(base+id+'/decision-record')).status,401);
    const response=await fetch(base+id+'/decision-record',{headers:{Authorization:'Bearer test-session'}});
    assert.equal(response.status,200);assert.equal(verifyDecisionRecord((await response.json()).record),true);
    const view=await (await fetch(base.replace('/runs/','/state'),{headers:{Authorization:'Bearer test-session'}})).json();
    assert.equal(view.runs[0].decisionRecord,undefined);assert.equal(view.runs[0].decisionRecordSummary.sha256,store.read().runs[0].decisionRecord?.sha256);
    assert.equal((await fetch(base+'old-run/decision-record',{headers:{Authorization:'Bearer test-session'}})).status,404);
    const bad=createDecisionRecord(fixture(),'run','rules',[]);(bad.payload as any).format='unknown';assert.equal(verifyDecisionRecord(bad),false);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));store.close();}
});
