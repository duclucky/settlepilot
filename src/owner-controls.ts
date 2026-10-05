import {z} from 'zod';
import {Address,CHAIN_ID,SOURCE_CHAIN_NAMES,money,type Snapshot,type State} from './domain.ts';
import {Store,event} from './store.ts';
import {assertSetupIdle} from './wallet-settings.ts';
import {updateLocalEnv} from './local-env.ts';
import {ModelRequests,type ModelLimits} from './model-requests.ts';

const Amount=z.string().transform(money);
const Version=z.number().int().nonnegative();
const Grant=z.object({confirmed:z.literal(true),policyVersion:Version,financialVersion:Version,
 allowlist:z.array(Address).min(1).max(100),reserve:Amount,gasLimit:Amount,perObligation:Amount,totalBudget:Amount,authorityExpiresAt:z.iso.datetime(),
 bridge:z.object({enabled:z.boolean(),sourceChains:z.array(z.enum(SOURCE_CHAIN_NAMES)).min(1).max(SOURCE_CHAIN_NAMES.length),maxAmount:Amount,maxFee:Amount}).strict()}).strict();
const Limit=z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER/1000));
export const LimitsSchema=z.object({maxRunRequests:Limit,maxDayRequests:Limit,maxRunTokens:Limit,maxDayTokens:Limit,maxRunCostNanoUsd:Limit,maxDayCostNanoUsd:Limit}).strict();
export class OwnerControls {
 private env:NodeJS.ProcessEnv;private envFile:string;
 constructor(private store:Store,options:{env?:NodeJS.ProcessEnv;envFile?:string}={}){this.env=options.env??process.env;this.envFile=options.envFile??'.env';}
 executionSettings(){return {sendEnabled:this.env.SEND_ENABLED==='true',bridgeEnabled:this.env.BRIDGE_ENABLED==='true'};}
 private checkVersion(s:State,p:number,f?:number){if(s.policy.version!==p||(f!==undefined&&s.financialVersion!==f))throw new Error('AUTHORITY_CHANGED');}
 async grant(raw:unknown,verify:()=>Promise<Snapshot>) {
  const input=Grant.parse(raw);assertSetupIdle(this.store);const before=this.store.read();this.checkVersion(before,input.policyVersion,input.financialVersion);
  if(before.mode!=='testnet')throw new Error('CONNECT_TESTNET_WALLET_FIRST');
  if(new Set(input.allowlist).size!==input.allowlist.length||input.allowlist.includes(before.policy.sender))throw new Error('INVALID_RECIPIENT');
  if(new Set(input.bridge.sourceChains).size!==input.bridge.sourceChains.length)throw new Error('INVALID_SOURCE_CHAINS');
  const expires=Date.parse(input.authorityExpiresAt);
  if(expires<=Date.now()||expires>Date.now()+366*86400000)throw new Error('INVALID_AUTHORITY_EXPIRY');
  if(BigInt(input.perObligation)<=0n||BigInt(input.totalBudget)<BigInt(input.perObligation)||BigInt(input.bridge.maxAmount)<=0n||BigInt(input.bridge.maxFee)>BigInt(input.bridge.maxAmount))throw new Error('INVALID_AUTHORITY_LIMITS');
  const snapshot=await verify();
  if(snapshot.chainId!==CHAIN_ID)throw new Error('WRONG_CHAIN');
  if(!Number.isFinite(Date.parse(snapshot.observedAt))||Math.abs(Date.now()-Date.parse(snapshot.observedAt))>30000)throw new Error('STALE_BALANCE');
  this.store.change(s=>{
   assertSetupIdle(this.store);this.checkVersion(s,input.policyVersion,input.financialVersion);
   if(Date.parse(input.authorityExpiresAt)<=Date.now())throw new Error('INVALID_AUTHORITY_EXPIRY');
   const spent=s.intents.filter(i=>['SETTLED','SIMULATED'].includes(i.status)).reduce((n,i)=>n+BigInt(i.amount),0n);
   if(BigInt(input.totalBudget)<spent)throw new Error('BUDGET_BELOW_SPENT');
   const {confirmed,policyVersion,financialVersion,bridge,...limits}=input;
   s.policy={...s.policy,...limits,enabled:true,version:s.policy.version+1};
   s.bridgePolicy={...bridge,version:s.bridgePolicy.version+1};s.snapshot=snapshot;s.approvals=[];
   for(const run of s.runs)if(run.executionStatus==='PLANNED')run.executionStatus='INVALIDATED';
   event(s,'OWNER_AUTHORITY_GRANTED',`owner; policy ${s.policy.version}; expires ${s.policy.authorityExpiresAt}; ${s.policy.allowlist.length} recipients`);
  });
  return {ok:true,policyVersion:this.store.read().policy.version};
 }
 revoke(raw:unknown){const input=z.object({confirmed:z.literal(true),policyVersion:Version}).strict().parse(raw);
  this.store.change(s=>{this.checkVersion(s,input.policyVersion);s.policy.enabled=false;s.policy.version++;s.bridgePolicy.enabled=false;s.bridgePolicy.version++;s.paused=true;s.approvals=[];for(const run of s.runs)if(run.executionStatus==='PLANNED')run.executionStatus='INVALIDATED';event(s,'OWNER_AUTHORITY_REVOKED','owner; new operations paused; submitted transactions retained for reconciliation');});return {ok:true};
 }
 configureExecution(raw:unknown){const input=z.object({confirmed:z.literal(true),sendEnabled:z.boolean(),bridgeEnabled:z.boolean(),policyVersion:Version}).strict().parse(raw);
  assertSetupIdle(this.store);const s=this.store.read();this.checkVersion(s,input.policyVersion);
  if(s.mode!=='testnet')throw new Error('CONNECT_TESTNET_WALLET_FIRST');
  if((input.sendEnabled||input.bridgeEnabled)&&(!s.policy.enabled||Date.parse(s.policy.authorityExpiresAt)<=Date.now()))throw new Error('GRANT_AUTHORITY_FIRST');
  if(input.bridgeEnabled&&!s.bridgePolicy.enabled)throw new Error('GRANT_BRIDGE_AUTHORITY_FIRST');
  const values={SEND_ENABLED:String(input.sendEnabled),BRIDGE_ENABLED:String(input.bridgeEnabled)};
  updateLocalEnv(this.envFile,values);Object.assign(this.env,values);
  return {...this.executionSettings(),restartRequired:true};
 }
 configureLimits(raw:unknown):ModelLimits {const input=z.object({confirmed:z.literal(true),limits:LimitsSchema}).strict().parse(raw);
  this.store.change(s=>{if(s.runs.some(r=>r.status==='RUNNING')||s.autonomy?.lease)throw new Error('AGENT_RUN_IN_PROGRESS');
   const c=s.modelControl??={requests:[],blocks:{}};c.limits=input.limits;event(s,'MODEL_LIMITS_UPDATED','owner; existing usage, reservations, blocks and pause preserved');});
  return new ModelRequests(this.store).limits;
 }
}
