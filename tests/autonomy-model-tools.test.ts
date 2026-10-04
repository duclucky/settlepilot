import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {AgentWorkspace} from '../src/agent-workspace.ts';
import {ModelPlanner} from '../src/adapters/model.ts';
import {ingestSource} from '../src/ingestion.ts';
import {respondToAction,syncActionRequests} from '../src/action-requests.ts';
import {randomUUID} from 'node:crypto';
import {Engine} from '../src/engine.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';

test('LLM can ask for owner instructions when no funding alternative exists, without inventing an override',async()=>{
  const state=fixture();state.obligations=[state.obligations[0]];state.evidence=[];state.snapshot.balance='0';
  const store=new Store(':memory:',state);let round=0;
  const calls=[{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},{name:'request_owner_help',args:{obligationId:'A',question:'No verified funds are available. Should this obligation be postponed?'}}];
  const transport=(async()=>{const call=calls[Math.min(round++,calls.length-1)];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:`call${round}`,arguments:JSON.stringify(call.args)}]}));}) as typeof fetch;
  try{
    const engine=new Engine(store,new SimulationGateway(store),new ModelPlanner('fixture','fixture',transport,new AgentWorkspace(store)));
    await engine.run();syncActionRequests(store);const request=store.read().autonomy!.requests[0];
    assert.equal(store.read().runs[0].status,'AWAITING_USER');assert.equal(request.kind,'OPERATION');assert.match(request.question,/postponed/);assert.equal(store.read().intents.length,0);
    assert.throws(()=>respondToAction(store,request.id,{responseId:randomUUID(),kind:'APPROVE',digest:request.digest}),/COMMENT_REQUIRED/);
    respondToAction(store,request.id,{responseId:randomUUID(),kind:'COMMENT',digest:request.digest,comment:'Wait until tomorrow.'});assert.equal(store.read().approvals.length,0);
  }finally{store.close();}
});
test('LLM receipt association tool creates a bounded exact allocation that only owner approval applies',async()=>{
  const state=fixture();state.obligations=[];state.evidence=[];const store=new Store(':memory:',state);
  const receivable={externalId:'invoice',revision:1,kind:'RECEIVABLE',partyId:'customer',title:'Delivered work',amount:'0.5',due:new Date().toISOString()};
  ingestSource(store,{sourceId:'books',parties:[{id:'customer',name:'Customer',address:state.policy.allowlist[0]}],records:[receivable,{...receivable,externalId:'second'}]},true);
  store.change(s=>s.autonomy!.transfers.push({id:'receipt',chain:'ARC-TESTNET',hash:`0x${'a'.repeat(64)}`,logIndex:0,sender:state.policy.allowlist[0],recipient:state.policy.sender,amount:'750000',block:'11',blockHash:'b',status:'VERIFIED',classification:'UNMATCHED'}));
  let round=0;const transport=(async(_url,init)=>{
    const body=JSON.parse(init!.body as string);assert.match(JSON.stringify(body.input),/books/);assert.match(body.instructions,/Comment alone never grants/);
    const tool=round++===0?{name:'propose_receipt_match',args:{transferId:'receipt',sourceRecordKey:'books:invoice',question:'Apply 0.5 USDC to this invoice?'}}:{name:'finish',args:{decisions:[]}};
    return new Response(JSON.stringify({output:[{type:'function_call',name:tool.name,call_id:`call${round}`,arguments:JSON.stringify(tool.args)}]}));
  }) as typeof fetch;
  try{
    await new ModelPlanner('fixture','fixture-model',transport,new AgentWorkspace(store)).plan(store.read());
    assert.equal(store.read().autonomy!.allocations.length,0);const request=store.read().autonomy!.requests[0];assert.equal(request.action.amount,'500000');
    respondToAction(store,request.id,{responseId:randomUUID(),kind:'APPROVE',digest:request.digest});assert.equal(store.read().autonomy!.allocations[0].amount,'500000');assert.equal(store.read().snapshot.balance,state.snapshot.balance);
  }finally{store.close();}
});
test('owner delay tool requires an authenticated scoped Comment and gives no acceptance or override',async()=>{
  const store=new Store(':memory:',fixture()),workspace=new AgentWorkspace(store);
  try{
    assert.throws(()=>workspace.defer('C',new Date(Date.now()+60000).toISOString(),randomUUID()),/OWNER_INSTRUCTION_REQUIRED/);
    store.change(s=>s.evidenceRequests.push({id:'acceptance',runId:'old',obligationId:'C',obligationVersion:1,requestedFrom:'PROJECT_OWNER',question:'Confirm',status:'OPEN',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}));syncActionRequests(store);
    const r=store.read().autonomy!.requests[0],id=randomUUID();respondToAction(store,r.id,{responseId:id,digest:r.digest,kind:'COMMENT',comment:'Wait until tomorrow.'});
    workspace.defer('C',new Date(Date.now()+86400000).toISOString(),id);assert.equal(store.read().approvals.length,0);assert.equal(store.read().obligations[2].accepted,false);assert.ok(store.read().autonomy!.jobs.some(j=>j.cause==='DEADLINE_OWNER_DEFER'));
  }finally{store.close();}
});
