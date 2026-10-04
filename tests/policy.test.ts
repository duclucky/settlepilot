import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money } from '../src/domain.ts';
import { evaluate, planningEligibility } from '../src/policy.ts';

test('decimal amounts remain exact and reject precision loss, negative, exponential input', () => {
  assert.equal(money('9007199254.740993'), '9007199254740993');
  for (const value of ['1.0000001', '-1', '1e6', ' 1', '01']) assert.throws(() => money(value));
});
test('T02 promise alone does not fund a payout; T01 confirmed funds allow A', () => {
  const s = fixture();
  assert.equal(evaluate(s, s.obligations[0]), 'RESERVE_CONFLICT');
  s.snapshot.balance = money('16');
  assert.equal(evaluate(s, s.obligations[0]), 'ALLOW');
});
test('hard constraints remain binding even with an approval', () => {
  for (const [mutate, expected] of [
    [(s: ReturnType<typeof fixture>) => { s.policy.chainId = 1; }, 'WRONG_CHAIN'],
    [(s: ReturnType<typeof fixture>) => { s.snapshot.chainId = 1; }, 'WRONG_CHAIN'],
    [(s: ReturnType<typeof fixture>) => { s.policy.allowlist = []; }, 'RECIPIENT_BLOCKED'],
    [(s: ReturnType<typeof fixture>) => { s.obligations[0].paid = true; }, 'ALREADY_PAID'],
    [(s: ReturnType<typeof fixture>) => { s.obligations[0].disputed = true; }, 'NEEDS_EVIDENCE'],
    [(s: ReturnType<typeof fixture>) => { s.policy.totalBudget = money('3'); }, 'BUDGET_EXCEEDED'],
    [(s: ReturnType<typeof fixture>) => { s.paused = true; }, 'PAUSED'],
    [(s: ReturnType<typeof fixture>) => { s.obligations[0].due = new Date(Date.now() + 15 * 86400000).toISOString(); }, 'OUTSIDE_PLANNING_WINDOW'],
  ] as const) {
    const s = fixture(); s.snapshot.balance = money('16'); mutate(s);
    s.approvals.push({ id: 'ap', obligationId: 'A', obligationVersion: 1, policyVersion: 1, stateVersion: s.version, expiresAt: new Date(Date.now() + 60000).toISOString(), actor: 'owner' });
    assert.equal(evaluate(s, s.obligations[0]), expected);
  }
});
test('T08 soft-limit approval is tied to state, policy, obligation and expiry', () => {
  const s = fixture(); s.snapshot.balance = money('16'); s.policy.perObligation = money('3');
  assert.equal(evaluate(s, s.obligations[0]), 'NEEDS_APPROVAL');
  s.approvals.push({ id: 'ap', obligationId: 'A', obligationVersion: 1, policyVersion: 1, stateVersion: s.version, expiresAt: new Date(Date.now() + 60000).toISOString(), actor: 'owner' });
  assert.equal(evaluate(s, s.obligations[0]), 'ALLOW');
  s.financialVersion++;
  assert.equal(evaluate(s, s.obligations[0]), 'NEEDS_APPROVAL');
});

test('an exact owner decision outranks overridable operating policy but not financial reality', () => {
  const cases = [
    { reason: 'NEEDS_APPROVAL', mutate: (s: ReturnType<typeof fixture>) => { s.policy.perObligation = money('3'); } },
    { reason: 'BUDGET_EXCEEDED', mutate: (s: ReturnType<typeof fixture>) => { s.policy.totalBudget = money('3'); } },
    { reason: 'OUTSIDE_PLANNING_WINDOW', mutate: (s: ReturnType<typeof fixture>) => { s.obligations[0].due = new Date(Date.now() + 15 * 86400000).toISOString(); } },
    { reason: 'RESERVE_CONFLICT', mutate: (s: ReturnType<typeof fixture>) => { s.snapshot.balance = money('9'); } },
  ] as const;
  for (const item of cases) {
    const s=fixture(); s.snapshot.balance=money('16'); item.mutate(s);
    assert.equal(evaluate(s,s.obligations[0]),item.reason);
    s.approvals.push({id:`ap-${item.reason}`,obligationId:'A',obligationVersion:1,policyVersion:1,stateVersion:s.financialVersion,expiresAt:new Date(Date.now()+60000).toISOString(),actor:'owner',reason:item.reason});
    assert.equal(evaluate(s,s.obligations[0]),'ALLOW');
  }
  const empty=fixture(); empty.snapshot.balance=money('3'); empty.policy.reserve='0'; empty.policy.gasLimit=money('1');
  empty.approvals.push({id:'ap-reserve',obligationId:'A',obligationVersion:1,policyVersion:1,stateVersion:empty.financialVersion,expiresAt:new Date(Date.now()+60000).toISOString(),actor:'owner',reason:'RESERVE_CONFLICT'});
  assert.equal(evaluate(empty,empty.obligations[0]),'INSUFFICIENT_FUNDS');
});

test('planning distinguishes a bridgeable liquidity gap from a hard policy hold', () => {
  const s = fixture();
  s.bridgePolicy.enabled = true;
  s.crosschainBalances.push({ sourceChain: 'OP-SEPOLIA', balance: money('8.25'), chainId: 11155420, block: '12', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  assert.equal(evaluate(s, s.obligations[0]), 'RESERVE_CONFLICT');
  assert.equal(planningEligibility(s, s.obligations[0]), 'FUNDING_REQUIRED');
  s.obligations[0].disputed = true;
  assert.equal(planningEligibility(s, s.obligations[0]), 'NEEDS_EVIDENCE');
});

test('approval is required before liquidity planning can request crosschain funds', () => {
  const s = fixture(); s.policy.perObligation = money('3'); s.bridgePolicy.enabled = true;
  s.crosschainBalances.push({ sourceChain: 'BASE-SEPOLIA', balance: money('10'), chainId: 84532, block: '9', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  assert.equal(planningEligibility(s, s.obligations[0]), 'NEEDS_APPROVAL');
});

test('verified revenue history is never treated as current treasury liquidity', () => {
  const s = fixture(); s.bridgePolicy.enabled = true;
  s.crosschainReceivables.push({ id: 'old-payment', sourceChain: 'BASE-SEPOLIA', source: `0x${'9'.repeat(40)}`, amount: money('100'), invoice: 'PAID-HISTORY', cursor: '1', createdAt: new Date().toISOString(), receivedHash: `0x${'a'.repeat(64)}` });
  assert.equal(planningEligibility(s, s.obligations[0]), 'RESERVE_CONFLICT');
});
