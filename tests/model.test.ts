import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelPlanner } from '../src/adapters/model.ts';
import { fixture, money } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { AgentWorkspace } from '../src/agent-workspace.ts';
import { AgentEscalationError, AgentUserDecisionRequired } from '../src/agent-escalation.ts';

function transport(sequence: { name: string; args: unknown }[], expectedUrl = 'https://api.openai.com/v1/responses') {
  let index = 0;
  return (async (url, init) => {
    assert.equal(url, expectedUrl);
    const body = JSON.parse(init!.body as string);
    assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false);
    assert.equal(JSON.stringify(body.input).includes(fixture().policy.sender), false);
    const call = sequence[Math.min(index++, sequence.length - 1)];
    // Scripted fixtures report usage so this behavioral test does not consume
    // the conservative reservation for an unknown provider outcome each round.
    return new Response(JSON.stringify({ usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type: 'function_call', name: call.name, call_id: `call-${index}`, arguments: JSON.stringify(call.args) }] }));
  }) as typeof fetch;
}
test('model transport diagnostics distinguish timeout from HTTP errors without recording provider bodies',async()=>{
 for(const kind of ['timeout','http']as const){const store=new Store(':memory:',fixture());try{const workspace=new AgentWorkspace(store);const send=(async()=>{if(kind==='timeout')throw new DOMException('private provider URL','TimeoutError');return new Response('private provider body',{status:503});})as typeof fetch;await assert.rejects(()=>new ModelPlanner('secret','model',send,workspace).plan(store.read(),'diagnostic'));const entry=store.read().agentToolCalls.find(c=>c.name==='model_request');assert.match(entry?.detail??'',kind==='timeout'?/TIMEOUT/:/MODEL_TEMPORARILY_UNAVAILABLE/);assert.ok(!JSON.stringify(store.read()).includes('private provider'));}finally{store.close();}}
});
test('agent reads evidence and validates a tool-produced decision without executing payment', async () => {
  const endpoint = 'https://models.example.test/v1/responses';
  const planner = new ModelPlanner('fake-test-key', 'configured-model', transport([
    { name:'read_evidence', args:{obligationIds:['C']} },
    { name:'finish', args:{decisions:[{obligationId:'C',action:'REQUEST_EVIDENCE',reason:'Cần xác nhận mới từ chủ dự án.',evidenceIds:['e-c']}]} },
  ], endpoint), new AgentWorkspace(), endpoint);
  const s = fixture(); s.obligations = [s.obligations[2]];
  const decisions=await planner.plan(s); assert.equal(decisions[0].action,'REQUEST_EVIDENCE');
});
test('agent observes arbitrary Arc liquidity and verified crosschain funding before deciding', async () => {
  const state = fixture(); state.obligations = [state.obligations[1]]; state.evidence = []; state.snapshot.balance = money('2.75'); state.policy.reserve = money('1.25'); state.policy.gasLimit = money('0.2'); state.bridgePolicy.enabled = true;
  state.crosschainBalances.push({ sourceChain: 'AVAX-FUJI', balance: money('9.123456'), chainId: 43113, block: '42', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  let round = 0;
  const adaptiveTransport = (async (_url, init) => {
    const body = JSON.parse(init!.body as string); const serialized = JSON.stringify(body.input);
    const current = round++;
    if (current === 0) {
      assert.match(serialized, /AVAX-FUJI/); assert.match(serialized, /9123456/); assert.match(serialized, /2750000/);
      return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'read_skill', call_id: 'settle', arguments: JSON.stringify({ name: 'settle-obligations' }) }] }));
    }
    const calls = [
      { name: 'read_skill', args: { name: 'fund-arc-with-cctp' } },
      { name: 'inspect_treasury', args: {} },
      { name: 'check_policy', args: { obligationIds: ['B'] } },
      { name: 'choose_funding_source', args: { sourceChain: 'AVAX-FUJI' } },
      { name: 'finish', args: { decisions: [{ obligationId: 'B', action: 'FUND_ARC', reason: 'Fund the current shortfall, then re-evaluate before payment.', evidenceIds: [] }] } },
    ];
    if (current === 4) assert.match(serialized, /FUNDING_REQUIRED/);
    const call = calls[Math.min(current - 1, calls.length - 1)];
    return new Response(JSON.stringify({ output: [{ type: 'function_call', name: call.name, call_id: `call-${current}`, arguments: JSON.stringify(call.args) }] }));
  }) as typeof fetch;
  const [decision] = await new ModelPlanner('fake', 'model', adaptiveTransport).plan(state);
  assert.equal(decision.action, 'FUND_ARC');
});

