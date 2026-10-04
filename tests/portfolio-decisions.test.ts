import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money, type Decision } from '../src/domain.ts';
import { ModelPlanner } from '../src/adapters/model.ts';
import { previewPlan } from '../src/plan-preview.ts';
import { fundingDeficitForDecisions } from '../src/cctp.ts';

function competing() {
  const s=fixture();s.evidence=[];s.obligations=s.obligations.slice(0,2);
  s.obligations.forEach(o=>{o.amount=money('4');});
  s.snapshot.balance=money('10');s.policy.reserve=money('1');s.policy.gasLimit=money('1');
  return s;
}
const pay=(id:string):Decision=>({obligationId:id,action:'PAY_NOW',reason:'Eligible payment.',evidenceIds:[]});

test('model revises collectively unaffordable payments instead of leaving the executor to contradict its plan',async()=>{
  const s=competing();let count=0;const outputs:any[]=[];
  const sequence=[{name:'read_skill',args:{name:'settle-obligations'}},{name:'check_policy',args:{obligationIds:['A','B']}},
    {name:'finish',args:{decisions:[pay('A'),pay('B')]}},
    {name:'finish',args:{decisions:[pay('A'),{...pay('B'),action:'HOLD',reason:'Preserve reserve after the urgent payment.'}]}}];
  const transport=(async(_url,init)=>{
    const body=JSON.parse(init!.body as string);outputs.push(...body.input.filter((x:any)=>x.type==='function_call_output').map((x:any)=>JSON.parse(x.output)));
    const call=sequence[count++];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:String(count),arguments:JSON.stringify(call.args)}]}));
  }) as typeof fetch;
  const decisions=await new ModelPlanner('test','scripted',transport).plan(s);
  assert.deepEqual(decisions.map(d=>d.action),['PAY_NOW','HOLD']);
  assert.ok(outputs.some(x=>x.error==='PAYMENT_PORTFOLIO_INFEASIBLE'&&x.conflicts?.[0]?.obligationId==='B'));
  assert.equal(s.intents.length,0);
});

test('preview respects an exact first-payment budget approval but does not reuse it after projected spending',()=>{
  const s=competing();s.snapshot.balance=money('30');s.policy.totalBudget=money('3');
  s.approvals=s.obligations.map(o=>({id:o.id,obligationId:o.id,obligationVersion:o.version,policyVersion:s.policy.version,stateVersion:s.financialVersion,actor:'owner',reason:'BUDGET_EXCEEDED' as const,expiresAt:s.policy.authorityExpiresAt}));
  const result=previewPlan(s,{steps:s.obligations.map(o=>({obligationId:o.id,action:'PAY_NOW',sourceChain:null}))});
  assert.equal(result.steps[0].result,'PAYMENT_FEASIBLE');
  assert.equal(result.steps[1].result,'BUDGET_EXCEEDED');
});

test('selected portfolio funding includes a gas ceiling for every selected payout',()=>{
  const s=competing();s.snapshot.balance=money('2');s.bridgePolicy.enabled=true;
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('20'),status:'VERIFIED',chainId:84532,block:'10',observedAt:new Date().toISOString()}];
  const decisions=s.obligations.map(o=>({...pay(o.id),action:'FUND_ARC' as const,fundingSourceChain:'BASE-SEPOLIA' as const}));
  assert.equal(fundingDeficitForDecisions(s,decisions),money('9'));
});

test('funding targets share the payout budget and the model revises its selection',async()=>{
  const s=competing();s.snapshot.balance='0';s.policy.totalBudget=money('6');s.bridgePolicy.enabled=true;
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('20'),status:'VERIFIED',chainId:84532,block:'10',observedAt:new Date().toISOString()}];
  const fund=(id:string)=>({...pay(id),action:'FUND_ARC'});
  const sequence=[{name:'analyze_liquidity',args:{}},{name:'read_skill',args:{name:'settle-obligations'}},
    {name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'inspect_treasury',args:{}},
    {name:'check_policy',args:{obligationIds:['A','B']}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},
    {name:'finish',args:{decisions:[fund('A'),fund('B')]}},
    {name:'finish',args:{decisions:[fund('A'),{...pay('B'),action:'HOLD',reason:'The two funding targets exceed the shared budget.'}]}}];
  let index=0;const outputs:any[]=[];let initial:any;
  const transport=(async(_url,init)=>{
    const body=JSON.parse(init!.body as string);initial??=JSON.parse(body.input[0].content);
    outputs.push(...body.input.filter((x:any)=>x.type==='function_call_output').map((x:any)=>JSON.parse(x.output)));
    const call=sequence[index++];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:String(index),arguments:JSON.stringify(call.args)}]}));
  }) as typeof fetch;
  const result=await new ModelPlanner('test','scripted',transport).plan(s);
  assert.deepEqual(result.map(d=>d.action),['FUND_ARC','HOLD']);
  assert.equal(initial.liquidityAnalysis.expectedReceiptsIncludedInCash,false);
  assert.ok(outputs.some(x=>x.kind==='CONSERVATIVE_LIQUIDITY_ANALYSIS'&&x.executionAuthorized===false));
  assert.ok(outputs.some(x=>x.error==='PAYMENT_PORTFOLIO_INFEASIBLE'&&x.conflicts[0].result==='BUDGET_EXCEEDED'));
  assert.equal(s.bridgeIntents.length,0);
});
