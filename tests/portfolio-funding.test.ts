import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,money,type State,type Decision} from '../src/domain.ts';
import {planningEligibility} from '../src/policy.ts';
import {previewPlan} from '../src/plan-preview.ts';
import {fundingDeficitForDecisions,CctpBridge} from '../src/cctp.ts';
import {ModelPlanner} from '../src/adapters/model.ts';
import {Store} from '../src/store.ts';
import {AgentWorkspace} from '../src/agent-workspace.ts';
import {recordPlanDecisions,refreshGoalPlans} from '../src/goal-plans.ts';
import {analyzeLiquidity} from '../src/liquidity-analysis.ts';
import {JevReviewedPlanner} from '../src/adapters/jev.ts';

function context(){
  const s=fixture();s.evidence=[];s.obligations=s.obligations.slice(0,2);
  s.obligations.forEach(o=>{o.amount=money('0.30');o.due=new Date(Date.now()-86400000).toISOString();});
  s.snapshot.balance=money('0.43');s.policy.reserve=money('0.05');s.policy.gasLimit=money('0.01');
  s.bridgePolicy.enabled=true;s.bridgePolicy.maxAmount=money('1');s.bridgePolicy.maxFee=money('0.05');
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),chainId:84532,block:'1',observedAt:new Date().toISOString(),status:'VERIFIED'}];
  return s;
}
const fund=(id:string):Decision=>({obligationId:id,action:'FUND_ARC',fundingSourceChain:'BASE-SEPOLIA',reason:'Fund the selected overdue portfolio, then reassess after mint.',evidenceIds:[]});
const pay=(id:string):Decision=>({...fund(id),action:'PAY_NOW',fundingSourceChain:undefined});

async function plan(s:State,sequence:{name:string;args:unknown}[]){
  const store=new Store(':memory:',s);let requests=0;const feedback:any[]=[];
  const send=(async(_url,init)=>{
    const body=JSON.parse(String(init!.body));
    const last=body.input.at(-1);if(last?.type==='function_call_output')feedback.push(JSON.parse(last.output));
    assert.ok(requests<=sequence.length,'The fake provider has a finite script; no retry is authorized.');
    const call=sequence[requests++]??hold(s);
    return new Response(JSON.stringify({usage:{input_tokens:1000,output_tokens:100},output:[{type:'function_call',name:call.name,call_id:String(requests),arguments:JSON.stringify(call.args)}]}));
  }) as typeof fetch;
  try {const decisions=await new ModelPlanner('offline','gpt-5.4-mini',send,new AgentWorkspace(store)).plan(s,'offline-portfolio');return {decisions,requests,feedback};}
  finally{assert.equal(store.read().intents.length+store.read().bridgeIntents.length,0);store.close();}
}
const prepare=(s:State)=>({name:'prepare_context',args:{skillNames:['settle-obligations','fund-arc-with-cctp'],obligationIds:s.obligations.map(o=>o.id)}});
const finish=(decisions:Decision[])=>({name:'finish',args:{decisions:decisions.map(({fundingSourceChain:_,...d})=>d)}});
const hold=(s:State)=>finish(s.obligations.map(o=>({...pay(o.id),action:'HOLD' as const,reason:'Offline test ends safely.'})));

test('LLM can fund a collectively short portfolio although every obligation individually fits',async()=>{
  const s=context();assert.ok(s.obligations.every(o=>planningEligibility(s,o)==='ALLOW'));
  const result=await plan(s,[prepare(s),{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},finish(s.obligations.map(o=>fund(o.id)))]);
  assert.equal(result.requests,3);assert.deepEqual(result.decisions.map(d=>d.action),['FUND_ARC','FUND_ARC']);
  assert.ok(result.decisions.every(d=>d.fundingSourceChain==='BASE-SEPOLIA'));
  assert.equal(fundingDeficitForDecisions(s,result.decisions),money('0.24'));
});