test('agent sees observed source funds but cannot choose them when bridge execution is disabled',async()=>{
  const state=fixture();state.obligations=[state.obligations[1]];state.evidence=[];state.snapshot.balance='0';state.bridgePolicy.enabled=true;
  state.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('11'),chainId:84532,block:'4',observedAt:new Date().toISOString(),status:'VERIFIED',fundingEnabled:false}];
  const store=new Store(':memory:',state);let round=0;
  const sequence=[{name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'inspect_treasury',args:{}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},{name:'finish',args:{decisions:[{obligationId:'B',action:'HOLD',reason:'Source USDC is observed, but bridge execution is disabled.',evidenceIds:[]}]}}];
  const transport=(async(_url,init)=>{
    const input=JSON.parse(init!.body as string).input;
    if(round===0){const initial=JSON.parse(input[0].content);assert.equal(initial.observedTreasuryBalances[0].balanceUnits,money('11'));assert.equal(initial.observedTreasuryBalances[0].fundingEnabled,false);assert.deepEqual(initial.verifiedTreasuryBalances,[]);}
    if(round===2){const result=JSON.parse(input.at(-1).output);assert.equal(result.observedSources[0].balance,money('11'));assert.deepEqual(result.sources,[]);}
    const call=sequence[round++];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:`observe-${round}`,arguments:JSON.stringify(call.args)}]}));
  }) as typeof fetch;
  try{const [decision]=await new ModelPlanner('fixture','fixture-model',transport,new AgentWorkspace(store)).plan(state,'observe');assert.equal(decision.action,'HOLD');assert.equal(store.read().agentToolCalls.find(c=>c.name==='choose_funding_source')?.detail,'SOURCE_BALANCE_UNAVAILABLE');assert.equal(store.read().intents.length,0);}finally{store.close();}
});
test('agent loads payment skills and explicitly chooses the CCTP source chain through tools', async () => {
  const state = fixture(); state.obligations = [state.obligations[1]]; state.evidence = [];
  state.snapshot.balance = money('1'); state.policy.reserve = money('0.5'); state.policy.gasLimit = money('0.1'); state.bridgePolicy.enabled = true;
  const now = new Date().toISOString();
  state.crosschainBalances = [
    { sourceChain: 'AVAX-FUJI', balance: money('4'), chainId: 43113, block: '10', observedAt: now, status: 'VERIFIED' },
    { sourceChain: 'BASE-SEPOLIA', balance: money('9'), chainId: 84532, block: '11', observedAt: now, status: 'VERIFIED' },
  ];
  const store = new Store(':memory:', state);
  const planner = new ModelPlanner('fake', 'model', transport([
    { name: 'read_skill', args: { name: 'settle-obligations' } },
    { name: 'read_skill', args: { name: 'fund-arc-with-cctp' } },
    { name: 'inspect_treasury', args: {} },
    { name: 'check_policy', args: { obligationIds: ['B'] } },
    { name: 'choose_funding_source', args: { sourceChain: 'AVAX-FUJI' } },
    { name: 'finish', args: { decisions: [{ obligationId: 'B', action: 'FUND_ARC', reason: 'Use Avalanche treasury liquidity, verify the Arc mint, then re-plan.', evidenceIds: [] }] } },
  ]), new AgentWorkspace(store));
  const [decision] = await planner.plan(state, 'agent-run');
  assert.equal(decision.action, 'FUND_ARC');
  assert.equal(decision.fundingSourceChain, 'AVAX-FUJI');
  assert.deepEqual(store.read().agentToolCalls.map(call => call.name), ['read_skill', 'read_skill', 'inspect_treasury', 'check_policy', 'choose_funding_source', 'finish']);
  assert.equal(store.read().agentToolCalls.find(call => call.name === 'choose_funding_source')?.detail, 'AVAX-FUJI');
  store.close();
});
test('backend rejects an invalid payment proposal and the LLM must choose the replacement action', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]]; state.evidence = [];
  state.snapshot.balance = '0'; state.policy.reserve = '0'; state.policy.gasLimit = '0'; state.bridgePolicy.enabled = false;
  const planner = new ModelPlanner('fake', 'model', transport([
    { name:'read_skill', args:{name:'settle-obligations'} },
    { name:'check_policy', args:{obligationIds:['A']} },
    { name:'finish', args:{decisions:[{obligationId:'A',action:'PAY_NOW',reason:'Pay despite no liquidity.',evidenceIds:[]}]} },
    { name:'finish', args:{decisions:[{obligationId:'A',action:'HOLD',reason:'Hold because verified liquidity is insufficient.',evidenceIds:[]}]} },
  ]));
  const [decision] = await planner.plan(state);
  assert.equal(decision.action, 'HOLD');
  assert.equal(decision.reason, 'Hold because verified liquidity is insufficient.');
});
test('agent escalates to the user when it cannot produce a policy-compliant alternative', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]]; state.evidence = [];
  state.snapshot.balance = '0'; state.policy.reserve = '0'; state.policy.gasLimit = '0'; state.bridgePolicy.enabled = false;
  const planner = new ModelPlanner('fake', 'model', transport([
    { name:'read_skill', args:{name:'settle-obligations'} },
    { name:'check_policy', args:{obligationIds:['A']} },
    { name:'finish', args:{decisions:[{obligationId:'A',action:'PAY_NOW',reason:'Retry the rejected payment.',evidenceIds:[]}]} },
  ]));
  await assert.rejects(planner.plan(state), error => {
    assert.ok(error instanceof AgentEscalationError);
    assert.deepEqual(error.issues, [{ obligationId: 'A', reason: 'INSUFFICIENT_FUNDS' }]);
    return true;
  });
});
test('policy is always context and the agent can immediately request an owner decision', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]]; state.evidence = [];
  state.snapshot.balance = money('16'); state.policy.perObligation = money('3');
  let inspectedInitialContext = false;
  const decisionTransport = (async (_url, init) => {
    const body = JSON.parse(init!.body as string); const serialized = JSON.stringify(body);
    inspectedInitialContext = serialized.includes('operatingPolicy') && serialized.includes('perObligationUnits') && serialized.includes('Owner decisions outrank');
    return new Response(JSON.stringify({ output: [{ type:'function_call', name:'request_user_decision', call_id:'ask-owner', arguments:JSON.stringify({ obligationId:'A', policyReason:'NEEDS_APPROVAL', question:'Approve this exact payment once despite the per-obligation limit?' }) }] }));
  }) as typeof fetch;
  await assert.rejects(new ModelPlanner('fake','model',decisionTransport).plan(state,'run-owner'), error => {
    assert.ok(error instanceof AgentUserDecisionRequired);
    assert.equal(error.request.obligationId,'A'); assert.equal(error.request.policyReason,'NEEDS_APPROVAL'); return true;
  });
  assert.equal(inspectedInitialContext,true);
});

