import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,CHAIN_ID,money} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {OwnerControls} from '../src/owner-controls.ts';
import {operationalReadiness} from '../src/operational-readiness.ts';
import {modelUsageSummary} from '../src/model-usage-summary.ts';
import {defaultModelLimits} from '../src/model-requests.ts';
import {ModelRequests} from '../src/model-requests.ts';
import {createApp} from '../src/app.ts';
import {Engine} from '../src/engine.ts';
import {RulesPlanner} from '../src/planner.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';
import {runtime} from '../src/config.ts';
import {writeFileSync,readFileSync} from 'node:fs';

const grant=(s:ReturnType<typeof fixture>)=>({confirmed:true,policyVersion:s.policy.version,financialVersion:s.financialVersion,allowlist:s.policy.allowlist,reserve:'1.25',gasLimit:'0.01',perObligation:'5',totalBudget:'20',authorityExpiresAt:new Date(Date.now()+86400000).toISOString(),bridge:{enabled:true,sourceChains:['BASE-SEPOLIA'],maxAmount:'5',maxFee:'0.1'}});
test('owner grants are version bound, preserve history, invalidate old approvals, survive restart and never resume',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-controls-')),db=join(dir,'testnet.db');const s=fixture();s.mode='testnet';s.paused=true;s.policy.enabled=false;
 let store=new Store(db,s);const service=new OwnerControls(store,{env:{},envFile:join(dir,'.env')});
 try{await service.grant(grant(store.read()),async()=>({...s.snapshot,chainId:CHAIN_ID}));const after=store.read();assert.equal(after.policy.version,2);assert.equal(after.policy.reserve,money('1.25'));assert.equal(after.bridgePolicy.enabled,true);assert.equal(after.paused,true);assert.deepEqual(after.obligations,s.obligations);await assert.rejects(()=>service.grant(grant(s),async()=>s.snapshot),/AUTHORITY_CHANGED/);store.close();store=new Store(db,s);assert.equal(store.read().policy.version,2);assert.equal(store.read().bridgePolicy.enabled,true);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('owner grant rejects pending operations, wrong chain and unsafe inputs; revocation pauses without losing submitted evidence',async()=>{
 const s=fixture();s.mode='testnet';s.paused=true;const store=new Store(':memory:',s),service=new OwnerControls(store,{env:{}});
 try{await assert.rejects(()=>service.grant({...grant(s),allowlist:[s.policy.sender]},async()=>s.snapshot),/INVALID_RECIPIENT/);await assert.rejects(()=>service.grant(grant(s),async()=>({...s.snapshot,chainId:1})),/WRONG_CHAIN/);
 store.change(s=>s.intents.push({id:'pending',runId:'r',obligationId:'A',amount:'1',recipient:s.policy.allowlist[0],sender:s.policy.sender,chainId:CHAIN_ID,policyVersion:1,obligationVersion:1,idempotencyKey:'pending',status:'EXECUTION_UNKNOWN',createdAt:new Date().toISOString(),hash:'0x'+'a'.repeat(64)}));
 await assert.rejects(()=>service.grant(grant(store.read()),async()=>s.snapshot),/RECONCILE_REQUIRED/);service.revoke({confirmed:true,policyVersion:store.read().policy.version});assert.equal(store.read().policy.enabled,false);assert.equal(store.read().paused,true);assert.equal(store.read().intents[0].status,'EXECUTION_UNKNOWN');assert.equal(store.read().intents[0].hash,'0x'+'a'.repeat(64));}finally{store.close();}
});
test('readiness never calls disabled authority or expired authority monitoring; pending receipts remain visible while paused',()=>{
 const s=fixture();s.mode='testnet';s.autonomy={...({}as any),enabled:true};const flags={sendEnabled:true,bridgeEnabled:true,modelEnabled:true};s.policy.enabled=false;assert.equal(operationalReadiness(s,flags).code,'AUTHORITY_DISABLED');s.policy.enabled=true;s.policy.authorityExpiresAt=new Date(0).toISOString();assert.equal(operationalReadiness(s,flags).code,'AUTHORITY_EXPIRED');s.policy.authorityExpiresAt=new Date(Date.now()+86400000).toISOString();assert.equal(operationalReadiness(s,{...flags,sendEnabled:false}).code,'SUBMISSIONS_DISABLED');s.modelControl={requests:[],blocks:{planner:{code:'MODEL_AUTH_FAILED',at:Date.now()}}};assert.equal(operationalReadiness(s,flags).code,'MODEL_AUTH_FAILED');
 s.paused=true;s.intents=[{status:'EXECUTION_UNKNOWN'}as any];assert.equal(operationalReadiness(s,flags).code,'RECONCILING');
});
test('usage displays unknown prices separately and retains reservations across UTC day boundaries',()=>{
 const now=Date.parse('2026-10-05T01:00:00Z'),limits={...defaultModelLimits};const data=modelUsageSummary({requests:[{id:'old',runId:'a',provider:'planner',model:'gpt-5.4-mini',at:now-86400000,status:'COMPLETE',reservedTokens:100,usage:{inputTokens:10,outputTokens:20,cachedTokens:0,reasoningTokens:0},estimatedCostNanoUsd:100},{id:'new',runId:'b',provider:'planner',model:'custom',at:now,status:'UNKNOWN',reservedTokens:800},{id:'done',runId:'b',provider:'planner',model:'gpt-5.4-mini',at:now,status:'COMPLETE',reservedTokens:900,usage:{inputTokens:100,outputTokens:50,cachedTokens:0,reasoningTokens:0},estimatedCostNanoUsd:500}],blocks:{}},limits,now);
 assert.equal(data.requests,2);assert.equal(data.reportedTokens,150);assert.equal(data.reservedTokens,800);assert.equal(data.unpricedRequests,1);assert.equal(data.remainingTokens,limits.maxDayTokens-950);assert.equal(data.estimatedCostNanoUsd,500);
});
test('two concurrent grants cannot both commit against the same financial version',async()=>{
 const s=fixture();s.mode='testnet';s.paused=true;const store=new Store(':memory:',s),service=new OwnerControls(store,{env:{}});let release:()=>void=()=>{};
 const gate=new Promise<void>(r=>{release=r;});const verify=async()=>{await gate;return s.snapshot;};
 try{const a=service.grant(grant(s),verify),b=service.grant(grant(s),verify);release();const outcomes=await Promise.allSettled([a,b]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(store.read().policy.version,2);assert.equal(store.read().events.filter(e=>e.type==='OWNER_AUTHORITY_GRANTED').length,1);}finally{store.close();}
});
test('local owner APIs protect grants and budget edits; lowering a budget affects an existing meter without erasing usage',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-api-'));const s=fixture();s.mode='testnet';s.paused=true;s.policy.enabled=false;
 const store=new Store(':memory:',s),meter=new ModelRequests(store),gateway=new SimulationGateway(store);gateway.mode='testnet' as any;
 const engine=new Engine(store,gateway,new RulesPlanner());const env:NodeJS.ProcessEnv={SEND_ENABLED:'false',BRIDGE_ENABLED:'false'};
 const owner=new OwnerControls(store,{env,envFile:join(dir,'.env')});const app=createApp({store,engine,sendEnabled:false,bridgeEnabled:false,useModel:false,walletProvider:'agent',arc:undefined,sources:undefined,bridge:undefined},'owner-session',{owner});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address()as any).port}/api/`,headers={Authorization:'Bearer owner-session','Content-Type':'application/json'};
 const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
 try{assert.equal((await fetch(base+'authority-settings')).status,401);assert.equal((await post('authority-settings',{...grant(s),confirmed:false})).status,400);
 assert.equal((await post('authority-settings',grant(s))).status,200);const saved=store.read();assert.equal(saved.policy.enabled,true);assert.equal(saved.paused,true);
 assert.equal((await post('authority-settings/execution',{confirmed:true,policyVersion:saved.policy.version,sendEnabled:true,bridgeEnabled:true})).status,200);assert.equal(env.SEND_ENABLED,'true');assert.equal((await(await fetch(base+'state',{headers})).json()).sendEnabled,false);
 store.change(s=>s.modelControl={requests:[{id:'already',runId:'r',provider:'planner',model:'custom',at:Date.now(),status:'UNKNOWN',reservedTokens:100}],blocks:{}});
 const limits={...defaultModelLimits,maxDayRequests:1};assert.equal((await post('model-usage/limits',{confirmed:true,limits})).status,200);assert.equal(meter.limits.maxDayRequests,1);let calls=0;
 await assert.rejects(()=>meter.request('planner','custom','https://no-network.example',{body:JSON.stringify({max_output_tokens:1,input:'x'})},async()=>{calls++;throw Error('UNEXPECTED_TRANSPORT');},'new'),/MODEL_BUDGET_EXCEEDED/);assert.equal(calls,0);assert.equal(store.read().modelControl!.requests.length,1);
 const summary=await(await fetch(base+'model-usage/summary',{headers})).json();assert.equal(summary.summary.remainingRequests,0);assert.equal(summary.summary.unpricedRequests,1);
 assert.equal((await post('model-usage/reset-blocks',{confirmed:true})).status,200);assert.equal(store.read().paused,true);assert.equal(store.read().modelControl!.requests.length,1);
 assert.equal((await post('authority-settings/revoke',{confirmed:true,policyVersion:store.read().policy.version})).status,200);assert.equal(store.read().policy.enabled,false);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});}
});
test('full runtime restart uses the persisted authority and bridge scope without network calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-runtime-'));const s=fixture();s.mode='testnet';s.paused=true;s.policy.enabled=false;const policyPath=join(dir,'policy.json'),db=join(dir,'testnet.db');writeFileSync(policyPath,JSON.stringify(s.policy));
 const envKeys=['TAMEION_ENV_FILE','TAMEION_MODE','POLICY_FILE','DATABASE_PATH','ARC_TESTNET_RPC_URL','WALLET_PROVIDER','CIRCLE_CLI_ENTRYPOINT','ALLOW_MODEL_REQUESTS','JEV_ENABLED','SEND_ENABLED','BRIDGE_ENABLED','OPENAI_BASE_URL'];const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
 let current:ReturnType<typeof runtime>|undefined;
 try{Object.assign(process.env,{TAMEION_ENV_FILE:join(dir,'absent.env'),TAMEION_MODE:'testnet',POLICY_FILE:policyPath,DATABASE_PATH:db,ARC_TESTNET_RPC_URL:'https://offline-rpc.example',WALLET_PROVIDER:'agent',CIRCLE_CLI_ENTRYPOINT:join(dir,'unused-cli.js'),ALLOW_MODEL_REQUESTS:'false',JEV_ENABLED:'false',SEND_ENABLED:'false',BRIDGE_ENABLED:'false',OPENAI_BASE_URL:'https://offline-model.example'});
 current=runtime();current.store.change(s=>s.paused=true);const owner=new OwnerControls(current.store,{env:{}});await owner.grant(grant(current.store.read()),async()=>({...s.snapshot,block:'1'}));const saved=current.store.read();current.store.close();current=undefined;
 current=runtime();assert.deepEqual(current.store.read().policy,saved.policy);assert.deepEqual(current.store.read().bridgePolicy,saved.bridgePolicy);assert.equal(current.store.read().paused,true);assert.equal(JSON.parse(readFileSync(policyPath,'utf8')).enabled,false);
 }finally{current?.store.close();for(const key of envKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}rmSync(dir,{recursive:true,force:true});}
});
