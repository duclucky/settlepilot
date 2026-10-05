import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelPlanner } from '../src/adapters/model.ts';
import { AgentWorkspace } from '../src/agent-workspace.ts';
import { Store } from '../src/store.ts';
import { fixture } from '../src/domain.ts';
import { reviewCaseBinding } from '../src/review-binding.ts';
import { recordGoalPlan } from '../src/goal-plans.ts';

test('mini has room for reasoning and tool output while keeping run/day limits', async () => {
  const store = new Store(':memory:', fixture());
  try {
    const workspace = new AgentWorkspace(store);
    const limits = structuredClone(workspace.modelRequests.limits);
    let requests = 0;
    const send = (async (_url, init) => {
      requests++;
      const body = JSON.parse(String(init!.body));
      assert.equal(body.model, 'gpt-5.4-mini');
      assert.equal(body.max_output_tokens, 8000);
      assert.equal(body.reasoning.effort, 'low');
      return new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 100, output_tokens: 8000, output_tokens_details: { reasoning_tokens: 8000 } } }));
    }) as typeof fetch;
    await assert.rejects(new ModelPlanner('fixture', 'gpt-5.4-mini', send, workspace).plan(store.read(), 'budget'), /MODEL_RESPONSE_INCOMPLETE/);
    assert.equal(requests, 1);
    assert.deepEqual(workspace.modelRequests.limits, limits);
    assert.equal(store.read().modelControl!.requests[0].usage!.outputTokens, 8000);
    assert.match(store.read().agentToolCalls.at(-1)!.detail, /MODEL_RESPONSE_INCOMPLETE: max_output_tokens.*cap 8000/);
  } finally { store.close(); }
});

test('incomplete tool output is never applied and diagnostic cannot leak provider text', async () => {
  for (const reason of ['max_output_tokens', 'private-provider-content']) {
    const store = new Store(':memory:', fixture());
    try {
      const workspace = new AgentWorkspace(store);
      let requests = 0;
      const send = (async () => {
        requests++;
        return new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason }, output: [{ type: 'function_call', name: 'record_plans', call_id: 'partial', arguments: JSON.stringify({ plans: [{ obligationId: 'A', objective: 'Partial output must never persist', steps: [{ action: 'OBSERVE', reason: 'Observe', sourceChain: null }] }] }) }] }));
      }) as typeof fetch;
      await assert.rejects(new ModelPlanner('fixture', 'gpt-5.4-mini', send, workspace).plan(store.read(), 'partial'), /MODEL_RESPONSE_INCOMPLETE/);
      assert.equal(requests, 1);
      assert.equal(store.read().autonomy!.plans?.length ?? 0, 0);
      assert.equal(store.read().intents.length, 0);
      assert.equal(store.read().bridgeIntents.length, 0);
      assert.equal(store.read().agentToolCalls.some(c => c.name === 'record_plans'), false);
      assert.match(store.read().agentToolCalls.at(-1)!.detail, /MODEL_RESPONSE_INCOMPLETE/);
      assert.ok(!JSON.stringify(store.read()).includes('private-provider-content'));
    } finally { store.close(); }
  }
});

test('decision context omits unrelated history but retains old current BLOCK, policy and evidence access', async () => {
  const state = fixture();
  state.obligations[1].archived = true;
  const store = new Store(':memory:', state);
  try {
    store.change(s => {
      recordGoalPlan(s, { obligationId: 'A', objective: 'Current objective', steps: [{ action: 'OBSERVE', reason: 'Inspect evidence', sourceChain: null }] });
      const p = s.autonomy!.plans![0];
      p.history = Array.from({ length: 16 }, (_, i) => ({ runId: `old-${i}`, action: 'HOLD', reason: 'Previous assessment', at: i }));
      s.autonomy!.plans!.push({ ...structuredClone(p), id: 'closed-plan', obligationId: 'B', objective: 'closed-objective' });
      const current = { fingerprint: 'blocked', caseBinding: reviewCaseBinding(s, 'A'), obligationId: 'A', review: { provider: 'Jev' as const, model: 'fixture', verdict: 'BLOCK' as const, confidence: 1 }, at: 1 };
      s.autonomy!.reviews = [current, ...Array.from({ length: 35 }, (_, i) => ({ ...structuredClone(current), fingerprint: `retired-${i}`, obligationId: 'B', caseBinding: 'old-binding', at: i + 2 }))];
    });
    let captured: any;
    const workspace = new AgentWorkspace(store);
    const send = (async (_url, init) => {
      captured = JSON.parse(JSON.parse(String(init!.body)).input[0].content);
      return new Response(JSON.stringify({ status: 'incomplete', output: [] }));
    }) as typeof fetch;
    await assert.rejects(new ModelPlanner('fixture', 'gpt-5.4-mini', send, workspace).plan(store.read(), 'context'), /MODEL_RESPONSE_INCOMPLETE/);
    assert.deepEqual(captured.candidates.map((c: any) => c.id), ['A', 'C']);
    assert.equal(captured.operatingPolicy.version, state.policy.version);
    assert.equal(captured.operatingPolicy.reserveUnits, state.policy.reserve);
    assert.ok(captured.liquidityAnalysis.horizons.length);
    assert.equal(captured.liquidityAnalysis.expectedReceiptsIncludedInCash, false);
    assert.equal(captured.liquidityAnalysis.obligations, undefined);
    assert.equal(captured.arcLiquidity, undefined);
    assert.deepEqual(captured.evidenceIndex.map((e: any) => e.obligationId), ['A', 'C']);
    assert.deepEqual(captured.durablePlanning.reviews.map((r: any) => r.fingerprint), ['blocked']);
    assert.deepEqual(captured.durablePlanning.plans.map((p: any) => p.objective), ['Current objective']);
    assert.equal(captured.durablePlanning.plans[0].history.length, 1);
    assert.equal(store.read().autonomy!.plans![0].history.length, 16);
    assert.equal(store.read().autonomy!.reviews!.length, 36);
    assert.equal(workspace.readSkill('settle-obligations').length > 0, true);
    assert.equal(store.read().evidence.length, state.evidence.length);
  } finally { store.close(); }
});
