import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, money } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { AgentWorkspace } from '../src/agent-workspace.ts';
import { ModelPlanner } from '../src/adapters/model.ts';
import { previewPlan } from '../src/plan-preview.ts';
import { refreshGoalPlans, recordPlanDecisions } from '../src/goal-plans.ts';
import { randomUUID } from 'node:crypto';
import type { Intent, BridgeIntent } from '../src/domain.ts';

test('preview tool compares conditional funding and payout without changing money or creating intents',async()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.evidence=[];s.snapshot.balance=money('1');s.policy.reserve=money('0.5');s.policy.gasLimit=money('0.1');s.bridgePolicy.enabled=true;s.bridgePolicy.maxFee=money('0.01');
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),chainId:84532,block:'1',observedAt:new Date().toISOString(),status:'VERIFIED'}];
  const store=new Store(':memory:',s);let calls=0,preview:any;
  const sequence=[{name:'read_skill',args:{name:'settle-obligations'}},{name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},
    {name:'preview_plan',args:{steps:[{obligationId:'A',action:'FUND_ARC',sourceChain:'BASE-SEPOLIA'},{obligationId:'A',action:'PAY_NOW',sourceChain:null}]}},
    {name:'finish',args:{decisions:[{obligationId:'A',action:'HOLD',reason:'Inspect projected costs.',evidenceIds:[]}]}}];
  const transport=(async(_url,init)=>{const body=JSON.parse(init!.body as string);const output=body.input.find((i:any)=>i.type==='function_call_output'&&i.call_id==='5');if(output)preview=JSON.parse(output.output);
    const c=sequence[Math.min(calls++,sequence.length-1)];return new Response(JSON.stringify({output:[{type:'function_call',name:c.name,call_id:String(calls),arguments:JSON.stringify(c.args)}]}));}) as typeof fetch;
  try{
    await new ModelPlanner('fixture','fixture',transport,new AgentWorkspace(store)).plan(store.read());
    assert.equal(preview.kind,'CONSERVATIVE_PROJECTION');assert.equal(preview.steps[0].fundingUnits,money('3.6'));assert.equal(preview.steps[1].projectedArcBalance,money('0.5'));
    assert.equal(preview.steps[1].conditionalOnVerifiedMint,true);assert.equal(store.read().snapshot.balance,money('1'));assert.equal(store.read().intents.length+store.read().bridgeIntents.length,0);
  }finally{store.close();}
});

test('preview preserves reserve and aggregate budget, excludes unreceived money and rejects duplicate payout',()=>{
  const s=fixture();s.snapshot.balance=money('20');s.policy.totalBudget=money('10');
  const preview=previewPlan(s,{steps:[{obligationId:'A',action:'PAY_NOW',sourceChain:null},{obligationId:'B',action:'PAY_NOW',sourceChain:null}]});
  assert.equal(preview.steps[0].result,'PAYMENT_FEASIBLE');assert.equal(preview.steps[1].result,'BUDGET_EXCEEDED');assert.equal(s.snapshot.balance,money('20'));
  assert.throws(()=>previewPlan(s,{steps:[{obligationId:'A',action:'PAY_NOW',sourceChain:null},{obligationId:'A',action:'PAY_NOW',sourceChain:null}]}),/DUPLICATE_PAYOUT/);
  s.snapshot.balance='0';s.receivables.push({id:'invoice',source:'customer',amount:money('100'),invoice:'future income',cursor:'0',createdAt:new Date().toISOString()});
  const absent=previewPlan(s,{steps:[{obligationId:'A',action:'PAY_NOW',sourceChain:null}]});assert.equal(absent.steps[0].result,'INSUFFICIENT_FUNDS');assert.equal(absent.expectedReceiptsIncluded,false);
  assert.throws(()=>previewPlan(s,{steps:[{obligationId:'fake',action:'PAY_NOW',sourceChain:null}]}),/UNKNOWN_CANDIDATE/);
});

test('preview refuses unavailable source liquidity and reports partial conservative funding',()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.snapshot.balance='0';s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('100'),chainId:84532,block:'1',observedAt:new Date().toISOString(),status:'UNAVAILABLE'}];
  const input={steps:[{obligationId:'A',action:'FUND_ARC',sourceChain:'BASE-SEPOLIA'}]};assert.equal(previewPlan(s,input).steps[0].result,'SOURCE_BALANCE_UNAVAILABLE');
  s.crosschainBalances[0].status='VERIFIED';s.crosschainBalances[0].observedAt=new Date(Date.now()-31000).toISOString();assert.equal(previewPlan(s,input).steps[0].result,'SOURCE_BALANCE_UNAVAILABLE');
  s.crosschainBalances[0].observedAt=new Date().toISOString();s.crosschainBalances[0].balance=money('3');
  const partial=previewPlan(s,input);assert.equal(partial.steps[0].result,'CONDITIONAL_PARTIAL_FUNDING');assert.equal(partial.steps[0].fundingUnits,money('2'));assert.equal(partial.steps[0].costCeilingUnits,money('1'));
  assert.throws(()=>previewPlan(s,{steps:[{obligationId:'A',action:'FUND_ARC',sourceChain:'OP-SEPOLIA'}]}),/SOURCE_NOT_ALLOWED/);
});

