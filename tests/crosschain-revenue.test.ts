import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/domain.ts';
import { shouldEvaluateFunding } from '../src/crosschain-revenue.ts';

test('verified crosschain funding re-evaluates after state changes and bounds transient planning retries', () => {
  const state = fixture(); const id = 'receivable'; const now = Date.now();
  assert.equal(shouldEvaluateFunding(state, id, now), true);
  state.fundingEvaluations.push({ receivableId: id, runId: 'run-1', attempt: 1, at: new Date(now).toISOString(), financialVersion: state.financialVersion, result: 'NO_BRIDGE_REQUIRED' });
  assert.equal(shouldEvaluateFunding(state, id, now), false);
  state.financialVersion++;
  assert.equal(shouldEvaluateFunding(state, id, now), true);
  state.fundingEvaluations = [{ receivableId: id, runId: 'run-2', attempt: 1, at: new Date(now - 31_000).toISOString(), financialVersion: state.financialVersion, result: 'PLANNING_FAILED' }];
  assert.equal(shouldEvaluateFunding(state, id, now), true);
  state.fundingEvaluations.push({ receivableId: id, runId: 'run-3', attempt: 2, at: new Date(now - 31_000).toISOString(), financialVersion: state.financialVersion, result: 'PLANNING_FAILED' });
  state.fundingEvaluations.push({ receivableId: id, runId: 'run-4', attempt: 3, at: new Date(now - 31_000).toISOString(), financialVersion: state.financialVersion, result: 'PLANNING_FAILED' });
  assert.equal(shouldEvaluateFunding(state, id, now), false);
});
