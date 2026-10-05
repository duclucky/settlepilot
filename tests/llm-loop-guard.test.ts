import test from 'node:test';import assert from 'node:assert/strict';
import {ModelPlanner} from '../src/adapters/model.ts';import {AgentWorkspace} from '../src/agent-workspace.ts';
import {Store} from '../src/store.ts';import {fixture} from '../src/domain.ts';
import {ModelRequests,defaultModelLimits} from '../src/model-requests.ts';
import {AgentScheduler} from '../src/scheduler.ts';import {Engine} from '../src/engine.ts';import {SimulationGateway} from '../src/adapters/simulation.ts';
import {runAdaptive} from '../src/adaptive.ts';import type {Runtime} from '../src/config.ts';import {evaluationKey} from '../src/evaluation-control.ts';
import {operationalReadiness} from '../src/operational-readiness.ts';
import {emptyAutonomy} from '../src/autonomy-types.ts';
import {AgentEscalationError} from '../src/agent-escalation.ts';
import {syncActionRequests} from '../src/action-requests.ts';
test('empty portfolios make zero model requests',async()=>{const s=fixture();s.obligations=[];let calls=0;const planner=new ModelPlanner('fake','gpt-5.4-mini',async()=>{calls++;throw Error('SHOULD_NOT_CALL');});assert.deepEqual(await planner.plan(s),[]);assert.equal(calls,0);});
for(const kind of ['same-read','changing-errors']as const)test(`model stops without progress even when arguments change formatting: ${kind}`,async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,1);const store=new Store(':memory:',s);let calls=0;
 const send=(async()=>{calls++;const args=kind==='same-read'?JSON.stringify({name:'settle-obligations'},null,calls):JSON.stringify({obligationIds:[`missing-${calls}`]});return new Response(JSON.stringify({usage:{input_tokens:100,output_tokens:50},output:[{type:'function_call',call_id:`c${calls}`,name:kind==='same-read'?'read_skill':'check_policy',arguments:args}]}));})as typeof fetch;
 try{await assert.rejects(()=>new ModelPlanner('fake','gpt-5.4-mini',send,new AgentWorkspace(store)).plan(s),/MODEL_NO_PROGRESS|MODEL_REPEATED_TOOL_CALL/);assert.ok(calls<=3,`expected <=3 calls, got ${calls}`);}finally{store.close();}
});
test('temporary HTTP failure makes one call and waits for durable cooldown rather than retrying immediately',async()=>{
 const store=new Store(':memory:',fixture());let calls=0;const meter=new ModelRequests(store,defaultModelLimits,()=>1000);
 const send=(async()=>{calls++;return new Response('{}',{status:503});})as typeof fetch;
 try{await assert.rejects(()=>meter.request('planner','gpt-5.4-mini','https://offline.example',{body:JSON.stringify({max_output_tokens:1,input:'x'})},send),/MODEL_TEMPORARILY_UNAVAILABLE/);assert.equal(calls,1);assert.equal(meter.snapshot().blocks.planner?.retryAt,301000);}finally{store.close();}
});
test('recheck jobs with unchanged business facts do not spend on another evaluation',async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,1);const store=new Store(':memory:',s);let calls=0;
 const planner={name:'offline counter',plan:async()=>{calls++;return [{obligationId:'A',action:'HOLD' as const,reason:'Wait for actual funds',evidenceIds:['e-a']}];}};
 const engine=new Engine(store,new SimulationGateway(store),planner);const scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'});
 try{scheduler.wake('SOURCE_UPDATED','initial');await scheduler.tick();for(let i=0;i<10;i++){scheduler.wake('AGENT_RECHECK',`recheck-${i}`);await scheduler.tick();}assert.equal(calls,1);store.change(s=>s.snapshot.balance='7000000');scheduler.wake('MATERIAL_BALANCE_CHANGED','money');await scheduler.tick();assert.equal(calls,2);}finally{store.close();}
});
test('continuously changing funds cannot recursively trigger nine paid planning runs',async()=>{
 const s=fixture();s.mode='testnet';s.policy.reserve='0';s.policy.gasLimit='0';s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];s.obligations=s.obligations.slice(0,1);
 const store=new Store(':memory:',s);let calls=0,reads=0;const gateway={mode:'testnet' as const,snapshot:async()=>({...s.snapshot,observedAt:new Date().toISOString()}),estimate:async()=> '0',submit:async()=>{throw Error('NO_TRANSFER');},reconcile:async()=>({status:'pending' as const})};
 const engine=new Engine(store,gateway,{name:'offline LLM counter',plan:async()=>{calls++;return [{obligationId:'A',action:'HOLD',reason:'Wait for stable funds',evidenceIds:['e-a']}];}});
 const sources=new Map([['BASE-SEPOLIA' as const,{snapshot:async()=>({chainId:84532,balance:String(1000000+reads++),block:String(reads),observedAt:new Date().toISOString()})}]]);
 const runtime={store,engine,sources,bridge:{fundFromInventory:async()=>{throw Error('NO_BRIDGE');}},bridgeEnabled:true,arc:undefined,sendEnabled:false,useModel:true,walletProvider:'agent'}as unknown as Runtime;
 try{const result=await runAdaptive(runtime);assert.ok(calls<=2,`expected <=2 evaluations, got ${calls}`);const run=store.read().runs.find(r=>r.id===result.runId)!;assert.equal(run.failureCode,'MODEL_NO_PROGRESS');assert.equal(run.executionStatus,'INVALIDATED');assert.equal(store.read().intents.length,0);}finally{store.close();}
});
test('freshness changes are meaningful, but cannot reset failed-model retry allowance',()=>{const s=fixture(),now=Date.now();s.mode='testnet';s.snapshot.observedAt=new Date(now-60000).toISOString();const stale=evaluationKey(s,now),failure=evaluationKey(s,now,false);s.snapshot.observedAt=new Date(now).toISOString();assert.notEqual(evaluationKey(s,now),stale);assert.equal(evaluationKey(s,now,false),failure);const fresh=evaluationKey(s,now);s.snapshot.observedAt=new Date(now+1).toISOString();assert.equal(evaluationKey(s,now),fresh);});
test('funds arriving during a plan are evaluated once on the next wake, then unchanged wakes are free',async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,1);const store=new Store(':memory:',s);let calls=0;
 const engine=new Engine(store,new SimulationGateway(store),{name:'offline counter',plan:async()=>{calls++;if(calls===1)store.change(s=>s.snapshot.balance='9000000');return [{obligationId:'A',action:'HOLD',reason:'Wait',evidenceIds:['e-a']}];}});
 const scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'});
 try{scheduler.wake('SOURCE_UPDATED','first');await scheduler.tick();scheduler.wake('BRIDGE_SETTLED_CONTINUATION','settled');await scheduler.tick();assert.equal(calls,2);for(let i=0;i<10;i++){scheduler.wake('AGENT_RECHECK',`same-${i}`);await scheduler.tick();}assert.equal(calls,2);}finally{store.close();}
});
test('writing ever-changing memory notes cannot disguise a stalled financial evaluation',async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,1);const store=new Store(':memory:',s);let calls=0;
 const send=(async()=>{calls++;return new Response(JSON.stringify({output:[{type:'function_call',call_id:`note-${calls}`,name:'memory',arguments:JSON.stringify({action:'add',entryId:null,kind:'LESSON',content:`Unique but irrelevant note ${calls}`})}]}));})as typeof fetch;
 try{await assert.rejects(()=>new ModelPlanner('fake','gpt-5.4-mini',send,new AgentWorkspace(store)).plan(s),/MODEL_NO_PROGRESS/);assert.ok(calls<=3,`expected <=3 calls, got ${calls}`);}finally{store.close();}
});
test('an unchanged stalled evaluation is visibly stopped, and new facts remove the old status',()=>{
 const s=fixture(),now=Date.now();s.autonomy=emptyAutonomy();s.autonomy.enabled=true;s.autonomy.evaluationFailure={key:evaluationKey(s,now,false),attempts:1,code:'MODEL_NO_PROGRESS',jobId:'failed'};
 const flags={sendEnabled:false,bridgeEnabled:false,modelEnabled:true};assert.equal(operationalReadiness(s,flags,now).code,'EVALUATION_BLOCKED');s.snapshot.balance='9000000';assert.equal(operationalReadiness(s,flags,now).code,'MONITORING');
});
test('owner delay and exact approval expiry are meaningful transitions without per-tick spending',()=>{
 const s=fixture(),now=Date.now();s.autonomy=emptyAutonomy();s.autonomy.deferredUntil={A:now+1000};s.policy.authorityExpiresAt=new Date(now+10000).toISOString();
 const initial=evaluationKey(s,now);assert.equal(evaluationKey(s,now+500),initial);assert.notEqual(evaluationKey(s,now+1001),initial);
 s.autonomy.deferredUntil={};const withoutApproval=evaluationKey(s,now);s.approvals.push({id:'exact',obligationId:'A',obligationVersion:1,policyVersion:1,stateVersion:0,actor:'owner',expiresAt:new Date(now+1000).toISOString()});assert.notEqual(evaluationKey(s,now),withoutApproval);assert.equal(evaluationKey(s,now+1001),withoutApproval);assert.notEqual(evaluationKey(s,now+10001),withoutApproval);
});
test('an unresolved policy conflict stops resampling and creates only its scoped owner question',async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,1);s.snapshot.balance='0';const store=new Store(':memory:',s);let calls=0;
 const engine=new Engine(store,new SimulationGateway(store),{name:'offline counter',plan:async()=>{calls++;throw new AgentEscalationError([{obligationId:'A',reason:'INSUFFICIENT_FUNDS'}]);}});
 const scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'});
 try{scheduler.wake('SOURCE_UPDATED','initial');await scheduler.tick();for(let i=0;i<10;i++){scheduler.wake('AGENT_RECHECK',`conflict-${i}`);await scheduler.tick();}syncActionRequests(store);assert.equal(calls,1);assert.equal(store.read().agentNotifications.length,1);assert.equal(store.read().autonomy!.jobs[0].status,'DONE');assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN').length,1);}finally{store.close();}
});