test('preview funds the selected remaining portfolio once, without counting a funding/payout target twice',()=>{
  const s=context();const before=JSON.stringify(s);
  const p=previewPlan(s,{steps:[{obligationId:'A',action:'FUND_ARC',sourceChain:'BASE-SEPOLIA'},
    {obligationId:'A',action:'PAY_NOW',sourceChain:null},{obligationId:'B',action:'PAY_NOW',sourceChain:null}]});
  assert.equal(p.steps[0].fundingUnits,money('0.24'));
  assert.equal(p.steps[0].result,'CONDITIONAL_FUNDING_COVERS_GAP');
  assert.equal(p.steps[2].projectedArcBalance,money('0.05'));
  assert.ok(p.steps.slice(1).every(step=>step.result==='CONDITIONAL_PAYMENT_FEASIBLE'));
  assert.equal(JSON.stringify(s),before);
});

test('insufficient shared payout feedback offers conditional funding with exact target IDs',async()=>{
  const s=context();const result=await plan(s,[prepare(s),finish(s.obligations.map(o=>pay(o.id))),hold(s)]);
  const feedback=result.feedback.find(f=>f.error==='PAYMENT_PORTFOLIO_INFEASIBLE');
  assert.deepEqual(feedback.fundingAlternative.obligationIds,['A','B']);
  assert.equal(feedback.fundingAlternative.gapUnits,money('0.24'));
  assert.equal(feedback.fundingAlternative.executionAuthorized,false);
});

test('explicit unnecessary funding and missing source prerequisites still fail safely',async()=>{
  const s=context();s.snapshot.balance=money('1');
  const r=await plan(s,[prepare(s),{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},finish(s.obligations.map(o=>fund(o.id))),hold(s)]);
  assert.ok(r.feedback.some(f=>f.error==='FUNDING_NOT_NEEDED'));
  const missing=await plan(context(),[prepare(context()),finish(context().obligations.map(o=>fund(o.id))),hold(context())]);
  assert.ok(missing.feedback.some(f=>f.error==='FUNDING_SOURCE_NOT_SELECTED'));
});

test('funding calculation rejects duplicate targets and entire portfolios with blocked or over-budget targets',()=>{
  const s=context();assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('A')]),'0');
  s.obligations[1].disputed=true;assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('B')]),'0');
  s.obligations[1].disputed=false;s.policy.totalBudget=money('0.4');assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('B')]),'0');
  s.policy.totalBudget=money('20');s.snapshot.observedAt=new Date(Date.now()-31000).toISOString();
  assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('B')]),'0');
});

test('a funding goal is retained automatically across mint and a later HOLD without claiming payment',()=>{
  const s=context(),store=new Store(':memory:',s);
  try {
    store.change(s=>recordPlanDecisions(s,s.obligations.map(o=>fund(o.id)),'fund-run'));
    assert.equal(store.read().autonomy!.plans!.length,2);
    store.change(s=>{s.bridgeIntents.push({id:'mint',runId:'fund-run',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:money('0.24'),fee:'0',totalBurn:money('0.24'),policyVersion:s.bridgePolicy.version,idempotencyKey:'offline',status:'SETTLED',mintHash:`0x${'a'.repeat(64)}`,createdAt:new Date().toISOString()});refreshGoalPlans(s);});
    store.change(s=>recordPlanDecisions(s,s.obligations.map(o=>({...pay(o.id),action:'HOLD' as const,reason:'Reassess new evidence after mint.'})),'next-run'));
    const goals=store.read().autonomy!.plans!;
    assert.ok(goals.every(p=>p.steps.find(step=>step.action==='FUND_ARC')?.status==='VERIFIED'));
    assert.ok(goals.every(p=>p.status!=='COMPLETED'&&p.history.at(-1)?.action==='HOLD'));
    assert.equal(store.read().intents.length,0);
  }finally{store.close();}
});

test('the live-shaped six-obligation portfolio exposes urgency and computes the 0.46 USDC shared deficit',()=>{
  const s=context(),now=Date.now();
  const amounts=['0.09','0.06','0.03','0.30','0.18','0.12'],offsets=[-2,-1,2,-2,-1,0.1];
  s.obligations=amounts.map((amount,i)=>({...s.obligations[0],id:`item-${i}`,amount:money(amount),due:new Date(now+offsets[i]*86400000+i*1000).toISOString()}));
  assert.ok(s.obligations.every(o=>planningEligibility(s,o,now)==='ALLOW'));
  assert.equal(fundingDeficitForDecisions(s,s.obligations.map(o=>fund(o.id)),now),money('0.46'));
  assert.deepEqual(analyzeLiquidity(s,now).deadlineOrder.map(o=>o.obligationId),['item-0','item-3','item-1','item-4','item-5','item-2']);
});

