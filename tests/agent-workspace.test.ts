import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentWorkspace } from '../src/agent-workspace.ts';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';

test('agent workspace loads project instructions and a lazy payment-only skill index', () => {
  const workspace = new AgentWorkspace();
  const context = workspace.promptContext();
  assert.match(context.projectInstructions, /decision-maker/);
  assert.match(context.policyConstitution, /owner decision/i);
  assert.deepEqual(context.skills.map(skill => skill.name), ['fund-arc-with-cctp', 'goal-resolution', 'resolve-payment-exceptions', 'settle-obligations']);
  assert.equal(JSON.stringify(context.skills).includes('Call `inspect_treasury`'), false);
  assert.match(workspace.readSkill('fund-arc-with-cctp'), /inspect_treasury/);
  assert.throws(() => workspace.readSkill('../AGENTS'), /invalid/i);
});

test('bounded agent memory persists facts without changing the financial version and rejects secrets', () => {
  const store = new Store(':memory:', fixture()); const workspace = new AgentWorkspace(store);
  const financialVersion = store.read().financialVersion;
  const [entry] = workspace.memory({ action: 'add', kind: 'LESSON', content: 'Base Sepolia RPC was unavailable during the previous observation.' });
  assert.equal(store.read().financialVersion, financialVersion);
  assert.equal(workspace.memorySnapshot()[0].id, entry.id);
  workspace.memory({ action: 'replace', entryId: entry.id, kind: 'FACT', content: 'Prefer a currently verified source over a stale observation.' });
  assert.equal(workspace.memorySnapshot()[0].kind, 'FACT');
  assert.throws(() => workspace.memory({ action: 'add', kind: 'FACT', content: 'private key is secret' }), /SECRET_LIKE_MEMORY_REJECTED/);
  workspace.memory({ action: 'remove', entryId: entry.id });
  assert.equal(workspace.memorySnapshot().length, 0); store.close();
});
