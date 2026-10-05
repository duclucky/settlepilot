import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money, type Decision, type Planner } from '../src/domain.ts';
import { JevReviewedPlanner } from '../src/adapters/jev.ts';
import { Engine } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { SimulationGateway } from '../src/adapters/simulation.ts';
import { ModelPlanner } from '../src/adapters/model.ts';
import { AgentWorkspace } from '../src/agent-workspace.ts';
import { syncActionRequests, respondToAction } from '../src/action-requests.ts';
import { randomUUID } from 'node:crypto';

const pay = (evidenceIds:string[]=[]):Decision=>({obligationId:'A',action:'PAY_NOW',reason:'Accepted registered delivery.',evidenceIds});
const hold = ():Decision=>({...pay(),action:'HOLD',reason:'Collect further authoritative information.'});
function state(){const s=fixture();s.obligations=[s.obligations[0]];s.snapshot.balance=money('30');return s;}
function review(choice:'ALLOW'|'REVIEW'|'BLOCK',confidence:number):Response{
  return new Response(JSON.stringify({model:'fixture-jev',answers:{decision_0:{type:'choice',choice,confidence,probabilities:{ALLOW:0.4,REVIEW:0.4,BLOCK:0.2}}},usage:{input_tokens:1,output_tokens:1}}));
}
test('uncertain Jev finding returns to primary LLM and HOLD does not ask the owner',async()=>{
  const store=new Store(':memory:',state());let recovered=0;
  const base={name:'offline primary',plan:async()=>[pay()],reconsider:async(_s:any,feedback:any)=>{
    recovered++;assert.equal(feedback.issues[0].review.confidence,0.6);assert.equal(feedback.issues[0].obligationId,'A');return [hold()];
  }};
  try{
    const engine=new Engine(store,new SimulationGateway(store),new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,(async()=>review('ALLOW',0.6)) as typeof fetch));
    await engine.run();assert.equal(recovered,1);assert.equal(store.read().runs[0].decisions[0].action,'HOLD');
    assert.equal(store.read().evidenceRequests.length,0);assert.equal(store.read().agentNotifications.length,0);assert.equal(store.read().intents.length,0);
  }finally{store.close();}
});
test('rewording cannot obtain another review; materially changed evidence selection can',async()=>{
  for(const changed of [false,true]){
    let reviews=0,revisions=0;
    const base={name:'offline primary',plan:async()=>[pay()],reconsider:async()=>{revisions++;return [{...pay(changed?['e-a']:[]),reason:'Different explanation for the same obligation.'}];}};
    const p=new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,(async()=>{reviews++;return review(reviews===1?'REVIEW':'ALLOW',0.95);}) as typeof fetch);
    const [d]=await p.plan(state());assert.equal(reviews,changed?2:1);assert.ok(revisions>0&&revisions<=2);
    assert.equal(d.action,changed?'PAY_NOW':'HOLD');
  }
});
test('BLOCK cannot be promoted by revising wording or selecting another funding route',async()=>{
  const s=state();s.bridgePolicy.enabled=true;let reviews=0;
  const base={name:'offline primary',plan:async()=>[pay()],reconsider:async()=>[{...pay(['e-a']),action:'FUND_ARC' as const,fundingSourceChain:'BASE-SEPOLIA' as const}]};
  const p=new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,(async()=>{reviews++;return review('BLOCK',0.99);}) as typeof fetch);
  const [d]=await p.plan(s);assert.equal(reviews,1);assert.equal(d.action,'HOLD');assert.equal(d.fundingSourceChain,undefined);
});
test('real model tool loop receives review feedback and chooses an operational question with no override',async()=>{
  const store=new Store(':memory:',state());let calls=0,seenFeedback=false;
  const sequence=[
    {name:'read_skill',args:{name:'settle-obligations'}},{name:'read_evidence',args:{obligationIds:['A']}},{name:'check_policy',args:{obligationIds:['A']}},{name:'finish',args:{decisions:[pay(['e-a'])]}},
    {name:'request_review_help',args:{obligationId:'A',question:'The review is unresolved. Provide an additional signed delivery record?'}},{name:'read_evidence',args:{obligationIds:['A']}},{name:'finish',args:{decisions:[hold()]}}
  ];
  const transport=(async(_url,init)=>{
    const body=JSON.parse(init!.body as string);seenFeedback ||= JSON.parse(body.input[0].content).reviewFeedback?.issues?.[0]?.obligationId==='A';
    const c=sequence[Math.min(calls++,sequence.length-1)];return new Response(JSON.stringify({usage:{input_tokens:1000,output_tokens:100},output:[{type:'function_call',name:c.name,call_id:String(calls),arguments:JSON.stringify(c.args)}]}));
  }) as typeof fetch;
  try{
    const base=new ModelPlanner('fixture','fixture',transport,new AgentWorkspace(store));
    const engine=new Engine(store,new SimulationGateway(store),new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,(async()=>review('REVIEW',0.95)) as typeof fetch));
    await engine.plan();assert.equal(seenFeedback,true);assert.equal(store.read().runs[0].status,'DONE');assert.equal(store.read().agentNotifications.length,1);assert.equal(store.read().approvals.length,0);assert.equal(store.read().intents.length,0);
    syncActionRequests(store);const request=store.read().autonomy!.requests[0];assert.equal(request.kind,'OPERATION');assert.throws(()=>respondToAction(store,request.id,{responseId:randomUUID(),kind:'APPROVE',digest:request.digest}),/COMMENT_REQUIRED/);
  }finally{store.close();}
});

