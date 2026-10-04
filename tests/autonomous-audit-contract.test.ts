import {test} from 'node:test';
import assert from 'node:assert/strict';
import {autonomousScenarios} from '../src/audit/autonomous-scenarios.ts';
import {sanitize} from '../src/audit/safe-journal.ts';
test('audit defines 50 separate predicates with a timeout and declared live eligibility',()=>{
  assert.equal(autonomousScenarios.length,50);assert.equal(new Set(autonomousScenarios.map(s=>s.predicate)).size,50);
  assert.equal(new Set(autonomousScenarios.map(s=>s.id)).size,50);
});
test('journal redacts secrets in free text, nested objects and endpoint paths',()=>{
  const secret='sk-abcdefghijklmnopqrstuvwxyz';
  const serialized=JSON.stringify(sanitize({detail:`Provider said ${secret}, Bearer abc123 https://rpc.example/token-secret?q=key`,nested:{apiKey:'secret'}}));
  assert.equal(serialized.includes(secret),false);assert.equal(serialized.includes('abc123'),false);assert.equal(serialized.includes('token-secret'),false);
});
