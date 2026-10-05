import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {fixture} from '../src/domain.ts';
import {WalletSettingsService} from '../src/wallet-settings.ts';
import {createApp} from '../src/app.ts';
import {Engine} from '../src/engine.ts';
import {RulesPlanner} from '../src/planner.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';

function setup(){
 const root=mkdtempSync(join(tmpdir(),'settlepilot-wallet-'));const store=new Store(':memory:',fixture());
 const commands:string[][]=[];let accepted=false;let valid=false;const address=`0x${'5'.repeat(40)}`;
 const env:NodeJS.ProcessEnv={OPENAI_API_KEY:'unit-test-preserved-key',OPENAI_MODEL:'owner-model'};
 writeFileSync(join(root,'.env'),'OPENAI_API_KEY=unit-test-preserved-key\nOPENAI_MODEL=owner-model\nUNRELATED=keep\n');
 const service=new WalletSettingsService(store,{root,env,envFile:join(root,'.env'),entrypoint:join(root,'circle/dist/index.js'),verifyNetwork:async rpc=>{if(rpc!=='https://private-rpc.example/token')throw Error('wrong network');},cli:async args=>{
  commands.push(args);
  if(args[0]==='terms') {if(args[1]==='accept'){accepted=true;return {data:{}};}return {data:args.includes('--init')?{currentVersion:1,termsOfUseUrl:'https://circle.example/terms',privacyPolicyUrl:'https://circle.example/privacy',termsNotice:'Test Terms'}:{accepted,currentVersion:1}};}
  if(args[1]==='status')return {data:{testnet:{tokenStatus:valid?'VALID':'NOT_LOGGED_IN',email:'owner@example.test'}}};
  if(args[1]==='login'){if(args.includes('--otp')){valid=true;return {data:{message:'Logged in'}};}return {data:{message:'OTP code sent. --request 00000000-0000-4000-8000-000000000001 --otp <code>'}};}
  if(args[1]==='list')return {data:{wallets:[{type:'agent',address,blockchain:'ARC-TESTNET'},{type:'agent',address:`0x${'6'.repeat(40)}`,blockchain:'ARC'}]}};
  return {data:{}};
 }});
 return {root,store,service,commands,env,address,cleanup(){store.close();rmSync(root,{recursive:true,force:true});}};
}
test('wallet setup requires presented current Terms and explicit consent before testnet OTP flow',async()=>{
 const c=setup();try{
  await assert.rejects(c.service.login({email:'owner@example.test'}),/CIRCLE_TERMS_REQUIRED/);
  await assert.rejects(c.service.accept({confirmed:true,version:1}),/REVIEW_CURRENT_TERMS/);
  const view=await c.service.inspect();assert.equal(view.termsAccepted,false);
  await assert.rejects(c.service.accept({confirmed:false,version:1}));
  await c.service.accept({confirmed:true,version:1});await c.service.login({email:'owner@example.test'});
  await c.service.verifyOtp({otp:'ABC-123456'});
  const connected=await c.service.inspect();assert.equal(connected.sessionValid,true);assert.equal(connected.wallets.length,1);
  assert.equal(JSON.stringify(connected).includes('123456'),false);
  assert.ok(c.commands.filter(args=>args[1]==='login').every(args=>args.includes('--testnet')));
  await assert.rejects(c.service.login({email:'different@example.test'}),/CIRCLE_SESSION_ALREADY_CONNECTED/);
  await assert.rejects(c.service.verifyOtp({otp:'ABC-123456'}),/OTP_REQUEST_EXPIRED/);
 }finally{c.cleanup();}
});
test('wallet config verifies identity and network, preserves keys and initializes disabled authority without touching simulation history',async()=>{
 const c=setup();try{
  await c.service.inspect();await c.service.accept({confirmed:true,version:1});
  await assert.rejects(c.service.configure({sender:`0x${'9'.repeat(40)}`,rpcUrl:'https://private-rpc.example/token'}),/AGENT_WALLET_NOT_FOUND/);
  await assert.rejects(c.service.configure({sender:c.address,rpcUrl:'https://wrong.example'}),/ARC_NETWORK_CHECK_FAILED/);
  await assert.rejects(c.service.configure({sender:c.address,rpcUrl:'http://wrong.example'}));
  const result=await c.service.configure({sender:c.address,rpcUrl:'https://private-rpc.example/token'});
  assert.equal(result.restartRequired,true);assert.equal(result.sendingEnabled,false);assert.equal(JSON.stringify(result).includes('private-rpc'),false);
  const policy=JSON.parse(readFileSync(join(c.root,'data/policy.json'),'utf8'));assert.equal(policy.sender,c.address);assert.equal(policy.enabled,false);assert.deepEqual(policy.allowlist,[]);
  const env=readFileSync(join(c.root,'.env'),'utf8');assert.match(env,/DATABASE_PATH=data\/testnet.db/);assert.match(env,/SEND_ENABLED=false/);assert.match(env,/OPENAI_API_KEY=unit-test-preserved-key/);assert.match(env,/UNRELATED=keep/);assert.equal(c.env.OPENAI_API_KEY,'unit-test-preserved-key');
  assert.equal(c.store.read().mode,'simulation');assert.equal(c.store.read().obligations.length,3);
  c.store.change(s=>{s.mode='testnet';});await assert.rejects(c.service.configure({sender:c.address,rpcUrl:'https://private-rpc.example/token'}),/EXISTING_WALLET_CHANGE_REQUIRES_MIGRATION/);
 }finally{c.cleanup();}
});
test('wallet settings and stop controls are localhost-session protected and cannot bypass in-flight reconciliation',async()=>{
 const c=setup(),engine=new Engine(c.store,new SimulationGateway(c.store),new RulesPlanner());let stops=0;
 const server=createApp({store:c.store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'},'owner-session',{wallet:c.service,stop:()=>{stops++;}}).listen(0,'127.0.0.1');
 await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/`;
 const headers={Authorization:'Bearer owner-session','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(base+'wallet-settings')).status,401);
  assert.equal((await fetch(base+'wallet-settings/inspect',{method:'POST'})).status,401);assert.equal(c.commands.length,0);
  assert.equal((await fetch(base+'wallet-settings/inspect',{method:'POST',headers:{...headers,Origin:'https://foreign.example'},body:'{}'})).status,403);assert.equal(c.commands.length,0);
  const settings=await(await fetch(base+'wallet-settings',{headers})).json();assert.equal(JSON.stringify(settings).includes('unit-test-preserved-key'),false);
  assert.equal((await fetch(base+'local/stop',{method:'POST',headers,body:'{}'})).status,400);
  const o=c.store.read().obligations[0];c.store.change(s=>s.intents.push({id:'pending',runId:'r',obligationId:o.id,amount:o.amount,recipient:o.recipient,sender:s.policy.sender,chainId:5042002,policyVersion:1,obligationVersion:1,idempotencyKey:'key',status:'EXECUTION_UNKNOWN',createdAt:o.due}));
  const response=await fetch(base+'local/stop',{method:'POST',headers,body:'{"confirmed":true}'});assert.equal(response.status,400);assert.equal((await response.json()).error,'RECONCILE_REQUIRED');assert.equal(stops,0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));c.cleanup();}
});
test('returning to a configured testnet wallet retains scope, balances, budgets and execution flags',async()=>{
 const c=setup();try{
  await c.service.inspect();await c.service.accept({confirmed:true,version:1});c.env.WALLET_PROVIDER='agent';c.env.SEND_ENABLED='true';c.env.BRIDGE_ENABLED='true';
  c.store.change(s=>{s.mode='testnet';s.paused=true;s.policy.sender=c.address;});const before=JSON.stringify(c.store.read());
  await c.service.configure({sender:c.address,rpcUrl:'https://private-rpc.example/token'});
  assert.equal(c.env.SEND_ENABLED,'true');assert.equal(c.env.BRIDGE_ENABLED,'true');assert.equal(JSON.stringify(c.store.read()),before);
 }finally{c.cleanup();}
});
test('wallet setup cannot switch configuration during active autonomous operation or provider execution',async()=>{
 const c=setup();try{
  await c.service.inspect();await c.service.accept({confirmed:true,version:1});c.store.change(s=>s.autonomy!.enabled=true);
  await assert.rejects(c.service.configure({sender:c.address,rpcUrl:'https://private-rpc.example/token'}),/PAUSE_BEFORE_SETUP/);
  c.store.change(s=>{s.paused=true;s.runs.push({id:'run',createdAt:new Date().toISOString(),source:'test',status:'RUNNING',decisions:[]});});
  await assert.rejects(c.service.configure({sender:c.address,rpcUrl:'https://private-rpc.example/token'}),/AGENT_RUN_IN_PROGRESS/);
 }finally{c.cleanup();}
});
