import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentWalletGateway } from '../src/adapters/agent-wallet.ts';
import { ArcReader } from '../src/adapters/arc.ts';
import { Store } from '../src/store.ts';
import { authorizeSubmission } from '../src/config.ts';
import { Engine } from '../src/engine.ts';
import { RulesPlanner } from '../src/planner.ts';
import { fixture, CHAIN_ID, type Intent } from '../src/domain.ts';

function setup(path = ':memory:') {
  const s = fixture(); s.mode = 'testnet'; s.snapshot.balance = '20000000'; s.snapshot.block = '100';
  const i: Intent = { id: randomUUID(), runId: 'r', obligationId: 'A', sender: s.policy.sender, recipient: s.obligations[0].recipient, amount: '4000000', chainId: CHAIN_ID, policyVersion: 1, obligationVersion: 1, idempotencyKey: randomUUID(), createdAt: new Date().toISOString(), status: 'SUBMITTING', snapshot: s.snapshot };
  s.intents.push(i); const store = new Store(path, s);
  const tx = { id: randomUUID(), idempotencyKey: i.idempotencyKey, state: 'COMPLETE', blockchain: 'ARC-TESTNET', sourceAddress: i.sender, destinationAddress: i.recipient, amounts: ['4'], operation: 'TRANSFER', txHash: `0x${'a'.repeat(64)}`, createDate: new Date().toISOString() };
  let sends = 0, verifications = 0, allowed = true, timeout = false;
  const arc = { network: async () => {}, snapshot: async () => s.snapshot, verifyAgentTransfer: async (_hash: string, expected: Intent) => { verifications++; assert.equal(expected.amount, i.amount); return { hash: tx.txHash, block: '101', timestamp: Date.now() }; } } as unknown as ArcReader;
  const cli = async (args: string[]) => {
    if (args[0] === 'transaction') return { data: { transactions: [tx] } };
    if (args[1] === 'list') return { data: { wallets: [{ type: 'agent', address: i.sender, blockchain: 'ARC-TESTNET' }] } };
    if (args.includes('--estimate')) return { data: { blockchain: 'ARC-TESTNET', medium: { gasLimit: '100000', maxFee: '20', priorityFee: '1' } } };
    sends++; assert.ok(store.read().intents[0].agentDispatchAt, 'dispatch persisted before CLI starts');
    assert.equal(args[args.indexOf('--idempotency-key') + 1], i.idempotencyKey);
    assert.equal(args[args.indexOf('--amount') + 1], '4.000000'); assert.equal(args[args.indexOf('--chain') + 1], 'ARC-TESTNET');
    if (timeout) throw new Error('lost response');
    return { data: tx };
  };
  const gateway = new AgentWalletGateway(i.sender, arc, cli, { store, sendEnabled: true, authorize: () => allowed });
  return { store, state: s, i, tx, gateway, arc, cli, sends: () => sends, verified: () => verifications, deny: () => { allowed = false; }, timeout: () => { timeout = true; } };
}

test('Agent Wallet sends once with durable idempotency and settles only after independent SCA proof', async () => {
  const t = setup();
  try {
    assert.equal(await t.gateway.estimate(t.i), '0');
    const outcomes = await Promise.allSettled([t.gateway.submit(t.i), t.gateway.submit(t.i)]);
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(t.sends(), 1);
    assert.equal(t.store.read().intents[0].providerId, t.tx.id);
    assert.equal((await t.gateway.reconcile(t.store.read().intents[0])).status, 'confirmed'); assert.equal(t.verified(), 1);
  } finally { t.store.close(); }
});

test('lost response never resends; explicit recovery binds provider ID and rejects reused or altered transfers', async () => {
  const t = setup();
  try {
    await t.gateway.estimate(t.i); t.timeout(); await assert.rejects(t.gateway.submit(t.i));
    const saved = t.store.read().intents[0];
    assert.equal((await t.gateway.reconcile(saved)).status, 'pending');
    const restarted = new AgentWalletGateway(t.i.sender, t.arc, t.cli, { store: t.store, sendEnabled: true, authorize: () => true });
    await restarted.estimate(saved); await assert.rejects(restarted.submit(saved), /ALREADY_DISPATCHED/);
    t.tx.amounts = ['3']; await assert.rejects(restarted.recover(saved, t.tx.id), /MISMATCH/);
    t.tx.amounts = ['4']; await restarted.recover(saved, t.tx.id);
    assert.equal(t.store.read().intents[0].providerId, t.tx.id); assert.equal(t.sends(), 1);
    t.tx.blockchain = 'ARC'; await assert.rejects(restarted.reconcile(t.store.read().intents[0]), /MISMATCH/);
  } finally { t.store.close(); }
});

test('Agent Wallet rejects disabled execution, changed authority and changed quoted amount before dispatch', async () => {
  const t = setup();
  try {
    await t.gateway.estimate(t.i);
    await assert.rejects(t.gateway.submit({ ...t.i, amount: '1' }), /QUOTE_MISMATCH/);
    t.deny(); await assert.rejects(t.gateway.submit(t.i), /AUTHORITY/);
    const disabled = new AgentWalletGateway(t.i.sender, t.arc, t.cli, { store: t.store, sendEnabled: false, authorize: () => true });
    await assert.rejects(disabled.submit(t.i), /SEND_DISABLED/); assert.equal(t.sends(), 0);
  } finally { t.store.close(); }
});

