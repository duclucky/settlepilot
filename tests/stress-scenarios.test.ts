import test from 'node:test';
import assert from 'node:assert/strict';
import { stressScenarios } from '../src/audit/scenarios.ts';

test('50-scenario audit matrix is unique, varied and intentionally exceeds the funded wallet', () => {
  assert.equal(stressScenarios.length, 50);
  assert.equal(new Set(stressScenarios.map(s => s.id)).size, 50);
  assert.equal(new Set(stressScenarios.map(s => s.situation)).size, 50);
  assert.ok(new Set(stressScenarios.map(s => s.obligations.length)).size >= 6);
  assert.ok(stressScenarios.some(s => s.expected === 'PAY'));
  assert.ok(stressScenarios.some(s => s.expected === 'NO_PAY'));
  assert.ok(stressScenarios.some(s => s.expected === 'ADAPT_TO_BALANCE'));
  assert.ok(stressScenarios.some(s => s.policy.paused));
  assert.ok(stressScenarios.some(s => s.policy.authority === 'EXPIRED'));
  assert.ok(stressScenarios.some(s => s.obligations.some(o => o.disputed)));
  assert.ok(stressScenarios.some(s => s.obligations.some(o => o.dueDays > 14)));
  assert.ok(stressScenarios.some(s => s.obligations.some(o => o.recipient === 'BLOCKED')));
  const requested = stressScenarios.flatMap(s => s.obligations).reduce((n, o) => n + BigInt(o.amountUnits), 0n);
  assert.ok(requested > 25_000_000n, 'matrix must be able to drive a funded wallet into scarcity');
  for (const scenario of stressScenarios) {
    assert.match(scenario.id, /^S\d{2}$/);
    assert.ok(scenario.obligations.length >= 1);
    assert.equal(new Set(scenario.obligations.map(o => o.id)).size, scenario.obligations.length);
    assert.ok(scenario.obligations.every(o => /^\d+$/.test(o.amountUnits) && BigInt(o.amountUnits) > 0n));
  }
});