test('an allow for another item survives a scoped review revision without a second Jev request',async()=>{
  const s=state();s.obligations.push(fixture().obligations[1]);s.evidence=[];let reviews=0;
  const b:Decision={...pay(),obligationId:'B'};
  const base={name:'offline primary',plan:async()=>[pay(),b],reconsider:async()=>[pay(),{...b,action:'HOLD' as const}]};
  const transport=(async(_url,init)=>{reviews++;const body=JSON.parse(init!.body as string);assert.equal(body.state.items.length,2);return new Response(JSON.stringify({model:'fixture-jev',answers:{decision_0:{type:'choice',choice:'ALLOW',confidence:0.99,probabilities:{}},decision_1:{type:'choice',choice:'REVIEW',confidence:0.95,probabilities:{}}},usage:{input_tokens:1,output_tokens:1}}));}) as typeof fetch;
  const d=await new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,transport).plan(s);assert.equal(reviews,1);assert.equal(d[0].action,'PAY_NOW');assert.equal(d[1].action,'HOLD');
});

test('provider failure during revision cannot authorize the changed financial proposal',async()=>{
  let calls=0;
  const base={name:'offline primary',plan:async()=>[pay()],reconsider:async()=>[pay(['e-a'])]};
  const planner=new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,(async()=>++calls===1?review('REVIEW',0.95):new Response('sensitive provider error',{status:503})) as typeof fetch);
  const store=new Store(':memory:',state());try{await new Engine(store,new SimulationGateway(store),planner).run();assert.equal(store.read().runs[0].status,'ERROR');assert.equal(store.read().intents.length,0);assert.equal(JSON.stringify(store.read()).includes('sensitive provider error'),false);}finally{store.close();}
});

test('review ledger persists BLOCK across planner reconstruction and reuses it without provider resampling',async()=>{
  const s=state(),store=new Store(':memory:',s);let reviews=0;
  const script=(async(_url,init)=>{const body=JSON.parse(init!.body as string);const input=JSON.parse(body.input[0].content);const recovery=!!input.reviewFeedback;const outputs=body.input.filter((i:any)=>i.type==='function_call_output').length;
    const seq=recovery?[{name:'read_evidence',args:{obligationIds:['A']}},{name:'finish',args:{decisions:[hold()]}}]:[{name:'read_skill',args:{name:'settle-obligations'}},{name:'read_evidence',args:{obligationIds:['A']}},{name:'check_policy',args:{obligationIds:['A']}},{name:'finish',args:{decisions:[pay(['e-a'])]}}];
    const c=seq[Math.min(outputs,seq.length-1)];return new Response(JSON.stringify({output:[{type:'function_call',name:c.name,call_id:String(outputs),arguments:JSON.stringify(c.args)}]}));}) as typeof fetch;
  try{
    for(let run=0;run<2;run++){
      const base=new ModelPlanner('fixture','fixture',script,new AgentWorkspace(store));
      const p=new JevReviewedPlanner(base,'fixture','fixture-jev',0.8,(async()=>{reviews++;return review('BLOCK',0.99);}) as typeof fetch);
      assert.equal((await p.plan(store.read()))[0].action,'HOLD');
    }
    assert.equal(reviews,1);assert.equal(store.read().autonomy!.reviews!.length,1);assert.equal(store.read().intents.length,0);
  }finally{store.close();}
});
