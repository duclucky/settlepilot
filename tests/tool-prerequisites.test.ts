import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,money} from '../src/domain.ts';
import {ModelPlanner} from '../src/adapters/model.ts';
import {AgentWorkspace} from '../src/agent-workspace.ts';
import {Store} from '../src/store.ts';

test('a premature financial finish exposes all missing reads and recovers in one batch',async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,2);s.snapshot.balance=money('20');
 const store=new Store(':memory:',s);let round=0;
 const decisions=s.obligations.map(o=>({obligationId:o.id,action:'PAY_NOW',reason:'Accepted and funded.',evidenceIds:s.evidence.filter(e=>e.obligationId===o.id).map(e=>e.id)}));
 const send=(async(_url,init)=>{
  const body=JSON.parse(String(init!.body));let call;
  if(round===0){const initial=JSON.parse(body.input[0].content);assert.ok(initial.toolPrerequisites.finish);call={name:'finish',args:{decisions}};}
  else if(round===1){const feedback=JSON.parse(body.input.at(-1).output);assert.equal(feedback.error,'EVIDENCE_NOT_INSPECTED');assert.deepEqual(feedback.requiredContext.missingSkills,['settle-obligations']);assert.deepEqual(feedback.requiredContext.unreadEvidenceObligationIds,['A']);assert.deepEqual(feedback.requiredContext.uncheckedPolicyObligationIds,['A','B']);assert.equal(feedback.requiredContext.executionAuthorized,false);assert.deepEqual(feedback.requiredContext.batchRead,{name:'prepare_context',arguments:{skillNames:['settle-obligations'],obligationIds:['A','B']}});call={name:feedback.requiredContext.batchRead.name,args:feedback.requiredContext.batchRead.arguments};}
  else {const feedback=JSON.parse(body.input.at(-1).output);assert.ok(feedback.items[0].evidence.some((e:any)=>e.id==='e-a'));call={name:'finish',args:{decisions}};}
  round++;return new Response(JSON.stringify({usage:{input_tokens:1000,output_tokens:100},output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));
 })as typeof fetch;
 try{const result=await new ModelPlanner('fixture','gpt-5.4-mini',send,new AgentWorkspace(store)).plan(s,'prereqs');assert.equal(result.length,2);assert.equal(round,3);assert.equal(store.read().intents.length,0);assert.deepEqual(store.read().agentToolCalls.map(c=>c.name),['finish','prepare_context','finish']);}finally{store.close();}
});

test('premature source selection returns both missing funding prerequisites without choosing a source',async()=>{
 const s=fixture();s.obligations=s.obligations.slice(0,1);s.snapshot.balance='0';s.bridgePolicy.enabled=true;
 s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),chainId:84532,block:'1',observedAt:new Date().toISOString(),status:'VERIFIED'}];
 let round=0;const send=(async(_url,init)=>{
  const body=JSON.parse(String(init!.body));let call;
  if(round===0)call={name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}};
  else if(round===1){const result=JSON.parse(body.input.at(-1).output);assert.equal(result.error,'FUNDING_CONTEXT_NOT_INSPECTED');assert.deepEqual(result.requiredContext.missingSkills,['settle-obligations','fund-arc-with-cctp']);assert.equal(result.requiredContext.treasuryInspectionRequired,true);assert.equal(result.requiredContext.sourceSelectionRequired,true);assert.equal(result.requiredContext.selectedFundingSource,undefined);call={name:result.requiredContext.batchRead.name,args:result.requiredContext.batchRead.arguments};}
  else if(round===2)call={name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}};
  else call={name:'finish',args:{decisions:[{obligationId:'A',action:'FUND_ARC',reason:'Fund then re-evaluate.',evidenceIds:['e-a']}]}};
  round++;return new Response(JSON.stringify({usage:{input_tokens:1000,output_tokens:100},output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));
 })as typeof fetch;
 const [decision]=await new ModelPlanner('fixture','gpt-5.4-mini',send).plan(s);assert.equal(round,4);assert.equal(decision.fundingSourceChain,'BASE-SEPOLIA');assert.equal(s.bridgeIntents.length,0);
});