test('reserve exception requires treasury inspection and transient source failure can be held without asking the owner',async()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.evidence=[];
  s.snapshot.balance=money('4.5');s.policy.reserve=money('1');s.policy.gasLimit='0';s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:'0',status:'UNAVAILABLE',chainId:84532,block:'0',observedAt:new Date().toISOString()}];
  let round=0;
  const ask={name:'request_user_decision',args:{obligationId:'A',policyReason:'RESERVE_CONFLICT',question:'Approve reserve exception?'}};
  const sequence=[ask,{name:'inspect_treasury',args:{}},ask,{name:'finish',args:{decisions:[{obligationId:'A',action:'HOLD',reason:'Wait for source-chain observations to recover.',evidenceIds:[]}]}}];
  const transport=(async(_url,init)=>{
    if(round===1)assert.match(init!.body as string,/TREASURY_NOT_INSPECTED/);
    if(round===3)assert.match(init!.body as string,/FUNDING_OBSERVATION_INCOMPLETE/);
    const call=sequence[round++];return new Response(JSON.stringify({output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));
  }) as typeof fetch;
  const [decision]=await new ModelPlanner('fixture','fixture',transport).plan(s);assert.equal(decision.action,'HOLD');assert.equal(round,4);
});

test('verified treasury alternative prevents premature owner help and LLM selects FUND_ARC itself',async()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.evidence=[];s.snapshot.balance='0';s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
  s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money('10'),status:'VERIFIED',chainId:84532,block:'1',observedAt:new Date().toISOString()}];
  let round=0;
  const sequence=[{name:'inspect_treasury',args:{}},{name:'check_policy',args:{obligationIds:['A']}},{name:'request_owner_help',args:{obligationId:'A',question:'Please top up Arc?'}},{name:'read_skill',args:{name:'settle-obligations'}},{name:'read_skill',args:{name:'fund-arc-with-cctp'}},{name:'choose_funding_source',args:{sourceChain:'BASE-SEPOLIA'}},{name:'finish',args:{decisions:[{obligationId:'A',action:'FUND_ARC',reason:'Use verified Base funding before payout.',evidenceIds:[]}]}}];
  const transport=(async(_url,init)=>{if(round===3)assert.match(init!.body as string,/FUNDING_ALTERNATIVE_AVAILABLE/);const call=sequence[round++];return new Response(JSON.stringify({usage:{input_tokens:1000,output_tokens:100},output:[{type:'function_call',name:call.name,call_id:String(round),arguments:JSON.stringify(call.args)}]}));}) as typeof fetch;
  const [decision]=await new ModelPlanner('fixture','fixture',transport).plan(s);assert.equal(decision.action,'FUND_ARC');assert.equal(decision.fundingSourceChain,'BASE-SEPOLIA');
});
test('a stale planning snapshot does not erase PAY_NOW because execution refreshes it before side effects', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]]; state.evidence = [];
  state.snapshot.observedAt = new Date(Date.now()-31_000).toISOString();
  const planner = new ModelPlanner('fake', 'model', transport([
    { name:'read_skill', args:{name:'settle-obligations'} },
    { name:'check_policy', args:{obligationIds:['A']} },
    { name:'finish', args:{decisions:[{obligationId:'A',action:'PAY_NOW',reason:'Refresh before execution.',evidenceIds:[]}]} },
  ]));
  const [decision] = await planner.plan(state);
  assert.equal(decision.action, 'PAY_NOW');
});
test('agent can inspect and policy-check many obligations in batched tool calls', async () => {
  const state = fixture();
  const allIds = state.obligations.map(o => o.id);
  const planner = new ModelPlanner('fake', 'model', transport([
    { name: 'read_skill', args: { name: 'settle-obligations' } },
    { name: 'read_evidence', args: { obligationIds: allIds } },
    { name: 'check_policy', args: { obligationIds: ['A', 'B'] } },
    { name: 'finish', args: { decisions: [
      { obligationId: 'A', action: 'PAY_NOW', reason: 'Accepted and due.', evidenceIds: ['e-a'] },
      { obligationId: 'B', action: 'PAY_NOW', reason: 'Accepted in the planning window.', evidenceIds: [] },
      { obligationId: 'C', action: 'REQUEST_EVIDENCE', reason: 'Dispute remains unresolved.', evidenceIds: ['e-c'] },
    ] } },
    { name: 'finish', args: { decisions: [
      { obligationId: 'A', action: 'HOLD', reason: 'Hold until verified liquidity is sufficient.', evidenceIds: ['e-a'] },
      { obligationId: 'B', action: 'HOLD', reason: 'Hold until verified liquidity is sufficient.', evidenceIds: [] },
      { obligationId: 'C', action: 'REQUEST_EVIDENCE', reason: 'Dispute remains unresolved.', evidenceIds: ['e-c'] },
    ] } },
  ]));
  const decisions = await planner.plan(state);
  assert.equal(decisions.length, 3); assert.equal(decisions[1].action, 'HOLD'); assert.equal(decisions[2].action, 'REQUEST_EVIDENCE');
});
test('agent refuses unknown tools, uninspected evidence, extra fields, and endless loops', async () => {
  for (const sequence of [
    [{name:'send_money',args:{obligationIds:['A']}}],
    [{name:'finish',args:{decisions:[{obligationId:'A',action:'PAY_NOW',reason:'yes',evidenceIds:[]}]}}],
    [{name:'read_evidence',args:{obligationIds:['A'],wallet:'hacked'}}],
    [{name:'check_policy',args:{obligationIds:['A']}}],
  ]) await assert.rejects(new ModelPlanner('fake','model',transport(sequence)).plan(fixture()));
});

