import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,money,type Planner,type PaymentGateway} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';
import {AgentScheduler} from '../src/scheduler.ts';
import {ModelRequests,defaultModelLimits} from '../src/model-requests.ts';
import {syncActionRequests} from '../src/action-requests.ts';
import {TelegramNotificationDispatcher} from '../src/telegram-notifications.ts';
import {LlmSettingsService} from '../src/llm-settings.ts';
import {DisabledPlanner} from '../src/planner.ts';
import {CctpBridge} from '../src/cctp.ts';
import {evaluationKey,resolveEvaluationFailures} from '../src/evaluation-control.ts';
const request={method:'POST',body:JSON.stringify({max_output_tokens:100,input:'synthetic regression'})};
const ok=()=>new Response(JSON.stringify({usage:{input_tokens:100,output_tokens:10}}));
function setup(make:(s:Store)=>Planner){const s=fixture();s.obligations=[];s.evidence=[];const store=new Store(':memory:',s);const engine=new Engine(store,new SimulationGateway(store),make(store));return {store,engine,runtime:{store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'}};}

test('disabling LLM prevents new testnet submissions and preserves reconciliation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'disabled-model-'));const state=fixture();state.mode='testnet';state.snapshot.balance=money('16');state.obligations=state.obligations.slice(0,1);
 const store=new Store(':memory:',state);let submits=0;
 const gateway:PaymentGateway={mode:'testnet',snapshot:async()=>({...store.read().snapshot,observedAt:new Date().toISOString()}),estimate:async()=>money('0.01'),submit:async()=>{submits++;return {providerId:'stub'};},reconcile:async()=>({status:'pending'})};
 const engine=new Engine(store,gateway,{name:'AI stub',plan:async()=>[]},true);
 const service=new LlmSettingsService(store,engine,{env:{},envFile:join(dir,'.env')});
 try{service.configure({enabled:false,llmEndpoint:'https://example.invalid',llmModel:'gpt-5.4-mini',jevEnabled:false,jevEndpoint:'https://example.invalid',jevModel:'jev-latest',jevMinimumConfidence:0.8});await engine.run();await engine.reconcile();assert.equal(submits,0);assert.equal(store.read().runs.at(-1)?.failureCode,'MODEL_DISABLED');}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('fresh wakeups cannot reset transient evaluation retries, including after scheduler recreation',async()=>{
 let calls=0,now=Date.now();const {store,runtime}=setup(store=>{const meter=new ModelRequests(store,defaultModelLimits,()=>now);return {name:'AI stub',plan:async(_s,id)=>{await meter.request('planner','gpt-5.4-mini','https://example.invalid',request,async()=>{calls++;throw new Error('offline disconnect');},id);return [];}};});
 try{let scheduler=new AgentScheduler(runtime,()=>now);scheduler.wake('SOURCE_UPDATED','initial');await scheduler.tick();for(let i=0;i<3;i++){now+=60000;scheduler=new AgentScheduler(runtime,()=>now);scheduler.wake('WORKER_RECOVERED',`recovered:${i}`);now+=240001;await scheduler.tick();}assert.equal(calls,2);assert.ok(store.read().autonomy!.jobs.some(j=>j.status==='NEEDS_ATTENTION'));}finally{store.close();}
});

test('unchanged input stays stopped after run limit but changed financial input can re-evaluate',async()=>{
 let calls=0;const {store,runtime}=setup(store=>{const meter=new ModelRequests(store,{...defaultModelLimits,maxRunRequests:1});return {name:'AI stub',plan:async(_s,id)=>{const send=async()=>{calls++;return ok();};await meter.request('planner','gpt-5.4-mini','https://example.invalid',request,send,id);await meter.request('planner','gpt-5.4-mini','https://example.invalid',request,send,id);return [];}};});
 try{const scheduler=new AgentScheduler(runtime);for(let i=0;i<3;i++){scheduler.wake('WORKER_RECOVERED',`recovery:${i}`);await scheduler.tick();}assert.equal(calls,1);store.change(s=>s.snapshot.balance=money('17'));scheduler.wake('MATERIAL_BALANCE_CHANGED');await scheduler.tick();assert.equal(calls,2);}finally{store.close();}
});

test('verified provider recovery closes old job requests and Telegram reminders',async()=>{
 let billing=true,meter!:ModelRequests;const {store,runtime}=setup(store=>{meter=new ModelRequests(store);return {name:'AI stub',plan:async(_s,id)=>{await meter.request('planner','gpt-5.4-mini','https://example.invalid',request,async()=>billing?new Response(JSON.stringify({error:{code:'credit_balance_exhausted'}}),{status:429}):ok(),id);return [];}};});
 try{const scheduler=new AgentScheduler(runtime);scheduler.wake('SOURCE_UPDATED','initial');await scheduler.tick();syncActionRequests(store);let sends=0;const tg=new TelegramNotificationDispatcher(store,{token:'stub',chatId:'stub',transport:async()=>{sends++;return new Response(JSON.stringify({ok:true,result:{message_id:sends}}));}});await tg.tick();assert.equal(sends,1);billing=false;meter.reset();scheduler.wake('MODEL_CONNECTION_RESET','reset');await scheduler.tick();syncActionRequests(store);await tg.tick(Date.now()+1800001);assert.equal(store.read().runs.at(-1)?.status,'DONE');assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN').length,0);assert.equal(sends,1);}finally{store.close();}
});

test('historical completed usage rolls over without erasing reused run limits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'usage-archive-')),path=join(dir,'state.db');let store=new Store(path,fixture());const now=Date.now();
 try{store.change(s=>s.modelControl={requests:Array.from({length:10000},(_,i)=>({id:String(i),runId:'historical',provider:'planner',model:'gpt-5.4-mini',at:now-2*86400000,status:'COMPLETE',reservedTokens:110,usage:{inputTokens:100,cachedTokens:0,outputTokens:10,reasoningTokens:0}})),blocks:{}});let meter=new ModelRequests(store);await meter.request('planner','gpt-5.4-mini','https://example.invalid',request,async()=>ok(),'new');assert.ok(meter.snapshot().requests.length<10000);store.close();store=new Store(path,fixture());meter=new ModelRequests(store);await assert.rejects(meter.request('planner','gpt-5.4-mini','https://example.invalid',request,async()=>ok(),'historical'),/MODEL_RUN_LIMIT/);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('successful evaluations do not consume retry allowance of a later failure',async()=>{
 let broken=false,calls=0;const {store,runtime}=setup(()=>({name:'AI stub',plan:async()=>{calls++;if(broken)throw new Error('MODEL_TIMEOUT');return [];}}));
 try{const scheduler=new AgentScheduler(runtime);for(let i=0;i<3;i++){store.change(s=>s.snapshot.balance=money(String(16+i)));scheduler.wake('AGENT_RECHECK',`success:${i}`);await scheduler.tick();}broken=true;store.change(s=>s.snapshot.balance=money('20'));scheduler.wake('AGENT_RECHECK','failure');await scheduler.tick();assert.equal(calls,4);assert.equal(store.read().autonomy!.jobs.at(-1)?.status,'READY');assert.equal(store.read().autonomy!.jobs.at(-1)?.attempts,1);}finally{store.close();}
});

test('disabling model invalidates a prepared payout without blocking existing reconciliation',async()=>{
 const s=fixture();s.mode='testnet';s.snapshot.balance=money('16');s.obligations=s.obligations.slice(0,1);const store=new Store(':memory:',s);let submits=0,reconciles=0;
 const gateway:PaymentGateway={mode:'testnet',snapshot:async()=>({...store.read().snapshot,observedAt:new Date().toISOString()}),estimate:async()=> '0',submit:async()=>{submits++;return {providerId:'stub'};},reconcile:async()=>{reconciles++;return {status:'pending'};}};
 const engine=new Engine(store,gateway,{name:'AI stub',plan:async()=>[{obligationId:'A',action:'PAY_NOW',reason:'Fixture',evidenceIds:['e-a']}]});
 try{const plan=await engine.plan();engine.setPlanner(new DisabledPlanner());await assert.rejects(engine.executePlanned(plan),/PLAN_NOT_EXECUTABLE/);assert.equal(submits,0);store.change(s=>s.intents.push({id:'existing',runId:'old',obligationId:'A',amount:money('4'),recipient:s.obligations[0].recipient,sender:s.policy.sender,chainId:s.policy.chainId,policyVersion:1,obligationVersion:1,idempotencyKey:'existing',status:'PROVIDER_ACCEPTED',createdAt:new Date().toISOString()}));await engine.reconcile();assert.equal(reconciles,1);assert.equal(submits,0);}finally{store.close();}
});

test('disabling the model while obtaining a bridge quote prevents dispatch and stuck reservation',async()=>{
 const s=fixture();s.mode='testnet';s.bridgePolicy.enabled=true;s.snapshot.balance=money('5');s.policy.reserve=money('2');s.obligations=s.obligations.slice(0,1);s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),chainId:84532,block:'1',observedAt:new Date().toISOString(),status:'VERIFIED'}];const store=new Store(':memory:',s);let enabled=true,sends=0;
 const source={snapshot:async()=>({...s.crosschainBalances[0],observedAt:new Date().toISOString()})};
 const bridge=new CctpBridge(store,new Map([['BASE-SEPOLIA',source as never]]),{} as never,async args=>{if(args[0]==='wallet')return {data:{wallets:[{type:'agent',blockchain:'BASE-SEPOLIA',address:s.policy.sender}]}};if(args[1]==='get-fee'){enabled=false;return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',fees:[{finalityThreshold:1000,minimumFee:0,forwardFee:{med:0}}]}};}sends++;throw new Error('MUST_NOT_SEND');},{enabled:true,decisionEnabled:()=>enabled});
 try{store.change(s=>s.runs.push({id:'plan',createdAt:new Date().toISOString(),source:'AI stub',status:'DONE',executionStatus:'PLANNED',financialVersion:s.financialVersion,policyVersion:s.policy.version,decisions:[{obligationId:'A',action:'FUND_ARC',fundingSourceChain:'BASE-SEPOLIA',reason:'Fixture',evidenceIds:['e-a']}]}));await assert.rejects(bridge.fundFromInventory('plan'),/BRIDGE_AUTHORITY_DISABLED/);assert.equal(sends,0);assert.equal(store.read().bridgeIntents.length,0);}finally{store.close();}
});

test('deadline transitions and explicit reset change failure identity but provider observation timestamps do not',()=>{
 const store=new Store(':memory:',fixture()),now=Date.now();
 try{store.change(s=>{s.obligations=s.obligations.slice(0,1);s.obligations[0].due=new Date(now+1000).toISOString();});const key=evaluationKey(store.read(),now);store.change(s=>s.snapshot.observedAt=new Date(now+500).toISOString());assert.equal(evaluationKey(store.read(),now+500),key);assert.notEqual(evaluationKey(store.read(),now+1001),key);new ModelRequests(store).reset();assert.notEqual(evaluationKey(store.read(),now),key);}finally{store.close();}
});

test('unproven provider recovery and unrelated acceptance requests remain open',()=>{
 const store=new Store(':memory:',fixture()),now=Date.now();
 try{store.change(s=>{s.runs.push({id:'failed',createdAt:new Date().toISOString(),source:'AI stub',status:'ERROR',decisions:[],failureCode:'MODEL_AUTH_FAILED'});s.autonomy!.jobs.push({id:'job',key:'job',cause:'SOURCE',dueAt:now,status:'NEEDS_ATTENTION',attempts:1,runId:'failed'});s.modelControl={requests:[{id:'failed-call',runId:'failed',provider:'reviewer',model:'jev',at:now,status:'REJECTED',reservedTokens:100,error:'MODEL_AUTH_FAILED'}],blocks:{}};s.evidenceRequests.push({id:'acceptance',runId:'other',obligationId:'C',obligationVersion:1,requestedFrom:'PROJECT_OWNER',question:'Accept?',status:'OPEN',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString()});});syncActionRequests(store);store.change(s=>resolveEvaluationFailures(s,'recovered'));assert.equal(store.read().autonomy!.jobs[0].status,'NEEDS_ATTENTION');store.change(s=>{s.modelControl!.requests.push({id:'recovered-call',runId:'recovered',provider:'reviewer',model:'jev',at:now+1,completedAt:now+2,status:'COMPLETE',reservedTokens:100,usage:{inputTokens:10,outputTokens:10,cachedTokens:0,reasoningTokens:0}});resolveEvaluationFailures(s,'recovered');});syncActionRequests(store);assert.equal(store.read().autonomy!.requests.filter(r=>r.legacyId==='job:job'&&r.status==='OPEN').length,0);assert.ok(store.read().autonomy!.requests.some(r=>r.legacyId==='acceptance'&&r.status==='OPEN'));}finally{store.close();}
});

test('a successful evaluation also resolves invalid-tool failures without closing financial requests',()=>{
 const store=new Store(':memory:',fixture());
 try{store.change(s=>{s.runs.push({id:'invalid-tools',createdAt:new Date().toISOString(),source:'AI stub',status:'ERROR',decisions:[],failureCode:'INVALID_TOOL_SEQUENCE'});s.autonomy!.jobs.push({id:'failed-job',key:'failed-job',cause:'SOURCE',dueAt:Date.now(),status:'NEEDS_ATTENTION',attempts:1,runId:'invalid-tools'});});syncActionRequests(store);store.change(s=>resolveEvaluationFailures(s,'success'));syncActionRequests(store);assert.equal(store.read().autonomy!.jobs[0].status,'DONE');assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN').length,0);}finally{store.close();}
});

test('archive retains uncertain, current-day and active-run usage; insertion rolls back atomically',async()=>{
 const store=new Store(':memory:',fixture()),now=Date.now();
 try{store.change(s=>{s.modelControl={requests:Array.from({length:9996},(_,i)=>({id:String(i),runId:'old',provider:'planner',model:'gpt-5.4-mini',at:now-2*86400000,status:'COMPLETE',reservedTokens:110,usage:{inputTokens:100,cachedTokens:0,outputTokens:10,reasoningTokens:0}})),blocks:{}};for(const [id,status,at,runId] of [['unknown','UNKNOWN',now-2*86400000,'u'],['reserved','RESERVED',now-2*86400000,'r'],['today','COMPLETE',now,'today'],['running','COMPLETE',now-2*86400000,'active']] as const)s.modelControl.requests.push({id,runId,provider:'planner',model:'gpt-5.4-mini',at,status,reservedTokens:100});s.runs.push({id:'active',createdAt:new Date(now).toISOString(),source:'stub',status:'RUNNING',decisions:[]});});const meter=new ModelRequests(store);await meter.request('planner','gpt-5.4-mini','https://example.invalid',request,async()=>ok(),'new');assert.equal(store.modelArchive().count,9996);for(const id of ['unknown','reserved','today','running'])assert.ok(meter.snapshot().requests.some(r=>r.id===id));const a=store.modelArchive(0,2),b=store.modelArchive(a.nextCursor,2);assert.equal(new Set([...a.records,...b.records].map(r=>r.id)).size,4);assert.throws(()=>store.change(s=>{store.archiveModelRequests([{...s.modelControl!.requests[0],id:'rollback'}]);throw new Error('rollback');}),/rollback/);assert.equal(store.modelArchive().count,9996);}finally{store.close();}
});

test('terminal evaluation failure survives SQLite reopen until explicit reset',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'failure-restart-')),path=join(dir,'s.db');const initial=fixture();initial.obligations=[];initial.evidence=[];let store=new Store(path,initial),calls=0;
 const scheduler=()=>{const engine=new Engine(store,new SimulationGateway(store),{name:'AI stub',plan:async()=>{calls++;throw new Error('MODEL_RUN_LIMIT');}});return new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'});};
 try{let worker=scheduler();worker.wake('SOURCE_UPDATED','first');await worker.tick();store.close();store=new Store(path,initial);worker=scheduler();worker.wake('WORKER_RECOVERED','after-restart');await worker.tick();assert.equal(calls,1);new ModelRequests(store).reset();worker.wake('MODEL_CONNECTION_RESET','explicit-reset');await worker.tick();assert.equal(calls,2);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('re-enabling configured model permits evaluation after disabled-model failure',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-reenable-')),s=fixture();s.mode='testnet';s.obligations=s.obligations.slice(0,1);s.evidence=[];const store=new Store(':memory:',s);let calls=0;
 const gateway:PaymentGateway={mode:'testnet',snapshot:async()=>({...s.snapshot,observedAt:new Date().toISOString()}),estimate:async()=> '0',submit:async()=>{throw new Error('MUST_NOT_SEND');},reconcile:async()=>({status:'pending'})};
 const engine=new Engine(store,gateway,new DisabledPlanner(),false),scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:true,walletProvider:'simulation'});
 const service=new LlmSettingsService(store,engine,{env:{},envFile:join(dir,'.env'),transport:async()=>{calls++;return new Response(JSON.stringify({output:[{type:'function_call',name:'finish',call_id:'finish',arguments:JSON.stringify({decisions:[{obligationId:'A',action:'HOLD',reason:'Fixture',evidenceIds:[]}]})}],usage:{input_tokens:100,output_tokens:10}}));}});
 try{scheduler.wake('SOURCE_UPDATED','first');await scheduler.tick();assert.equal(store.read().runs.at(-1)?.failureCode,'MODEL_DISABLED');service.configure({enabled:true,llmApiKey:'synthetic-key-only',llmEndpoint:'https://example.invalid',llmModel:'gpt-5.4-mini',jevEnabled:false,jevEndpoint:'https://example.invalid',jevModel:'jev-latest',jevMinimumConfidence:0.8});scheduler.wake('MODEL_CONFIGURATION_CHANGED','enabled');await scheduler.tick();assert.equal(calls,1);assert.equal(store.read().runs.at(-1)?.status,'DONE');}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