test('source caps stay partial, stale sources are excluded and hard policy blocks cannot fund the portfolio',()=>{
  const s=context();s.bridgePolicy.maxAmount=money('0.10');
  const steps=[{obligationId:'A',action:'FUND_ARC',sourceChain:'BASE-SEPOLIA'},
    {obligationId:'A',action:'PAY_NOW',sourceChain:null},{obligationId:'B',action:'PAY_NOW',sourceChain:null}];
  const partial=previewPlan(s,{steps});assert.equal(partial.steps[0].fundingUnits,money('0.10'));
  assert.equal(partial.steps[0].result,'CONDITIONAL_PARTIAL_FUNDING');assert.equal(partial.steps[2].result,'INSUFFICIENT_FUNDS');
  s.crosschainBalances[0].observedAt=new Date(Date.now()-31000).toISOString();
  assert.equal(previewPlan(s,{steps}).steps[0].result,'SOURCE_BALANCE_UNAVAILABLE');
  s.policy.enabled=false;assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('B')]),'0');
  s.policy.enabled=true;s.obligations[1].paid=true;assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('B')]),'0');
  s.obligations[1].paid=false;s.policy.allowlist=[];assert.equal(fundingDeficitForDecisions(s,[fund('A'),fund('B')]),'0');
});

test('Jev sees the collective funding gap even when individual deterministic eligibility is ALLOW',async()=>{
  const s=context();let reviews=0;
  const decisions=s.obligations.map(o=>fund(o.id));
  const transport=(async(_url,init)=>{
    reviews++;const body=JSON.parse(String(init!.body));
    assert.ok(body.state.items.every((i:any)=>i.deterministicPlanningStatus==='ALLOW'&&i.selectedFundingPortfolio.gapUnits===money('0.24')));
    return new Response(JSON.stringify({model:'fixture',answers:Object.fromEntries(body.state.items.map((_:unknown,i:number)=>[`decision_${i}`,{type:'choice',choice:'ALLOW',confidence:0.99,probabilities:{ALLOW:0.99,BLOCK:0.01,REVIEW:0}}])),usage:{input_tokens:100,output_tokens:100}}));
  }) as typeof fetch;
  const result=await new JevReviewedPlanner({name:'Offline fixture',plan:async()=>decisions},'offline','fixture',0.8,transport).plan(s);
  assert.equal(reviews,1);assert.ok(result.every(d=>d.action==='FUND_ARC'));
});

test('CCTP dispatches the exact shared gap once and an unresolved burn cannot be resubmitted',async()=>{
  const s=context();s.mode='testnet';const store=new Store(':memory:',s);let transfers=0;
  const cli=async(args:string[])=>{
    if(args[0]==='wallet')return {data:{wallets:[{type:'agent',address:s.policy.sender,blockchain:'BASE-SEPOLIA'}]}};
    if(args[1]==='get-fee')return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',fees:[{finalityThreshold:1000,minimumFee:0,forwardFee:{med:10000}}]}};
    if(args[1]==='transfer'){transfers++;assert.equal(args[args.indexOf('--amount')+1],'0.240000');return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',amount:'0.240000',status:'pending',burnTxHash:`0x${'b'.repeat(64)}`}};}
    return {data:{status:'pending'}};
  };
  const source={snapshot:async()=>({...s.crosschainBalances[0],observedAt:new Date().toISOString()})};
  const bridge=new CctpBridge(store,new Map([['BASE-SEPOLIA',source as never]]),{} as never,cli,{enabled:true,responseTimeoutMs:1});
  try{
    store.change(s=>s.runs.push({id:'portfolio',status:'DONE',executionStatus:'PLANNED',createdAt:new Date().toISOString(),source:'Offline fixture',financialVersion:s.financialVersion,policyVersion:s.policy.version,decisions:s.obligations.map(o=>fund(o.id))}));
    assert.ok(await bridge.fundFromInventory('portfolio'));assert.equal(transfers,1);
    await assert.rejects(()=>bridge.fundFromInventory('portfolio'),/FUNDING_PLAN_STALE/);
    assert.equal(transfers,1);assert.equal(store.read().intents.length,0);
  }finally{store.close();}
});