test('a valid slow model response survives 36 seconds while a stalled request stays bounded',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('bounded','TimeoutError')),ms);return c.signal;});
 const s=fixture();s.obligations=[s.obligations[1]];s.evidence=[];
 const send=(async(_url,init)=>new Promise<Response>((resolve,reject)=>{
  init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});
  setTimeout(()=>resolve(new Response(JSON.stringify({output:[{type:'function_call',name:'finish',call_id:'slow',arguments:JSON.stringify({decisions:[{obligationId:'B',action:'HOLD',reason:'Wait for evidence.',evidenceIds:[]}]})}]}))),36_000);
 }))as typeof fetch;
 const result=new ModelPlanner('fake','model',send).plan(s);t.mock.timers.tick(36_000);
 assert.equal((await result)[0].action,'HOLD');
 const stalled=(async(_url,init)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})))as typeof fetch;
 const failure=assert.rejects(new ModelPlanner('fake','model',stalled).plan(s),/MODEL_TIMEOUT/);
 t.mock.timers.tick(90_000);await failure;
});

test('LLM can prepare required skills, evidence and policy in one read-only call',async()=>{
 const s=fixture();s.obligations=[s.obligations[0]];s.snapshot.balance=money('10');let rounds=0;
 const send=(async(_url,init)=>{rounds++;const body=JSON.parse(String(init!.body));
  if(rounds===1)return new Response(JSON.stringify({output:[{type:'function_call',name:'prepare_context',call_id:'context',arguments:JSON.stringify({skillNames:['settle-obligations'],obligationIds:['A']})}]}));
  assert.match(String(init!.body),/e-a/);assert.match(String(init!.body),/ALLOW/);
  return new Response(JSON.stringify({output:[{type:'function_call',name:'finish',call_id:'finish',arguments:JSON.stringify({decisions:[{obligationId:'A',action:'PAY_NOW',reason:'Accepted and affordable.',evidenceIds:['e-a']}]})}]}));
 })as typeof fetch;
 const result=await new ModelPlanner('fake','model',send).plan(s);assert.equal(result[0].action,'PAY_NOW');assert.equal(rounds,2);
});

test('a plan without an explicit run ID shares one request budget across tool rounds',async()=>{
 let count=0;const workspace=new AgentWorkspace();
 const send=(async()=>{count++;return new Response(JSON.stringify({output:[{type:'function_call',name:'read_skill',call_id:String(count),arguments:JSON.stringify({name:'settle-obligations'})}]}));})as typeof fetch;
 await assert.rejects(new ModelPlanner('fake','model',send,workspace).plan(fixture()));
 const records=workspace.modelRequests.snapshot().requests;
 assert.ok(records.length>1);assert.equal(new Set(records.map(r=>r.runId)).size,1);
});
