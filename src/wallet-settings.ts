import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { Address, CHAIN_ID, isPending, isBridgePending } from './domain.ts';
import { Store } from './store.ts';
import { circleCli, type Cli } from './adapters/agent-wallet.ts';
import { ArcReader } from './adapters/arc.ts';
import { updateLocalEnv } from './local-env.ts';

type Options = {env?:NodeJS.ProcessEnv;envFile?:string;root?:string;cli?:Cli;entrypoint?:string;verifyNetwork?:(rpc:string)=>Promise<void>};
const Rpc=z.string().trim().url().max(2048).refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!/[\s'"#]/.test(value);},'HTTPS_RPC_REQUIRED');
const Envelope = z.object({data:z.unknown()});
function data(value:unknown){return Envelope.parse(value).data;}
export function findCircleEntrypoint(env:NodeJS.ProcessEnv=process.env):string|undefined {
  const candidates=[env.CIRCLE_CLI_ENTRYPOINT,join(dirname(process.execPath),'node_modules/@circle-fin/cli/dist/index.js'),env.APPDATA&&join(env.APPDATA,'npm/node_modules/@circle-fin/cli/dist/index.js')];
  return candidates.find((candidate):candidate is string=>{
    if(!candidate||!existsSync(candidate))return false;
    try{const pkg=JSON.parse(readFileSync(resolve(dirname(candidate),'../package.json'),'utf8'));return pkg.name==='@circle-fin/cli'&&pkg.version==='1.1.4';}catch{return false;}
  });
}
export function assertSetupIdle(store:Store){
  const s=store.read();
  if(s.runs.some(r=>r.status==='RUNNING')||s.autonomy?.lease)throw new Error('AGENT_RUN_IN_PROGRESS');
  if(s.intents.some(isPending)||s.bridgeIntents.some(isBridgePending))throw new Error('RECONCILE_REQUIRED');
  if(!s.paused&&s.autonomy?.enabled)throw new Error('PAUSE_BEFORE_SETUP');
}

/** Local setup only: no arbitrary CLI commands, credential import or transfer methods. */
export class WalletSettingsService {
  private env:NodeJS.ProcessEnv;private root:string;private envFile:string;
  private request?:{id:string;expires:number};private busy=false;
  private termsVersion?:number;
  constructor(private store:Store,private options:Options={}){
    this.env=options.env??process.env;this.root=resolve(options.root??'.');this.envFile=resolve(options.envFile??'.env');
  }
  private entrypoint(){return this.options.entrypoint??findCircleEntrypoint(this.env);}
  private command(args:string[]){const entry=this.entrypoint();if(!entry)throw new Error('CIRCLE_CLI_NOT_INSTALLED');return (this.options.cli??circleCli(entry))(args);}
  private async exclusive<T>(action:()=>Promise<T>){if(this.busy)throw new Error('WALLET_SETUP_BUSY');this.busy=true;try{return await action();}finally{this.busy=false;}}
  settings(){const s=this.store.read();return {cliInstalled:!!this.entrypoint(),cliVersion:'1.1.4',mode:s.mode,sender:s.mode==='testnet'?s.policy.sender:undefined,rpcConfigured:!!this.env.ARC_TESTNET_RPC_URL,restartRequired:s.mode==='simulation'&&this.env.TAMEION_MODE==='testnet',sendingEnabled:this.env.SEND_ENABLED==='true',network:'ARC-TESTNET',chainId:CHAIN_ID};}
  async inspect(){return this.exclusive(async()=>{
    const terms=z.object({accepted:z.boolean(),currentVersion:z.number()}).parse(data(await this.command(['terms','show','--output','json'])));
    if(!terms.accepted){
      const notice=z.object({currentVersion:z.number(),termsOfUseUrl:z.string().url(),privacyPolicyUrl:z.string().url(),termsNotice:z.string()}).parse(data(await this.command(['terms','show','--init','--output','json'])));
      for(const url of [notice.termsOfUseUrl,notice.privacyPolicyUrl])if(new URL(url).protocol!=='https:')throw new Error('INVALID_TERMS_RESPONSE');
      this.termsVersion=notice.currentVersion;
      return {...this.settings(),termsAccepted:false,terms:notice,sessionValid:false,wallets:[]};
    }
    let sessionValid=false;
    try{const status=z.object({testnet:z.object({tokenStatus:z.string()})}).parse(data(await this.command(['wallet','status','--type','agent','--output','json'])));sessionValid=status.testnet.tokenStatus==='VALID';}catch{/* A missing or expired session is not a wallet connection. */}
    return {...this.settings(),termsAccepted:true,sessionValid,wallets:sessionValid?await this.wallets():[]};
  });}
  private async requireTerms(){const terms=z.object({accepted:z.boolean()}).parse(data(await this.command(['terms','show','--output','json'])));if(!terms.accepted)throw new Error('CIRCLE_TERMS_REQUIRED');}
  async accept(raw:unknown){const input=z.object({confirmed:z.literal(true),version:z.number()}).strict().parse(raw);return this.exclusive(async()=>{
    if(this.termsVersion!==input.version)throw new Error('REVIEW_CURRENT_TERMS');
    const notice=z.object({currentVersion:z.number()}).parse(data(await this.command(['terms','show','--init','--output','json'])));
    if(notice.currentVersion!==input.version)throw new Error('REVIEW_CURRENT_TERMS');
    await this.command(['terms','accept','--output','json']);await this.requireTerms();this.termsVersion=undefined;return {ok:true};
  });}
  async login(raw:unknown){const input=z.object({email:z.email().max(254)}).strict().parse(raw);return this.exclusive(async()=>{
    assertSetupIdle(this.store);await this.requireTerms();
    // Do not silently replace an existing testnet identity.
    try{const status=z.object({testnet:z.object({tokenStatus:z.string(),email:z.string().optional()})}).parse(data(await this.command(['wallet','status','--type','agent','--output','json'])));if(status.testnet.tokenStatus==='VALID')throw new Error('CIRCLE_SESSION_ALREADY_CONNECTED');}catch(error){if(error instanceof Error&&error.message==='CIRCLE_SESSION_ALREADY_CONNECTED')throw error;}
    const result=z.object({message:z.string()}).parse(data(await this.command(['wallet','login',input.email,'--type','agent','--testnet','--init','--output','json'])));
    const id=result.message.match(/--request\s+([0-9a-f-]{36})/i)?.[1];if(!id)throw new Error('CIRCLE_LOGIN_UNAVAILABLE');
    this.request={id:z.uuid().parse(id),expires:Date.now()+600_000};return {otpRequired:true};
  });}
  async verifyOtp(raw:unknown){const input=z.object({otp:z.string().trim().regex(/^(?:[A-Z0-9]{3}-)?\d{6}$/i)}).strict().parse(raw);return this.exclusive(async()=>{
    assertSetupIdle(this.store);await this.requireTerms();if(!this.request||Date.now()>this.request.expires){this.request=undefined;throw new Error('OTP_REQUEST_EXPIRED');}
    const request=this.request;this.request=undefined;
    await this.command(['wallet','login','--type','agent','--testnet','--request',request.id,'--otp',input.otp,'--output','json']);
    return {ok:true};
  });}
  private async wallets(){
    const result=z.object({wallets:z.array(z.object({type:z.string(),address:Address,blockchain:z.string()}))}).parse(data(await this.command(['wallet','list','--chain','ARC-TESTNET','--type','agent','--output','json'])));
    return result.wallets.filter(w=>w.type==='agent'&&w.blockchain==='ARC-TESTNET').map(w=>({address:w.address,network:'ARC-TESTNET'}));
  }
  async create(){return this.exclusive(async()=>{assertSetupIdle(this.store);await this.requireTerms();await this.command(['wallet','create','--testnet','--output','json']);return {wallets:await this.wallets()};});}
  async configure(raw:unknown){const input=z.object({sender:Address,rpcUrl:Rpc.optional()}).strict().parse(raw);return this.exclusive(async()=>{
    assertSetupIdle(this.store);await this.requireTerms();const s=this.store.read();
    if(s.mode==='testnet'&&input.sender!==s.policy.sender)throw new Error('EXISTING_WALLET_CHANGE_REQUIRES_MIGRATION');
    if(s.mode==='testnet'&&this.env.WALLET_PROVIDER!=='agent')throw new Error('EXISTING_WALLET_CHANGE_REQUIRES_MIGRATION');
    if(!(await this.wallets()).some(w=>w.address===input.sender))throw new Error('AGENT_WALLET_NOT_FOUND');
    const rpc=Rpc.parse(input.rpcUrl??this.env.ARC_TESTNET_RPC_URL??'');
    try{await (this.options.verifyNetwork??(async value=>new ArcReader(value).network()))(rpc);}catch{throw new Error('ARC_NETWORK_CHECK_FAILED');}
    assertSetupIdle(this.store);
    const entry=this.entrypoint()!;if(/[\r\n#]/.test(entry))throw new Error('INVALID_CLI_PATH');
    let policyFile=this.env.POLICY_FILE??'data/policy.json';
    if(s.mode==='simulation'){
      const databasePath=resolve(this.root,'data/testnet.db');
      if(existsSync(databasePath)){
        const db=new DatabaseSync(databasePath,{readOnly:true});
        try{const row=db.prepare('SELECT body FROM state WHERE id=1').get() as {body:string}|undefined;
          const binding=db.prepare('SELECT identity FROM wallet_binding WHERE id=1').get() as {identity:string}|undefined;
          const saved=row&&JSON.parse(row.body);
          if(!saved||saved.mode!=='testnet'||saved.policy.sender!==input.sender||binding?.identity!==`agent:${input.sender}`)throw new Error('EXISTING_WALLET_CHANGE_REQUIRES_MIGRATION');
        }finally{db.close();}
      }
      policyFile='data/policy.json';const path=resolve(this.root,policyFile);
      if(existsSync(path)){const policy=JSON.parse(readFileSync(path,'utf8'));if(policy.sender!==input.sender||policy.chainId!==CHAIN_ID)throw new Error('EXISTING_POLICY_REQUIRES_REVIEW');}
      else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({version:1,chainId:CHAIN_ID,sender:input.sender,allowlist:[],reserve:'0',gasLimit:'1000000',perObligation:'1000000',totalBudget:'1000000',authorityExpiresAt:new Date(0).toISOString(),enabled:false},null,2)+'\n',{mode:0o600,flag:'wx'});}
    }
    const values:Record<string,string>={TAMEION_MODE:'testnet',WALLET_PROVIDER:'agent',CIRCLE_CLI_ENTRYPOINT:entry,ARC_TESTNET_RPC_URL:rpc,POLICY_FILE:policyFile};
    if(s.mode==='simulation'){values.DATABASE_PATH='data/testnet.db';values.SEND_ENABLED='false';values.BRIDGE_ENABLED='false';}
    updateLocalEnv(this.envFile,values);Object.assign(this.env,values);
    return {...this.settings(),restartRequired:true};
  });}
}