test('late CLI response is saved after caller timeout and is reconcilable after database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tameion-agent-')); const file = join(directory, 'agent.db'); const t = setup(file);
  let release!: (value: unknown) => void;
  const delayed = new Promise<unknown>(resolve => { release = resolve; });
  const cli = async (args: string[]) => args.includes('--idempotency-key') ? delayed : t.cli(args);
  const g = new AgentWalletGateway(t.i.sender, t.arc, cli, { store: t.store, sendEnabled: true, authorize: () => true, responseTimeoutMs: 5 });
  try {
    await g.estimate(t.i); await assert.rejects(g.submit(t.i), /SUBMISSION_UNKNOWN/);
    release({ data: t.tx }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(t.store.read().intents[0].providerId, t.tx.id); t.store.close();
    const reopened = new Store(file, t.state);
    try {
      const restored = new AgentWalletGateway(t.i.sender, t.arc, t.cli, { store: reopened, sendEnabled: true, authorize: () => true });
      const saved = reopened.read().intents[0];
      assert.equal((await restored.reconcile(saved)).status, 'confirmed');
      await assert.rejects(restored.submit(saved), /ALREADY_DISPATCHED/);
      t.arc.verifyAgentTransfer = async () => { throw new Error('invalid canonical receipt'); };
      await assert.rejects(restored.reconcile(saved), /invalid canonical receipt/);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unknown provider ID, old receipt, failed status and already-used transaction never settle', async () => {
  const t = setup();
  try {
    await t.gateway.estimate(t.i); await t.gateway.submit(t.i);
    const saved = t.store.read().intents[0];
    assert.equal((await t.gateway.reconcile({ ...saved, providerId: randomUUID() })).status, 'pending');
    t.tx.state = 'FAILED'; await assert.rejects(t.gateway.reconcile(saved), /TERMINAL/);
    t.tx.state = 'COMPLETE';
    t.arc.verifyAgentTransfer = async () => ({ hash: t.tx.txHash, block: '99', timestamp: Date.now() });
    await assert.rejects(t.gateway.reconcile(saved), /PREDATES/);
    t.arc.verifyAgentTransfer = async () => ({ hash: t.tx.txHash, block: '101', timestamp: Date.now() });
    t.store.change(s => { s.intents.push({ ...saved, id: randomUUID(), idempotencyKey: randomUUID(), status: 'SETTLED', hash: undefined }); });
    await assert.rejects(t.gateway.reconcile(saved), /ALREADY_USED/);
  } finally { t.store.close(); }
});

test('evidence arriving during provider checks invalidates the previously authorized submission', () => {
  const t = setup();
  try {
    t.store.change(s => { s.intents[0].submissionStateVersion = s.financialVersion; });
    assert.equal(authorizeSubmission(t.store.read(), t.i), true);
    t.store.change(s => { s.evidence.push({ id: 'late', obligationId: 'A', text: 'Delivery is disputed', author: 'inbox', createdAt: new Date().toISOString() }); });
    assert.equal(authorizeSubmission(t.store.read(), t.i), false);
  } finally { t.store.close(); }
});

test('Engine drives an Agent Wallet payout through durable dispatch to independently verified settlement', async () => {
  const state = fixture(); state.mode = 'testnet'; state.snapshot.balance = '20000000'; state.snapshot.block = '100'; state.obligations = [state.obligations[0]];
  const store = new Store(':memory:', state); let sent = false; let tx: Record<string, unknown> | undefined;
  const arc = { network: async () => {}, snapshot: async () => ({ ...state.snapshot, balance: sent ? '16000000' : '20000000', block: sent ? '101' : '100', observedAt: new Date().toISOString() }), verifyAgentTransfer: async () => ({ hash: tx!.txHash, block: '101', timestamp: Date.now() }) } as unknown as ArcReader;
  const cli = async (args: string[]) => {
    if (args[0] === 'transaction') return { data: { transactions: [tx] } };
    if (args[1] === 'list') return { data: { wallets: [{ type: 'agent', address: state.policy.sender, blockchain: 'ARC-TESTNET' }] } };
    if (args.includes('--estimate')) return { data: { blockchain: 'ARC-TESTNET', medium: { gasLimit: '100000', maxFee: '20', priorityFee: '1' } } };
    assert.equal(store.read().intents[0].status, 'SUBMITTING'); assert.ok(store.read().intents[0].agentDispatchAt); assert.equal(sent, false); sent = true;
    tx = { id: randomUUID(), idempotencyKey: args[args.indexOf('--idempotency-key') + 1], state: 'CONFIRMED', blockchain: 'ARC-TESTNET', sourceAddress: state.policy.sender, destinationAddress: args[2], amounts: [args[args.indexOf('--amount') + 1]], operation: 'TRANSFER', txHash: `0x${'b'.repeat(64)}`, createDate: new Date().toISOString() };
    return { data: tx };
  };
  const gateway = new AgentWalletGateway(state.policy.sender, arc, cli, { store, sendEnabled: true, authorize: i => authorizeSubmission(store.read(), i) });
  try {
    const engine = new Engine(store, gateway, new RulesPlanner()); await engine.run(); await engine.reconcile();
    assert.equal(store.read().intents.length, 1); assert.equal(store.read().intents[0].status, 'SETTLED'); assert.equal(store.read().obligations[0].paid, true); assert.equal(store.read().snapshot.balance, '16000000');
  } finally { store.close(); }
});
