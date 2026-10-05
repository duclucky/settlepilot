import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {RulesPlanner} from '../src/planner.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';
import {createApp} from '../src/app.ts';

test('archived model usage is owner-only, paginated and cannot be read with unbounded page sizes',async()=>{
 const store=new Store(':memory:',fixture()),engine=new Engine(store,new SimulationGateway(store),new RulesPlanner());
 store.change(()=>store.archiveModelRequests([1,2].map(i=>({id:`archived-${i}`,runId:'closed',provider:'planner',model:'test',at:0,status:'COMPLETE',reservedTokens:2,usage:{inputTokens:1,outputTokens:1,cachedTokens:0,reasoningTokens:0}}))));
 const runtime={store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'}as const;
 const server=createApp(runtime,'owner').listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address()as any).port}`,headers={Authorization:'Bearer owner'};
 try{assert.equal((await fetch(base+'/api/model-usage/archive')).status,401);assert.equal((await fetch(base+'/api/model-usage/archive?limit=10000',{headers})).status,400);const first=await(await fetch(base+'/api/model-usage/archive?limit=1',{headers})).json();const second=await(await fetch(base+`/api/model-usage/archive?limit=1&after=${first.nextCursor}`,{headers})).json();assert.equal(first.count,2);assert.equal(first.records[0].id,'archived-1');assert.equal(second.records[0].id,'archived-2');}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});


test('block reset cannot interfere with an active evaluation', async () => {
 const state=fixture();state.paused=true;
 state.runs.push({id:'active',createdAt:new Date().toISOString(),source:'fixture',status:'RUNNING',decisions:[]});
 state.modelControl={requests:[],blocks:{planner:{code:'MODEL_AUTH_FAILED',at:Date.now()}}};
 const store=new Store(':memory:',state),engine=new Engine(store,new SimulationGateway(store),new RulesPlanner());
 const runtime={store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'} as const;
 const server=createApp(runtime,'owner').listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try {
  const response=await fetch(base+'/api/model-usage/reset-blocks',{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:'{"confirmed":true}'});
  assert.equal(response.status,400);
  assert.equal((await response.json()).error,'AGENT_RUN_IN_PROGRESS');
  assert.equal(store.read().modelControl!.blocks.planner!.code,'MODEL_AUTH_FAILED');
  assert.equal(store.read().paused,true);
 } finally { await new Promise<void>(resolve=>server.close(()=>resolve()));store.close(); }
});
