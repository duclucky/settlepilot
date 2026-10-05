import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, money } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { AgentWorkspace } from '../src/agent-workspace.ts';
import { ModelPlanner } from '../src/adapters/model.ts';
import { Engine } from '../src/engine.ts';
import { SimulationGateway } from '../src/adapters/simulation.ts';
import { AgentScheduler, enqueue } from '../src/scheduler.ts';
import { syncActionRequests } from '../src/action-requests.ts';

function scripted(calls: {name:string;args:unknown}[], inspect?: (body:any)=>void):typeof fetch {
  let round=0;
  return (async(_url,init)=>{
    inspect?.(JSON.parse(init!.body as string));
    const c=calls[Math.min(round++,calls.length-1)];
    return new Response(JSON.stringify({output:[{type:'function_call',name:c.name,call_id:String(round),arguments:JSON.stringify(c.args)}]}));
  }) as typeof fetch;
}

test('autonomous wait survives restart, is bounded, and never creates financial authority',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tameion-wait-')),path=join(dir,'state.db');
  const state=fixture();state.snapshot.balance='0';state.evidence=[];state.bridgePolicy.enabled=true;state.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  let store=new Store(path,state);
  try {
    const workspace=new AgentWorkspace(store) as any;
    const w=workspace.wait('A','OBSERVATION_RECOVERY',60,'Waiting for the source-chain observation.');
    workspace.wait('A','OBSERVATION_RECOVERY',60,'Same recovery condition.');
    assert.equal(store.read().autonomy!.jobs.filter(j=>j.cause==='AGENT_RECHECK'&&j.status==='READY').length,1);
    store.close();store=new Store(path,state);
    assert.equal((store.read().autonomy as any).waits.length,1);
    assert.equal((store.read().autonomy as any).waits[0].id,w.waitId);
    for(let n=1;n<5;n++){
      store.change(s=>{const a=s.autonomy as any;a.waits.at(-1).dueAt=Date.now()-1;for(const j of a.jobs)j.status='DONE';});
      (new AgentWorkspace(store) as any).wait('A','OBSERVATION_RECOVERY',60,'Still recovering.');
    }
    store.change(s=>{(s.autonomy as any).waits.at(-1).dueAt=Date.now()-1;for(const j of s.autonomy!.jobs)j.status='DONE';});
    assert.throws(()=>(new AgentWorkspace(store) as any).wait('A','OBSERVATION_RECOVERY',60,'Still recovering.'),/WAIT_LIMIT_REACHED/);
    assert.equal(store.read().intents.length,0);assert.equal(store.read().approvals.length,0);
    assert.throws(()=>(new AgentWorkspace(store) as any).wait('A','OBSERVATION_RECOVERY',901,'Too long.'),/INVALID_WAIT/);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('unchanged recheck timers are free while a failed evaluation can retry after backoff',async()=>{
  const s=fixture();s.obligations=[];s.evidence=[];const store=new Store(':memory:',s);let calls=0,fail=false;let now=Date.now();
  const engine=new Engine(store,new SimulationGateway(store),{name:'offline planner',plan:async()=>{calls++;if(fail)throw new Error('temporary');return [];}});
  const runtime={store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'};
  const scheduler=new AgentScheduler(runtime,()=>now);
  try {
    scheduler.wake('INPUT','initial');await scheduler.tick();assert.equal(calls,1);
    store.change(s=>enqueue(s,'AGENT_RECHECK','timer',now+1000));await scheduler.tick();assert.equal(calls,1);
    now+=1001;await scheduler.tick();assert.equal(calls,1);
    fail=true;store.change(s=>{s.snapshot.balance='12345678';enqueue(s,'AGENT_RECHECK','failure',now);});await scheduler.tick();assert.equal(calls,2);
    fail=false;now+=16000;await scheduler.tick();assert.equal(calls,3);
    assert.equal(store.read().autonomy!.jobs.find(j=>j.key==='failure')!.status,'DONE');
  } finally {store.close();}
});

test('wait never overrides owner delay, acceptance or expiry; expected receipts are not spendable',()=>{
  const s=fixture();s.evidence=[];s.snapshot.balance='0';
  s.receivables.push({id:'expected',source:'Connected invoice',amount:money('50'),invoice:'invoice',cursor:'0',createdAt:new Date().toISOString()});
  s.obligations[0].due=new Date(Date.now()+30000).toISOString();
  const store=new Store(':memory:',s),workspace=new AgentWorkspace(store);
  try{
    const before=store.read();const wait=workspace.wait('A','EXPECTED_RECEIPT',600,'Connected invoice is expected.');
    assert.ok(Date.parse(wait.recheckAt)<=Date.parse(s.obligations[0].due));
    assert.equal(store.read().snapshot.balance,'0');assert.deepEqual(store.read().policy,before.policy);
    assert.throws(()=>workspace.wait('C','EXPECTED_RECEIPT',30,'Missing acceptance.'),/WAIT_NOT_APPLICABLE/);
    store.change(s=>{s.autonomy!.deferredUntil={A:Date.now()+60000};});
    assert.throws(()=>workspace.wait('A','EXPECTED_RECEIPT',30,'Ignore owner delay.'),/WAIT_NOT_APPLICABLE/);
    store.change(s=>{s.autonomy!.deferredUntil={};s.policy.authorityExpiresAt=new Date(Date.now()-1).toISOString();});
    assert.throws(()=>workspace.wait('A','EXPECTED_RECEIPT',30,'Expired authority.'),/WAIT_NOT_APPLICABLE/);
    assert.equal(store.read().intents.length,0);assert.equal(store.read().approvals.length,0);
  }finally{store.close();}
});

test('LLM queues one scoped question while another obligation can settle; repeated questions deduplicate',async()=>{
  const s=fixture();s.obligations=s.obligations.slice(0,2);s.evidence=[];s.snapshot.balance=money('30');s.policy.perObligation=money('5');
  const store=new Store(':memory:',s);
  const calls=[{name:'read_skill',args:{name:'settle-obligations'}},{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A','B']}},
    {name:'queue_owner_request',args:{obligationId:'B',policyReason:'NEEDS_APPROVAL',question:'Approve this payment above the delegated item limit?'}},
    {name:'queue_owner_request',args:{obligationId:'B',policyReason:'NEEDS_APPROVAL',question:'Approve this payment above the delegated item limit?'}},
    {name:'finish',args:{decisions:[{obligationId:'A',action:'PAY_NOW',reason:'Accepted within authority.',evidenceIds:[]},{obligationId:'B',action:'HOLD',reason:'Owner review required for this item.',evidenceIds:[]}]}}];
  try {
    const planner=new ModelPlanner('fixture','fixture',scripted(calls),new AgentWorkspace(store));
    const engine=new Engine(store,new SimulationGateway(store),planner);await engine.run();
    const current=store.read();assert.equal(current.runs[0].status,'DONE');assert.equal(current.obligations[0].paid,true);assert.equal(current.obligations[1].paid,false);
    assert.equal(current.agentNotifications.length,1);assert.equal(current.approvals.length,0);
    syncActionRequests(store);assert.equal(store.read().intents.length,1);
    assert.ok(store.read().autonomy!.jobs.some(j=>j.cause==='OWNER_PROPOSAL_SUPERSEDED'&&j.status==='READY'));
    engine.setPlanner(new ModelPlanner('fixture','fixture',scripted([
      {name:'check_policy',args:{obligationIds:['B']}},
      {name:'queue_owner_request',args:{obligationId:'B',policyReason:'NEEDS_APPROVAL',question:'Approve the remaining item above its limit?'}},
      {name:'finish',args:{decisions:[{obligationId:'B',action:'HOLD',reason:'Await the scoped owner decision.',evidenceIds:[]}]}}
    ]),new AgentWorkspace(store)));
    const scheduler=new AgentScheduler({store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'});
    await scheduler.tick();syncActionRequests(store);
    assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN'&&r.scope==='B').length,1);
    assert.equal(store.read().intents.length,1);
  } finally {store.close();}
});

test('LLM recovery context distinguishes unknown source balances; waiting forbids PAY_NOW',async()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.evidence=[];s.snapshot.balance='0';s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  const store=new Store(':memory:',s);let exposed=false;
  const calls=[{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},
    {name:'wait_for_conditions',args:{obligationId:'A',condition:'OBSERVATION_RECOVERY',retryAfterSeconds:60,reason:'Source RPC is unavailable; retry observation.'}},
    {name:'finish',args:{decisions:[{obligationId:'A',action:'PAY_NOW',reason:'Unverified money.',evidenceIds:[]}]}},
    {name:'finish',args:{decisions:[{obligationId:'A',action:'HOLD',reason:'Await fresh chain data.',evidenceIds:[]}]}}];
  try {
    const p=new ModelPlanner('fixture','fixture',scripted(calls,body=>{const initial=JSON.parse(body.input[0].content);exposed ||= initial.recoveryContext?.unavailableSourceChains?.includes('BASE-SEPOLIA');}),new AgentWorkspace(store));
    const decisions=await p.plan(store.read());assert.equal(exposed,true);assert.equal(decisions[0].action,'HOLD');
    assert.equal((store.read().autonomy as any).waits.length,1);assert.equal(store.read().agentNotifications.length,0);assert.equal(store.read().intents.length,0);
    assert.ok(store.read().agentToolCalls.every(t=>!t.detail.includes('fixture')));
  } finally {store.close();}
});

test('temporary observation failures get a recovery window, then a scoped question after five exhausted waits',async()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.evidence=[];s.snapshot.balance='0';s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  const store=new Store(':memory:',s),workspace=new AgentWorkspace(store);
  const question={name:'queue_owner_request',args:{obligationId:'A',policyReason:'OWNER_INSTRUCTION_REQUIRED',question:'Source observation is still unavailable. Check the local connection?'}};
  const hold={name:'finish',args:{decisions:[{obligationId:'A',action:'HOLD',reason:'Recover source observation before payment.',evidenceIds:[]}]}};
  try{
    const p=new ModelPlanner('fixture','fixture',scripted([
      {name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},question,
      {name:'wait_for_conditions',args:{obligationId:'A',condition:'OBSERVATION_RECOVERY',retryAfterSeconds:30,reason:'Recover source observations.'}},hold
    ]),workspace);
    await p.plan(store.read(),'offline-recovery');
    assert.equal(store.read().agentNotifications.length,0);
    assert.ok(store.read().agentToolCalls.some(t=>t.name==='queue_owner_request'&&t.status==='ERROR'&&t.detail==='AUTONOMOUS_RECOVERY_AVAILABLE'));
    for(let n=1;n<5;n++){
      store.change(s=>{s.autonomy!.waits!.at(-1)!.dueAt=Date.now()-1;for(const j of s.autonomy!.jobs)j.status='DONE';});
      workspace.wait('A','OBSERVATION_RECOVERY',30,'Still unavailable.');
    }
    store.change(s=>{s.autonomy!.waits!.at(-1)!.dueAt=Date.now()-1;for(const j of s.autonomy!.jobs)j.status='DONE';});
    const engine=new Engine(store,new SimulationGateway(store),new ModelPlanner('fixture','fixture',scripted([{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},question,hold]),workspace));
    await engine.plan();syncActionRequests(store);
    assert.equal(store.read().runs[0].status,'DONE');assert.equal(store.read().autonomy!.requests.filter(r=>r.status==='OPEN').length,1);
    assert.equal(store.read().intents.length,0);assert.equal(store.read().approvals.length,0);
  }finally{store.close();}
});

test('slow scoped questions use the captured planning time and cannot grant approval',async()=>{
  const s=fixture();s.obligations=[s.obligations[1]];s.evidence=[];s.snapshot.balance=money('30');s.policy.perObligation=money('5');
  const store=new Store(':memory:',s),originalNow=Date.now;const planningAt=originalNow();let calls=0;
  const script=scripted([{name:'check_policy',args:{obligationIds:['B']}},{name:'queue_owner_request',args:{obligationId:'B',policyReason:'NEEDS_APPROVAL',question:'Approve this item above its limit?'}},{name:'finish',args:{decisions:[{obligationId:'B',action:'HOLD',reason:'Scoped decision needed.',evidenceIds:[]}]}}]);
  const transport=(async(url,init)=>{if(++calls===2)Date.now=()=>planningAt+35000;return script(url,init);}) as typeof fetch;
  try{
    const p=new ModelPlanner('fixture','fixture',transport,new AgentWorkspace(store));await p.plan(store.read());
    assert.equal(store.read().agentNotifications.filter(n=>n.status==='OPEN').length,1);assert.equal(store.read().approvals.length,0);assert.equal(store.read().intents.length,0);
  }finally{Date.now=originalNow;store.close();}
});
