import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelRequests,defaultModelLimits} from '../src/model-requests.ts';
import {Store} from '../src/store.ts';
import {fixture,money} from '../src/domain.ts';
import {AgentWorkspace} from '../src/agent-workspace.ts';
import {ModelPlanner} from '../src/adapters/model.ts';

const endpoint='https://api.openai.com/v1/responses';
const payload=(input:any[])=>({model:'gpt-5.4-mini',store:false,max_output_tokens:8000,instructions:'Trusted policy',tools:[],input});
const first=[{role:'user',content:'A'.repeat(45000)}];
const output=(id:string,encrypted:string|null)=>[{type:'reasoning',id:`reason-${id}`,summary:[],encrypted_content:encrypted},{type:'function_call',id:`tool-${id}`,call_id:id,name:'prepare_context',arguments:'{}',status:'completed'}];
const send=(m:ModelRequests,p:any,out:any[],inputTokens:number,outputTokens:number,overrides:any={},run='one',url=endpoint)=>m.request('planner','gpt-5.4-mini',url,{body:JSON.stringify(p)},async()=>Response.json({status:'completed',output:out,usage:{input_tokens:inputTokens,output_tokens:outputTokens,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:Math.min(100,outputTokens)}},...overrides}),run);
const budget={...defaultModelLimits,maxRunRequests:8,maxRunCostNanoUsd:100_000_000};

test('three tool rounds with provider reasoning fit the unchanged USD 0.10 budget using observed replay',async()=>{
 const store=new Store(':memory:',fixture());const m=new ModelRequests(store,budget);
 try{
  const a=output('a',null),b=output('b','encrypted-provider-state'.repeat(800));
  await send(m,payload(first),a,10153,379);
  const second=[...first,...a,{type:'function_call_output',call_id:'a',output:'Skills and evidence '.repeat(650)}];
  await send(m,payload(second),b,13101,1541);
  const third=[...second,...b,{type:'function_call_output',call_id:'b',output:'Chosen source: BASE-SEPOLIA'}];
  await send(m,payload(third),[],14000,500);
  const records=m.snapshot().requests;
  assert.equal(records.length,3);
  assert.equal(records[1].inputReservation?.method,'OBSERVED_PREFIX');
  assert.equal(records[2].inputReservation?.method,'OBSERVED_PREFIX');
  assert.ok(records[2].reservedTokens<30000);
  assert.ok(records[2].reservedTokens>=13101+1541+8000+1024);
  assert.ok(records.reduce((n,r)=>n+r.estimatedCostNanoUsd!,0)<budget.maxRunCostNanoUsd);
  assert.equal(m.limits.maxRunCostNanoUsd,100_000_000);
  assert.ok(!JSON.stringify(m.snapshot()).includes('encrypted-provider-state'));
 }finally{store.close();}
});

test('tampering, unknown opaque tails and changed scope cannot borrow a provider replay reservation',async()=>{
 for(const kind of ['tampered','new-opaque','settings','run','endpoint','stale','no-usage','incomplete','unsupported-output'] as const){
  const store=new Store(':memory:',fixture());let now=Date.now();const m=new ModelRequests(store,defaultModelLimits,()=>now);
  try{
   const out=kind==='unsupported-output'?[{type:'image_generation_call',result:'opaque-image'}]:output('a','protected');
   await send(m,payload(first),out,10153,379,kind==='no-usage'?{usage:undefined}:kind==='incomplete'?{status:'incomplete'}:{});
   const next=payload([...first,...structuredClone(out),{type:'function_call_output',call_id:'a',output:'Evidence'}]);
   if(kind==='tampered')next.input[1].encrypted_content='tampered';
   if(kind==='new-opaque')next.input.push({type:'reasoning',summary:[],encrypted_content:'unknown'});
   if(kind==='settings')next.instructions='Different policy';
   if(kind==='stale')now+=300001;
   await send(m,next,[],12000,100,{},kind==='run'?'different':'one',kind==='endpoint'?'https://proxy.example/v1/responses':endpoint);
   const record=m.snapshot().requests.at(-1)!;
   assert.equal(record.inputReservation?.method,'BYTE_BOUND',kind);
   assert.equal(record.reservedTokens,Buffer.byteLength(JSON.stringify(next))+1024+8000,kind);
  }finally{store.close();}
 }
});

test('provider replay hashes survive restart and still block cost overspend before transport',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'replay-reserve-')),path=join(dir,'state.db');let store=new Store(path,fixture());
 try{
  const out=output('a','protected');await send(new ModelRequests(store),payload(first),out,10153,379);store.close();store=new Store(path,fixture());
  const m=new ModelRequests(store,{...budget,maxRunCostNanoUsd:45_000_000});let calls=0;
  const next=payload([...first,...out,{type:'function_call_output',call_id:'a',output:'Evidence'}]);
  await assert.rejects(m.request('planner','gpt-5.4-mini',endpoint,{body:JSON.stringify(next)},async()=>{calls++;return Response.json({});},'one'),/MODEL_RUN_LIMIT/);
  assert.equal(calls,0);assert.equal(m.snapshot().requests.length,1);
  const normal=new ModelRequests(store,budget);await send(normal,next,[],11000,100);
  assert.equal(normal.snapshot().requests.at(-1)!.inputReservation?.method,'OBSERVED_PREFIX');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('real planner completes batched context, source choice and finish offline within eight requests and USD 0.10',async()=>{
 const state=fixture();state.obligations=[state.obligations[0]];state.evidence=[];
 state.snapshot.balance='0';state.bridgePolicy.enabled=true;state.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
 state.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),chainId:84532,block:'offline-fixture',status:'VERIFIED',observedAt:new Date().toISOString(),fundingEnabled:true}];
 const store=new Store(':memory:',state);store.change(s=>{s.modelControl={requests:[],blocks:{},limits:budget};});
 const sequence=[{name:'prepare_context',args:{skillNames:['settle-obligations','fund-arc-with-cctp'],obligationIds:['A']}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},{name:'finish',args:{decisions:[{obligationId:'A',action:'FUND_ARC',reason:'Fund verified Arc shortfall before payout.',evidenceIds:[]}]}}];
 let calls=0;
 try{
  const transport:typeof fetch=async()=>{
   const call=sequence[calls++];assert.ok(call,'a fourth provider request must not be made');
   return Response.json({status:'completed',output:[{type:'reasoning',id:`r-${calls}`,summary:[],encrypted_content:calls===1?null:'protected-output'.repeat(500)},{type:'function_call',name:call.name,call_id:String(calls),arguments:JSON.stringify(call.args)}],usage:{input_tokens:10000+calls*1000,output_tokens:calls===2?1541:500}});
  };
  const decisions=await new ModelPlanner('offline-fixture','gpt-5.4-mini',transport,new AgentWorkspace(store),endpoint).plan(store.read(),'full-offline');
  assert.equal(calls,3);assert.equal(decisions[0].action,'FUND_ARC');assert.equal(decisions[0].fundingSourceChain,'BASE-SEPOLIA');
  assert.equal(store.read().intents.length+store.read().bridgeIntents.length,0);
  assert.ok(store.read().modelControl!.requests.reduce((n,r)=>n+r.estimatedCostNanoUsd!,0)<100_000_000);
 }finally{store.close();}
});
