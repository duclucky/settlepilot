import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JevReviewedPlanner } from '../src/adapters/jev.ts';
import { fixture, type Planner } from '../src/domain.ts';

const payingPlanner: Planner = {
  name: 'AI · gpt-5.4',
  async plan(state) {
    return state.obligations.filter(o => !o.paid).map(o => ({
      obligationId: o.id,
      action: 'PAY_NOW' as const,
      reason: 'The delivery evidence supports payment.',
      evidenceIds: state.evidence.filter(e => e.obligationId === o.id).map(e => e.id),
    }));
  },
};

function jevTransport(choice: 'ALLOW' | 'REVIEW' | 'BLOCK', confidence = 0.95, expectedUrl = 'https://api.typesafe.ai/v1/systemone') {
  return (async (url, init) => {
    assert.equal(url, expectedUrl);
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'jev-latest');
    assert.equal(JSON.stringify(body).includes(fixture().policy.sender), false);
    assert.equal(JSON.stringify(body).includes(fixture().obligations[0].recipient), false);
    assert.deepEqual(body.state.items[0].authoritativeAcceptance, { accepted: true, disputed: false, obligationVersion: 1 });
    assert.match(body.questions.decision_0.instructions, /authoritativeAcceptance/);
    const answers = Object.fromEntries(Object.keys(body.questions).map(key => [key, {
      type: 'choice', choice, confidence,
      probabilities: { ALLOW: choice === 'ALLOW' ? confidence : 0.02, REVIEW: choice === 'REVIEW' ? confidence : 0.02, BLOCK: choice === 'BLOCK' ? confidence : 0.02 },
    }]));
    return new Response(JSON.stringify({ model: 'jev-1.13', answers, usage: { input_tokens: 100, output_tokens: 3 } }));
  }) as typeof fetch;
}

test('Jev records a typed review and can only preserve a GPT payment proposal', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]];
  const endpoint = 'https://jev.example.test/v1/review';
  const planner = new JevReviewedPlanner(payingPlanner, 'jev-key', 'jev-latest', 0.8, jevTransport('ALLOW', 0.95, endpoint), endpoint);
  const [decision] = await planner.plan(state);
  assert.equal(planner.name, 'AI · gpt-5.4 + Jev jev-latest');
  assert.equal(decision.action, 'PAY_NOW');
  assert.deepEqual(decision.review, { provider: 'Jev', model: 'jev-1.13', verdict: 'ALLOW', confidence: 0.95 });
});

test('Jev review or low confidence fails closed before payment execution', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]];
  const review = await new JevReviewedPlanner(payingPlanner, 'jev-key', 'jev-latest', 0.8, jevTransport('REVIEW')).plan(state);
  assert.equal(review[0].action, 'REQUEST_EVIDENCE');
  assert.match(review[0].reason, /Jev requested review/);

  const uncertain = await new JevReviewedPlanner(payingPlanner, 'jev-key', 'jev-latest', 0.8, jevTransport('ALLOW', 0.6)).plan(state);
  assert.equal(uncertain[0].action, 'REQUEST_EVIDENCE');
  assert.match(uncertain[0].reason, /confidence below 0.80/);

  const blocked = await new JevReviewedPlanner(payingPlanner, 'jev-key', 'jev-latest', 0.8, jevTransport('BLOCK')).plan(state);
  assert.equal(blocked[0].action, 'HOLD');
  assert.match(blocked[0].reason, /Jev blocked/);
});

test('Jev cannot promote GPT hold decisions and malformed responses are rejected', async () => {
  const state = fixture(); state.obligations = [state.obligations[0]];
  const holdPlanner: Planner = { name: 'AI · gpt-5.4', async plan() { return [{ obligationId: 'A', action: 'HOLD', reason: 'GPT hold', evidenceIds: ['e-a'] }]; } };
  const decisions = await new JevReviewedPlanner(holdPlanner, 'jev-key', 'jev-latest', 0.8, jevTransport('ALLOW')).plan(state);
  assert.equal(decisions[0].action, 'HOLD');
  assert.equal(decisions[0].review, undefined);

  const malformed = (async () => new Response(JSON.stringify({ model: 'jev', answers: {}, usage: {} }))) as typeof fetch;
  await assert.rejects(new JevReviewedPlanner(payingPlanner, 'key', 'jev-latest', 0.8, malformed).plan(state));
});