test('plan completion is derived from exact verified receipt; an unknown outcome stays reconciling',()=>{
  const store=new Store(':memory:',fixture()),workspace=new AgentWorkspace(store);
  try{
    workspace.recordPlan({obligationId:'A',objective:'Settle with proof.',steps:[{action:'PAY_NOW',reason:'Verify payout.',sourceChain:null}]});
    store.change(s=>{s.mode='testnet';const o=s.obligations[0];s.intents.push({id:'payment',runId:'run',obligationId:o.id,amount:o.amount,recipient:o.recipient,sender:s.policy.sender,chainId:5042002,policyVersion:1,obligationVersion:1,idempotencyKey:randomUUID(),status:'EXECUTION_UNKNOWN',hash:`0x${'a'.repeat(64)}`,createdAt:new Date().toISOString()});refreshGoalPlans(s);});
    assert.equal(store.read().autonomy!.plans![0].status,'RECONCILING');assert.equal(store.read().autonomy!.plans![0].steps[0].status,'PLANNED');
    store.change(s=>{s.intents[0].status='HASH_OBSERVED';refreshGoalPlans(s);});assert.notEqual(store.read().autonomy!.plans![0].status,'COMPLETED');
    store.change(s=>{s.intents[0].status='SETTLED';s.obligations[0].paid=true;refreshGoalPlans(s);});
    assert.equal(store.read().autonomy!.plans![0].status,'COMPLETED');assert.equal(store.read().autonomy!.plans![0].steps[0].status,'VERIFIED');assert.equal(store.read().autonomy!.plans![0].steps[0].proofId,'payment');
    store.change(s=>{s.intents[0].sender=s.obligations[1].recipient;refreshGoalPlans(s);});assert.notEqual(store.read().autonomy!.plans![0].status,'COMPLETED');
    store.change(s=>{s.intents[0].amount='1';refreshGoalPlans(s);});assert.notEqual(store.read().autonomy!.plans![0].status,'COMPLETED');
    assert.equal(store.read().intents.length,1);assert.equal(store.read().approvals.length,0);
  }finally{store.close();}
});

test('a bridge for another item in the same run is not proof that this plan funded',()=>{
  const store=new Store(':memory:',fixture()),workspace=new AgentWorkspace(store);
  try{
    workspace.recordPlan({obligationId:'A',objective:'Fund and pay.',steps:[{action:'FUND_ARC',reason:'Choose source if needed.',sourceChain:'BASE-SEPOLIA'},{action:'PAY_NOW',reason:'Pay after mint.',sourceChain:null}]});
    store.change(s=>{recordPlanDecisions(s,[{obligationId:'A',action:'HOLD',reason:'Waiting.',evidenceIds:[]}],'shared-run');s.bridgeIntents.push({id:'other-bridge',runId:'shared-run',sourceChain:'BASE-SEPOLIA',status:'SETTLED',mintHash:`0x${'b'.repeat(64)}`} as BridgeIntent);refreshGoalPlans(s);});
    assert.equal(store.read().autonomy!.plans![0].steps[0].status,'PLANNED');
    store.change(s=>{recordPlanDecisions(s,[{obligationId:'A',action:'FUND_ARC',fundingSourceChain:'BASE-SEPOLIA',reason:'Fund A.',evidenceIds:[]}],'own-run');s.bridgeIntents.push({id:'own-bridge',runId:'own-run',sourceChain:'BASE-SEPOLIA',sourceWallet:s.policy.sender,recipient:s.policy.sender,destinationChain:'ARC-TESTNET',policyVersion:s.bridgePolicy.version,status:'SETTLED',mintHash:`0x${'c'.repeat(64)}`} as BridgeIntent);refreshGoalPlans(s);});
    assert.equal(store.read().autonomy!.plans![0].steps[0].status,'VERIFIED');assert.notEqual(store.read().autonomy!.plans![0].status,'COMPLETED');
    store.change(s=>{for(let index=0;index<17;index++)recordPlanDecisions(s,[{obligationId:'A',action:'HOLD',reason:'Wait for a fresh payout evaluation.',evidenceIds:[]}],`later-${index}`);});
    assert.equal(store.read().autonomy!.plans![0].steps[0].status,'VERIFIED');
    workspace.recordPlan({obligationId:'A',objective:'Continue the same settlement goal.',steps:[{action:'FUND_ARC',reason:'Funds already moved.',sourceChain:'BASE-SEPOLIA'},{action:'PAY_NOW',reason:'Re-evaluate fresh payment conditions.',sourceChain:null}]});
    assert.equal(store.read().autonomy!.plans![0].steps[0].status,'VERIFIED');
  }finally{store.close();}
});
test('durable plan survives restart and model cannot declare completion or rewrite registry',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tameion-plan-')),path=join(dir,'agent.db');let store=new Store(path,fixture());
  try{
    const workspace=new AgentWorkspace(store) as any;
    const plan=workspace.recordPlan({obligationId:'A',objective:'Settle the accepted obligation with verified receipt.',steps:[{action:'OBSERVE',reason:'Verify funds.',sourceChain:null},{action:'PAY_NOW',reason:'Pay only after checks.',sourceChain:null}]});
    store.close();store=new Store(path,fixture());
    const restored=(store.read().autonomy as any).plans[0];assert.equal(restored.id,plan.planId);assert.notEqual(restored.status,'COMPLETED');assert.equal(store.read().obligations[0].paid,false);
    assert.throws(()=>(new AgentWorkspace(store) as any).recordPlan({obligationId:'A',objective:'Fake completion',steps:[{action:'PAY_NOW',reason:'Invent proof',sourceChain:null,status:'COMPLETED'}]}));
    store.change(s=>{s.obligations[0].version++;});
    const context=(new AgentWorkspace(store) as any).planningContext();assert.equal(context.plans[0].status,'SUPERSEDED');assert.equal(store.read().approvals.length,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
