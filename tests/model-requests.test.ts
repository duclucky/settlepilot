import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {ModelRequests,defaultModelLimits} from '../src/model-requests.ts';
const request={method:'POST',body:JSON.stringify({max_output_tokens:100,input:'hello'})};
const usage={input_tokens:1000,input_tokens_details:{cached_tokens:800},output_tokens:200,output_tokens_details:{reasoning_tokens:150}};
const ok=()=>new Response(JSON.stringify({output:[],usage}));
const call=(c:ModelRequests,f:typeof fetch,run='r')=>c.request('planner','gpt-5.4-mini','https://example.test/v1',request,f,run);

test('billing block is persisted across restart and records no raw provider secrets',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-control-'));let store=new Store(join(dir,'s.db'),fixture());let calls=0;
 const send=(async()=>{calls++;return new Response(JSON.stringify({error:{code:'credit_balance_exhausted',message:'private sk-hidden provider body'}}),{status:429});})as typeof fetch;
 try{await assert.rejects(call(new ModelRequests(store),send),/MODEL_CREDIT_EXHAUSTED/);store.close();store=new Store(join(dir,'s.db'),fixture());await assert.rejects(call(new ModelRequests(store),send,'new-run'),/MODEL_CREDIT_EXHAUSTED/);assert.equal(calls,1);assert.ok(!JSON.stringify(store.read()).includes('sk-hidden'));}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('reservations serialize concurrent calls and unknown outcome remains charged to limits',async()=>{
 const store=new Store(':memory:',fixture());let release!:()=>void,calls=0;
 const c=new ModelRequests(store,{...defaultModelLimits,maxDayRequests:1});const send=(async()=>{calls++;await new Promise<void>(r=>release=r);throw new DOMException('timeout','TimeoutError');})as typeof fetch;
 try{const pending=call(c,send);await assert.rejects(call(c,send,'second'),/MODEL_BUDGET_EXCEEDED/);release();await assert.rejects(pending,/MODEL_TIMEOUT/);assert.equal(calls,1);const record=store.read().modelControl!.requests[0];assert.equal(record.status,'UNKNOWN');assert.ok(record.reservedTokens>100);assert.equal(record.usage,undefined);}finally{store.close();}
});
test('usage separates cached and reasoning tokens without double counting cost',async()=>{
 const store=new Store(':memory:',fixture());try{await call(new ModelRequests(store),async()=>ok());const r=store.read().modelControl!.requests[0];assert.equal(r.usage?.reasoningTokens,150);assert.equal(r.usage?.outputTokens,200);assert.equal(r.estimatedCostNanoUsd,1_110_000);assert.equal(r.status,'COMPLETE');}finally{store.close();}
});
test('one transient retry preserves the exact request and shares run limits',async()=>{
 const store=new Store(':memory:',fixture());let calls=0;const bodies:string[]=[];
 const send=(async(_url,init)=>{bodies.push(String(init?.body));return ++calls===1?new Response('{}',{status:503}):ok();})as typeof fetch;
 try{const c=new ModelRequests(store,defaultModelLimits,()=>Date.now(),async()=>{});await call(c,send);assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);assert.equal(store.read().modelControl!.requests.length,2);}finally{store.close();}
});
test('unknown prices remain unknown and still obey token and call caps',async()=>{
 const store=new Store(':memory:',fixture());try{const c=new ModelRequests(store,{...defaultModelLimits,maxRunRequests:1});await c.request('reviewer','jev-latest','https://example.test',request,async()=>ok(),'r');assert.equal(store.read().modelControl!.requests[0].estimatedCostNanoUsd,undefined);await assert.rejects(call(c,async()=>ok()),/MODEL_RUN_LIMIT/);}finally{store.close();}
});

test('malformed response retains reservation and blocks repeated provider calls',async()=>{
 const store=new Store(':memory:',fixture());let calls=0;const send=(async()=>{calls++;return new Response('secret invalid JSON');})as typeof fetch;
 try{const c=new ModelRequests(store);await assert.rejects(call(c,send),/MODEL_RESPONSE_INVALID/);await assert.rejects(call(c,send,'next'),/MODEL_RESPONSE_INVALID/);assert.equal(calls,1);assert.equal(c.snapshot().requests[0].status,'UNKNOWN');assert.ok(!JSON.stringify(c.snapshot()).includes('secret'));}finally{store.close();}
});

test('daily budget includes conservative reservations and resets only with the UTC day',async()=>{
 const store=new Store(':memory:',fixture());let now=Date.parse('2026-10-04T23:59:00Z'),calls=0;const send=(async()=>{calls++;return ok();})as typeof fetch;
 try{const c=new ModelRequests(store,{...defaultModelLimits,maxDayRequests:1},()=>now);await call(c,send);await assert.rejects(call(c,send,'second'),/MODEL_BUDGET_EXCEEDED/);c.reset();await assert.rejects(call(c,send,'after-reset'),/MODEL_BUDGET_EXCEEDED/);assert.equal(calls,1);now+=60001;await call(c,send,'next-day');assert.equal(calls,2);}finally{store.close();}
});

test('an overlapping successful request cannot clear another request billing block',async()=>{
 const store=new Store(':memory:',fixture());let complete!:()=>void;
 const c=new ModelRequests(store);
 const slow=(async()=>{await new Promise<void>(r=>complete=r);return ok();})as typeof fetch;
 const billing=(async()=>new Response(JSON.stringify({error:{code:'credit_balance_exhausted'}}),{status:429}))as typeof fetch;
 try{const pending=call(c,slow);await assert.rejects(call(c,billing,'billing'),/MODEL_CREDIT_EXHAUSTED/);complete();await pending;assert.equal(c.snapshot().blocks.planner?.code,'MODEL_CREDIT_EXHAUSTED');}finally{store.close();}
});

test('an overlapping timeout cannot replace a sticky billing block with a cooldown',async()=>{
 const store=new Store(':memory:',fixture());let complete!:()=>void;
 const c=new ModelRequests(store);
 const slow=(async()=>{await new Promise<void>(r=>complete=r);throw new DOMException('timeout','TimeoutError');})as typeof fetch;
 const billing=(async()=>new Response(JSON.stringify({error:{code:'credit_balance_exhausted'}}),{status:429}))as typeof fetch;
 try{const pending=call(c,slow);await assert.rejects(call(c,billing,'billing'),/MODEL_CREDIT_EXHAUSTED/);complete();await assert.rejects(pending,/MODEL_TIMEOUT/);assert.equal(c.snapshot().blocks.planner?.code,'MODEL_CREDIT_EXHAUSTED');assert.equal(c.snapshot().blocks.planner?.retryAt,undefined);}finally{store.close();}
});
