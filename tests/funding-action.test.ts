import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,money,type Decision} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {validateDecisions} from '../src/planner.ts';
import {CctpBridge,fundingDeficitForDecisions} from '../src/cctp.ts';
import {ModelPlanner} from '../src/adapters/model.ts';
import {JevReviewedPlanner} from '../src/adapters/jev.ts';

// Offline regression for the live HOLD/selected-source deadlock. No financial calls.
function context(){const s=fixture();s.obligations=[s.obligations[0]];s.evidence=[];s.snapshot.balance=money('1');s.policy.reserve=money('0.5');s.policy.gasLimit=money('0.1');s.bridgePolicy.enabled=true;s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),chainId:84532,block:'9',observedAt:new Date().toISOString(),status:'VERIFIED'}];return s;}
const proposal={obligationId:'A',action:'FUND_ARC',fundingSourceChain:'BASE-SEPOLIA',reason:'Fund the shortfall and re-plan after verified mint.',evidenceIds:[]} as unknown as Decision;
test('explicit funding plan is valid and computes the exact deficit without authorizing payout',async()=>{
  const s=context();const decisions=validateDecisions([proposal],s);
  assert.equal(fundingDeficitForDecisions(s,decisions),money('3.6'));
  const store=new Store(':memory:',s);let submissions=0;
  const gateway={mode:'simulation' as const,snapshot:async()=>({...s.snapshot,observedAt:new Date().toISOString()}),estimate:async()=> '0',submit:async()=>{submissions++;throw new Error('MUST_NOT_PAY');},reconcile:async()=>({status:'pending' as const})};
  await new Engine(store,gateway,{name:'Offline LLM fixture',plan:async()=>decisions}).run();
  assert.equal(submissions,0);assert.equal(store.read().intents.length,0);assert.equal(store.read().runs[0].status,'DONE');store.close();
  assert.throws(()=>validateDecisions([{...proposal,fundingSourceChain:undefined}],s));
  assert.throws(()=>validateDecisions([{...proposal,action:'HOLD'}],s));
  assert.equal(fundingDeficitForDecisions(s,[{...proposal,action:'HOLD',fundingSourceChain:undefined}]),'0');
});
test('model must explicitly finish a funding action after choosing a source',async()=>{
  const sequence=[{name:'read_skill',args:{name:'settle-obligations'}},{name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},{name:'finish',args:{decisions:[{...proposal,fundingSourceChain:undefined}]}}];let round=0;
  const transport=(async()=>{const call=sequence[Math.min(round++,sequence.length-1)];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));}) as typeof fetch;
  const [decision]=await new ModelPlanner('fixture-key','fixture-model',transport).plan(context());
  assert.equal(decision.action,'FUND_ARC');assert.equal(decision.fundingSourceChain,'BASE-SEPOLIA');
});
test('Jev reviews funding as a financial proposal and a block removes its source',async()=>{
  let reviewed=0;const base={name:'Offline LLM fixture',plan:async()=>[{...proposal}]};
  const transport=(async(_url,init)=>{reviewed++;const body=JSON.parse(init!.body as string);assert.equal(body.state.items[0].proposal.action,'FUND_ARC');return new Response(JSON.stringify({model:'fixture-jev',answers:{decision_0:{type:'choice',choice:'BLOCK',confidence:0.99,probabilities:{BLOCK:0.99,ALLOW:0.01,REVIEW:0}}},usage:{input_tokens:1,output_tokens:1}}));}) as typeof fetch;
  const [decision]=await new JevReviewedPlanner(base,'fixture-key','fixture-jev',0.8,transport).plan(context());
  assert.equal(reviewed,1);assert.equal(decision.action,'HOLD');assert.equal(decision.fundingSourceChain,undefined);assert.equal(fundingDeficitForDecisions(context(),[decision]),'0');
});
test('funding action dispatches one bridge on the selected chain and leaves payout untouched',async()=>{
  const s=context();s.mode='testnet';const store=new Store(':memory:',s);let transfers=0;
  const source={snapshot:async()=>({...s.crosschainBalances[0],balance:money('10'),observedAt:new Date().toISOString()})};
  const cli=async(args:string[])=>{
    if(args[0]==='wallet')return {data:{wallets:[{type:'agent',address:s.policy.sender,blockchain:'BASE-SEPOLIA'}]}};
    if(args[1]==='get-fee')return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',fees:[{finalityThreshold:1000,minimumFee:1.3,forwardFee:{med:22025}}]}};
    if(args[1]==='transfer'){transfers++;assert.equal(args[args.indexOf('--chain')+1],'BASE-SEPOLIA');assert.equal(args[args.indexOf('--amount')+1],'3.600000');return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',amount:'3.600000',status:'pending',burnTxHash:`0x${'a'.repeat(64)}`}};}
    return {data:{status:'pending'}};
  };
  store.change(state=>state.runs.push({id:'funding-plan',createdAt:new Date().toISOString(),source:'Offline LLM fixture',status:'DONE',executionStatus:'PLANNED',financialVersion:state.financialVersion,policyVersion:state.policy.version,decisions:[proposal]}));
  const bridge=new CctpBridge(store,new Map([['BASE-SEPOLIA',source as never]]),{} as never,cli,{enabled:true,responseTimeoutMs:30});
  assert.ok(await bridge.fundFromInventory('funding-plan'));assert.equal(transfers,1);assert.equal(store.read().bridgeIntents[0].status,'BURN_OBSERVED');assert.equal(store.read().intents.length,0);
  store.close();
});
test('model rejects premature payment and must choose the funding replacement itself',async()=>{
  const sequence=[{name:'read_skill',args:{name:'settle-obligations'}},{name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},{name:'finish',args:{decisions:[{...proposal,action:'PAY_NOW',fundingSourceChain:undefined}]}},{name:'finish',args:{decisions:[{...proposal,fundingSourceChain:undefined}]}}];let round=0;
  const transport=(async(_url,init)=>{if(round===6)assert.match(init!.body as string,/PAY_NOW_REJECTED_FUNDING_REQUIRED/);const call=sequence[Math.min(round++,sequence.length-1)];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));}) as typeof fetch;
  const [decision]=await new ModelPlanner('fixture-key','fixture-model',transport).plan(context());assert.equal(decision.action,'FUND_ARC');assert.equal(round,7);
});
test('a multi-round funding plan keeps its verified input snapshot and still needs backend revalidation',async()=>{
  const s=context(),now=Date.now;let round=0;
  const sequence=[{name:'read_skill',args:{name:'settle-obligations'}},{name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},{name:'finish',args:{decisions:[{...proposal,fundingSourceChain:undefined}]}}];
  const transport=(async()=>{if(round===3)Date.now=()=>now()+35000;const call=sequence[Math.min(round++,sequence.length-1)];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));}) as typeof fetch;
  try{const [decision]=await new ModelPlanner('fixture-key','fixture-model',transport).plan(s);assert.equal(decision.action,'FUND_ARC');assert.equal(decision.fundingSourceChain,'BASE-SEPOLIA');}finally{Date.now=now;}
});
test('Jev reviews the same captured funding context after a slow base plan',async()=>{
  const s=context(),now=Date.now;
  const base={name:'Offline LLM fixture',plan:async()=>{Date.now=()=>now()+35000;return [{...proposal}];}};
  const transport=(async(_url,init)=>{const body=JSON.parse(init!.body as string);assert.equal(body.state.items[0].deterministicPlanningStatus,'FUNDING_REQUIRED');assert.equal(body.state.items[0].availableCrosschainUnits,money('10'));return new Response(JSON.stringify({model:'fixture-jev',answers:{decision_0:{type:'choice',choice:'ALLOW',confidence:0.99,probabilities:{ALLOW:0.99,BLOCK:0.01,REVIEW:0}}},usage:{input_tokens:1,output_tokens:1}}));}) as typeof fetch;
  try{const [decision]=await new JevReviewedPlanner(base,'fixture-key','fixture-jev',0.8,transport).plan(s);assert.equal(decision.action,'FUND_ARC');}finally{Date.now=now;}
});
test('funding execution refuses a stale treasury even after a valid funding proposal',async()=>{
  const s=context();s.snapshot.observedAt=new Date(Date.now()-35000).toISOString();s.crosschainBalances[0].observedAt=s.snapshot.observedAt;
  assert.equal(fundingDeficitForDecisions(s,[proposal]),'0');
});
