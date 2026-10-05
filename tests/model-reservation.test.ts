import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelRequests,defaultModelLimits} from '../src/model-requests.ts';
import {Store} from '../src/store.ts';
import {fixture} from '../src/domain.ts';
const endpoint='https://api.openai.com/v1/responses';
const body=(extra:any[]=[],overrides:any={})=>({model:'gpt-5.4-mini',store:false,max_output_tokens:8000,instructions:'Trusted instructions',tools:[],input:[{role:'user',content:'A'.repeat(80000)},...extra],...overrides});
const usage=()=>new Response(JSON.stringify({output:[],usage:{input_tokens:16000,output_tokens:500,input_tokens_details:{cached_tokens:15000},output_tokens_details:{reasoning_tokens:400}}}));
const append=[{type:'function_call',call_id:'c',name:'check_policy',arguments:'{}'},{type:'function_call_output',call_id:'c',output:'héllo 世界'}];
const request=(m:ModelRequests,p:any,transport:typeof fetch=async()=>usage(),run='r',url=endpoint)=>m.request('planner','gpt-5.4-mini',url,{method:'POST',body:JSON.stringify(p)},transport,run);

test('observed unchanged prefix allows round twelve while actual usage and unchanged ceilings remain charged',async()=>{
 const store=new Store(':memory:',fixture());const meter=new ModelRequests(store);
 try{await request(meter,body());store.change(s=>{const c=s.modelControl!;for(let i=0;i<10;i++)c.requests.push({...structuredClone(c.requests[0]),id:`previous-${i}`});});let calls=0;await request(meter,body(append),async()=>{calls++;return usage();});assert.equal(calls,1);const entry=store.read().modelControl!.requests.at(-1)!;assert.ok(entry.reservedTokens<35000);assert.ok(entry.reservedTokens>=16000+500+8000+1024);assert.equal(entry.reservedCostNanoUsd!>8000*4500,true);assert.deepEqual(meter.limits,defaultModelLimits);assert.equal(store.read().modelControl!.requests.length,12);assert.ok(!JSON.stringify(store.read().modelControl).includes('Trusted instructions'));}finally{store.close();}
});

test('changed prefix/settings/endpoint, opaque input, stale and unknown usage retain byte fallback',async()=>{
 for(const kind of ['prefix','settings','tools','endpoint','opaque','image','malformed','stale','unknown','run']as const){
  const store=new Store(':memory:',fixture());let now=Date.now();const meter=new ModelRequests(store,defaultModelLimits,()=>now);
  try{await request(meter,body(),kind==='unknown'?async()=>new Response('{"output":[]}'):async()=>usage());const p=body(append);if(kind==='prefix')p.input[0].content='B'.repeat(80000);if(kind==='settings')p.instructions='Different instructions';if(kind==='tools')p.tools=[{type:'function',name:'extra'}];if(kind==='opaque')p.input.push({type:'reasoning',encrypted_content:'opaque'});if(kind==='image')p.input.push({role:'user',content:[{type:'input_image',image_url:'https://example.test/image'}]});if(kind==='malformed')p.input.push({type:'constructor'});if(kind==='stale')now+=300001;
   await request(meter,p,async()=>usage(),kind==='run'?'another-run':'r',kind==='endpoint'?'https://proxy.example/v1/responses':endpoint);const entry=store.read().modelControl!.requests.at(-1)!;assert.equal(entry.reservedTokens,Buffer.byteLength(JSON.stringify(p))+1024+8000,kind);if(kind==='unknown')assert.equal(store.read().modelControl!.requests[0].usage,undefined);
  }finally{store.close();}
 }
});

test('prefix estimates survive restart; concurrent unknown reservation cannot be reused as observed usage',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reservation-')),path=join(dir,'s.db');let store=new Store(path,fixture());
 try{await request(new ModelRequests(store),body());store.close();store=new Store(path,fixture());const meter=new ModelRequests(store,{...defaultModelLimits,maxRunTokens:60000});let release!:()=>void,calls=0;const send=(async()=>{calls++;await new Promise<void>(done=>release=done);return new Response('{"output":[]}');})as typeof fetch;const pending=request(meter,body(append),send);void pending.catch(()=>{});assert.equal(calls,1,'the observed prefix must admit the first request');await assert.rejects(request(meter,body(append),send),/MODEL_RUN_LIMIT/);release();await pending;assert.equal(calls,1);assert.equal(store.read().modelControl!.requests.at(-1)!.status,'UNKNOWN');assert.ok(store.read().modelControl!.requests.at(-1)!.reservedTokens<35000);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('observed-prefix reservation still blocks actual token, known-cost and day limits before transport',async()=>{
 for(const kind of ['tokens','cost','day']as const){
  const store=new Store(':memory:',fixture());
  try{await request(new ModelRequests(store),body());const limits={...defaultModelLimits,...(kind==='tokens'?{maxRunTokens:40000}:kind==='cost'?{maxRunCostNanoUsd:50000000}:{maxDayTokens:40000})};const meter=new ModelRequests(store,limits);let calls=0;await assert.rejects(request(meter,body(append),async()=>{calls++;return usage();}),kind==='day'?/MODEL_BUDGET_EXCEEDED/:/MODEL_RUN_LIMIT/);assert.equal(calls,0);assert.equal(store.read().modelControl!.requests.length,1);}finally{store.close();}
 }
});
