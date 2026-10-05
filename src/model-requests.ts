import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Store} from './store.ts';
import {reserveInput,type InputPrefix} from './model-input-reservation.ts';

export type ModelProvider='planner'|'reviewer';
export interface ModelUsage {inputTokens:number;cachedTokens:number;outputTokens:number;reasoningTokens:number}
export interface ModelRequestRecord {
 id:string;runId:string;provider:ModelProvider;model:string;at:number;completedAt?:number;latencyMs?:number;
 status:'RESERVED'|'COMPLETE'|'REJECTED'|'UNKNOWN';reservedTokens:number;reservedCostNanoUsd?:number;
 usage?:ModelUsage;estimatedCostNanoUsd?:number;error?:string;
 inputPrefix?:InputPrefix;inputReservation?:{method:'BYTE_BOUND'|'OBSERVED_PREFIX';inputTokens:number;anchorId?:string};
}
export interface ModelControl {requests:ModelRequestRecord[];blocks:Partial<Record<ModelProvider,{code:string;at:number;retryAt?:number}>>;resetVersion?:number;configurationVersion?:number;archivedRequests?:number;limits?:ModelLimits}
export interface ModelLimits {maxRunRequests:number;maxDayRequests:number;maxRunTokens:number;maxDayTokens:number;maxRunCostNanoUsd:number;maxDayCostNanoUsd:number}
export const defaultModelLimits:ModelLimits={maxRunRequests:40,maxDayRequests:120,maxRunTokens:250_000,maxDayTokens:500_000,maxRunCostNanoUsd:500_000_000,maxDayCostNanoUsd:1_000_000_000};
export function modelLimits(env:NodeJS.ProcessEnv=process.env):ModelLimits {
 const out={...defaultModelLimits};
 for(const [key,name]of Object.entries({maxRunRequests:'LLM_MAX_RUN_REQUESTS',maxDayRequests:'LLM_MAX_DAY_REQUESTS',maxRunTokens:'LLM_MAX_RUN_TOKENS',maxDayTokens:'LLM_MAX_DAY_TOKENS',maxRunCostNanoUsd:'LLM_MAX_RUN_COST_NANO_USD',maxDayCostNanoUsd:'LLM_MAX_DAY_COST_NANO_USD'}))if(env[name]!==undefined)out[key as keyof ModelLimits]=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER/1000).parse(env[name]);
 return out;
}
// Standard text estimates as of 2026-10-04, nano-USD per token. Not invoices.
function rates(provider:ModelProvider,model:string){
 if(provider!=='planner')return;
 if(/^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model))return [750,75,4500];
 if(/^gpt-5\.4-nano(?:-\d{4}-\d{2}-\d{2})?$/.test(model))return [200,20,1250];
 if(/^gpt-5\.4(?:-\d{4}-\d{2}-\d{2})?$/.test(model))return [2500,250,15000];
}
function cost(provider:ModelProvider,model:string,u:ModelUsage){const r=rates(provider,model);return r?(u.inputTokens-u.cachedTokens)*r[0]+u.cachedTokens*r[1]+u.outputTokens*r[2]:undefined;}
const Usage=z.object({input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative(),input_tokens_details:z.object({cached_tokens:z.number().int().nonnegative()}).optional(),output_tokens_details:z.object({reasoning_tokens:z.number().int().nonnegative()}).optional()});
function usage(raw:unknown):ModelUsage|undefined{const p=Usage.safeParse(raw);if(!p.success)return;const u=p.data,c=u.input_tokens_details?.cached_tokens??0,r=u.output_tokens_details?.reasoning_tokens??0;if(c>u.input_tokens||r>u.output_tokens)return;return {inputTokens:u.input_tokens,cachedTokens:c,outputTokens:u.output_tokens,reasoningTokens:r};}
const billCodes=new Set(['credit_balance_exhausted','insufficient_quota','billing_hard_limit_reached','usage_limit_reached','billing_not_active']);
function errorCode(status:number,body:any){
 if([body?.error?.code,body?.error?.type].some(c=>billCodes.has(c)))return 'MODEL_CREDIT_EXHAUSTED';
 if(status===401||status===403)return 'MODEL_AUTH_FAILED';
 if(status===429)return 'MODEL_RATE_LIMITED';
 if(status>=500)return 'MODEL_TEMPORARILY_UNAVAILABLE';
 return 'MODEL_CONFIG_FAILED';
}
export const modelFailureCodes=new Set(['MODEL_DISABLED','MODEL_CREDIT_EXHAUSTED','MODEL_AUTH_FAILED','MODEL_CONFIG_FAILED','MODEL_RATE_LIMITED','MODEL_TEMPORARILY_UNAVAILABLE','MODEL_TIMEOUT','MODEL_CONNECTION_FAILED','MODEL_BUDGET_EXCEEDED','MODEL_RUN_LIMIT','MODEL_USAGE_STORAGE_LIMIT','MODEL_RESPONSE_INVALID','MODEL_RESPONSE_INCOMPLETE','MODEL_REPEATED_TOOL_CALL','MODEL_NO_PROGRESS']);
export class ModelRequestError extends Error {constructor(code:string){super(code);this.name='ModelRequestError';}}
export class ModelRequests {
 private local:ModelControl={requests:[],blocks:{}};
 private archived:ModelRequestRecord[]=[];
 constructor(private store?:Store,private configuredLimits=modelLimits(),private clock=()=>Date.now()){}
 get limits():ModelLimits{return {...this.configuredLimits,...this.store?.read().modelControl?.limits};}
 private change<T>(fn:(c:ModelControl)=>T):T {return this.store?this.store.change(s=>fn(s.modelControl??={requests:[],blocks:{}})):fn(this.local);}
 snapshot(){return structuredClone(this.store?.read().modelControl??this.local);}
 reset(){this.change(c=>{c.blocks={};c.resetVersion=(c.resetVersion??0)+1;});}
 private compact(c:ModelControl,dayStart:number,runId:string) {
  if(c.requests.length<10000)return;
  const state=this.store?.read();
  const protectedRuns=new Set([runId,...(state?.runs.filter(r=>r.status==='RUNNING').map(r=>r.id)??[])]);
  // Keep evidence needed to resolve outstanding provider incidents as well.
  for(const job of state?.autonomy?.jobs.filter(j=>j.status==='NEEDS_ATTENTION'||j.status==='READY'||j.status==='LEASED')??[])if(job.runId)protectedRuns.add(job.runId);
  const historical=c.requests.filter(r=>r.at<dayStart&&!protectedRuns.has(r.runId)&&(r.status==='COMPLETE'||r.status==='REJECTED'));
  if(!historical.length)return;
  if(this.store)this.store.archiveModelRequests(historical);else this.archived.push(...historical);
  const ids=new Set(historical.map(r=>r.id));c.requests=c.requests.filter(r=>!ids.has(r.id));
  c.archivedRequests=(c.archivedRequests??0)+historical.length;
 }
 private block(c:ModelControl,provider:ModelProvider,next:NonNullable<ModelControl['blocks'][ModelProvider]>){
  const previous=c.blocks[provider];
  // An in-flight response cannot weaken a sticky failure or a longer cooldown.
  if(previous&&(previous.retryAt===undefined||next.retryAt!==undefined&&previous.retryAt>next.retryAt))return;
  c.blocks[provider]=next;
 }
 private reserve(provider:ModelProvider,model:string,url:string,runId:string,body:string){
  const now=this.clock(),day=new Date(now).toISOString().slice(0,10),maxOutput=JSON.parse(body).max_output_tokens??4096;
  const output=z.number().int().positive().max(128000).parse(maxOutput);
  return this.change(c=>{
   const block=c.blocks[provider];if(block&&(block.retryAt===undefined||block.retryAt>now))throw new ModelRequestError(block.code);
   this.compact(c,Date.parse(day),runId);
   if(c.requests.length>=10000)throw new ModelRequestError('MODEL_USAGE_STORAGE_LIMIT');
   const {inputTokens:input,method,prefix,anchorId}=reserveInput(provider,model,url,body,c.requests,runId,now);
   const reservation={tokens:input+output,cost:cost(provider,model,{inputTokens:input,cachedTokens:0,outputTokens:output,reasoningTokens:0})};
   const daily=c.requests.filter(r=>new Date(r.at).toISOString().slice(0,10)===day),run=c.requests.filter(r=>r.runId===runId);
   const tokens=(r:ModelRequestRecord)=>r.usage?r.usage.inputTokens+r.usage.outputTokens:r.reservedTokens;
   const dollars=(r:ModelRequestRecord)=>r.estimatedCostNanoUsd??r.reservedCostNanoUsd??0;
   const archived=this.store?.archivedModelRunUsage(runId)??this.archived.filter(r=>r.runId===runId).reduce((a,r)=>({requests:a.requests+1,tokens:a.tokens+tokens(r),cost:a.cost+dollars(r)}),{requests:0,tokens:0,cost:0});
   if(run.length+archived.requests>=this.limits.maxRunRequests||archived.tokens+run.reduce((n,r)=>n+tokens(r),0)+reservation.tokens>this.limits.maxRunTokens||archived.cost+run.reduce((n,r)=>n+dollars(r),0)+(reservation.cost??0)>this.limits.maxRunCostNanoUsd)throw new ModelRequestError('MODEL_RUN_LIMIT');
   if(daily.length>=this.limits.maxDayRequests||daily.reduce((n,r)=>n+tokens(r),0)+reservation.tokens>this.limits.maxDayTokens||daily.reduce((n,r)=>n+dollars(r),0)+(reservation.cost??0)>this.limits.maxDayCostNanoUsd)throw new ModelRequestError('MODEL_BUDGET_EXCEEDED');
   const id=randomUUID();c.requests.push({id,runId,provider,model,at:now,status:'RESERVED',reservedTokens:reservation.tokens,reservedCostNanoUsd:reservation.cost,inputPrefix:prefix,inputReservation:{method,inputTokens:input,anchorId}});return id;
  });
 }
 async request(provider:ModelProvider,model:string,url:string,init:RequestInit,transport:typeof fetch,runId:string=randomUUID()):Promise<Response>{
  if(typeof init.body!=='string')throw new ModelRequestError('MODEL_CONFIG_FAILED');
   if(init.signal?.aborted)throw new ModelRequestError('MODEL_TIMEOUT');
   let id:string;
   try{id=this.reserve(provider,model,url,runId,init.body);}catch(error){
    if(error instanceof ModelRequestError&&error.message==='MODEL_BUDGET_EXCEEDED')this.change(c=>{this.block(c,provider,{code:error.message,at:this.clock(),retryAt:Date.parse(new Date(this.clock()).toISOString().slice(0,10))+86400000});});
    throw error;
   }
   const at=this.clock();
   let response:Response;
   try{response=await transport(url,init);}catch(error){
    const code=error instanceof Error&&error.name==='TimeoutError'?'MODEL_TIMEOUT':'MODEL_CONNECTION_FAILED';
    this.change(c=>{Object.assign(c.requests.find(r=>r.id===id)!,{status:'UNKNOWN',error:code,completedAt:this.clock(),latencyMs:this.clock()-at});this.block(c,provider,{code,at:this.clock(),retryAt:this.clock()+300_000});});
    throw new ModelRequestError(code);
   }
   let body:any;
   try{body=await response.clone().json();}catch{
    if(response.ok){
     const code=init.signal?.aborted?'MODEL_TIMEOUT':'MODEL_RESPONSE_INVALID';
     this.change(c=>{Object.assign(c.requests.find(r=>r.id===id)!,{status:'UNKNOWN',error:code,completedAt:this.clock(),latencyMs:this.clock()-at});this.block(c,provider,{code,at:this.clock(),...(code==='MODEL_TIMEOUT'?{retryAt:this.clock()+300_000}:{})});});
     throw new ModelRequestError(code);
    }
   }
   if(response.ok){
    const u=usage(body?.usage);this.change(c=>{Object.assign(c.requests.find(r=>r.id===id)!,{status:u?'COMPLETE':'UNKNOWN',usage:u,estimatedCostNanoUsd:u?cost(provider,model,u):undefined,completedAt:this.clock(),latencyMs:this.clock()-at});const block=c.blocks[provider];if(block?.retryAt!==undefined&&block.retryAt<=at)delete c.blocks[provider];});
    return response;
   }
   const code=errorCode(response.status,body);
   this.change(c=>Object.assign(c.requests.find(r=>r.id===id)!,{status:'REJECTED',error:code,completedAt:this.clock(),latencyMs:this.clock()-at}));
   const transient=code==='MODEL_RATE_LIMITED'||code==='MODEL_TEMPORARILY_UNAVAILABLE';
   const header=response.headers.get('retry-after'),numeric=header?Number(header):NaN;
   const delay=header?(Number.isFinite(numeric)?numeric*1000:Date.parse(header)-this.clock()):1000;
   this.change(c=>{this.block(c,provider,{code,at:this.clock(),...(transient?{retryAt:this.clock()+Math.max(300_000,Number.isFinite(delay)?delay:0)}:{})});});
   throw new ModelRequestError(code);
 }
}
