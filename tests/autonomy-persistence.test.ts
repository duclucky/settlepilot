import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {RulesPlanner} from '../src/planner.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';
import {AgentScheduler} from '../src/scheduler.ts';
import {syncActionRequests,respondToAction} from '../src/action-requests.ts';
import {evaluate} from '../src/policy.ts';
test('SQLite reopen preserves denial, response, pending intents and disabled default without resubmission',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tameion-state-')),path=join(root,'agent.db');let store=new Store(path,fixture());
  try{
    store.change(s=>s.evidenceRequests.push({id:'request',runId:'old',obligationId:'C',obligationVersion:1,requestedFrom:'PROJECT_OWNER',question:'Confirm?',status:'OPEN',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}));
    syncActionRequests(store);const request=store.read().autonomy!.requests[0];respondToAction(store,request.id,{responseId:randomUUID(),digest:request.digest,kind:'CANCEL'});
    const responses=store.read().autonomy!.responses;store.close();store=new Store(path,fixture());syncActionRequests(store);
    assert.deepEqual(store.read().autonomy!.responses,responses);assert.equal(evaluate(store.read(),store.read().obligations[2]),'OWNER_REJECTED');assert.equal(store.read().autonomy!.enabled,false);
    store.close();store=new Store(path,fixture());assert.equal(store.read().autonomy!.requests[0].status,'REJECTED');
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('separate SQLite connections enforce one wallet scheduler lease',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tameion-lease-')),path=join(root,'agent.db');const s=fixture();s.obligations=[];s.evidence=[];
  const one=new Store(path,s),two=new Store(path,s);let release!:()=>void;let started!:()=>void;let calls=0;
  const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
  const make=(store:Store)=>({store,engine:new Engine(store,new SimulationGateway(store),{name:'slow fixture',plan:async state=>{calls++;started();await gate;return new RulesPlanner().plan(state);}}),arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'});
  try{const a=new AgentScheduler(make(one)),b=new AgentScheduler(make(two));a.wake('SOURCE');const running=a.tick();await entered;b.wake('OTHER_SOURCE');await b.tick();assert.equal(calls,1);release();await running;await b.tick();assert.equal(calls,1);}
  finally{release?.();one.close();two.close();await rm(root,{recursive:true,force:true});}
});
