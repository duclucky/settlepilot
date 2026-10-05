import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { SimulationGateway } from '../src/adapters/simulation.ts';
import { RulesPlanner } from '../src/planner.ts';
import { AgentScheduler } from '../src/scheduler.ts';
test('scheduler coalesces events, wakes autonomously, and does not call planner during idle ticks',async()=>{
  const s=fixture();s.obligations=[];s.evidence=[];const store=new Store(':memory:',s);let calls=0;
  const engine=new Engine(store,new SimulationGateway(store),{name:'test',plan:async state=>{calls++;return new RulesPlanner().plan(state);}});
  const runtime={store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'};
  const scheduler=new AgentScheduler(runtime);
  for(let i=0;i<100;i++)scheduler.wake('SOURCE_UPDATED','same');await scheduler.tick();
  assert.equal(calls,1);assert.equal(store.read().autonomy!.jobs.length,1);
  for(let i=0;i<10;i++)await scheduler.tick();assert.equal(calls,1);
  store.close();
});

test('permanent model failures stop whole-plan retries on the first failed job',async()=>{
 const s=fixture();s.obligations=[];s.evidence=[];const store=new Store(':memory:',s);let calls=0;
 const engine=new Engine(store,new SimulationGateway(store),{name:'AI test',plan:async()=>{calls++;throw new Error('MODEL_CREDIT_EXHAUSTED');}});
 const scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'});
 try{scheduler.wake('SOURCE_UPDATED','billing');await scheduler.tick();await scheduler.tick();assert.equal(calls,1);assert.equal(store.read().autonomy!.jobs[0].status,'NEEDS_ATTENTION');assert.equal(store.read().runs[0].failureCode,'MODEL_CREDIT_EXHAUSTED');}finally{store.close();}
});

test('a provider cooldown blocks fresh wakeups and survives changed job keys',async()=>{
 const s=fixture();s.obligations=[];s.evidence=[];const store=new Store(':memory:',s);let calls=0;let now=1000;
 store.change(s=>s.modelControl={requests:[],blocks:{planner:{code:'MODEL_RATE_LIMITED',at:now,retryAt:now+300000}}});
 const engine=new Engine(store,new SimulationGateway(store),{name:'AI test',plan:async()=>{calls++;return [];}});
 const scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'},()=>now);
 try{for(let i=0;i<10;i++)scheduler.wake('SOURCE_UPDATED',String(i));await scheduler.tick();assert.equal(calls,0);now+=300001;await scheduler.tick();assert.equal(calls,1);}finally{store.close();}
});
