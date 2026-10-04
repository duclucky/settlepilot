import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentWalletGateway } from '../src/adapters/agent-wallet.ts';
import { ArcReader } from '../src/adapters/arc.ts';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';

test('Circle Agent Wallet connection verifies wallet ownership on ARC-TESTNET and reads chain balance', async () => {
  const state = fixture(); const commands: string[][] = [];
  const arc = { snapshot: async (sender: string) => { assert.equal(sender, state.policy.sender); return state.snapshot; } } as ArcReader;
  const gateway = new AgentWalletGateway(state.policy.sender, arc, async args => {
    commands.push(args); return { data: { wallets: [{ type: 'agent', address: state.policy.sender, blockchain: 'ARC-TESTNET' }] } };
  });
  assert.deepEqual(await gateway.snapshot(), state.snapshot);
  assert.deepEqual(commands[0], ['wallet', 'list', '--chain', 'ARC-TESTNET', '--type', 'agent', '--output', 'json']);
});

test('Circle connection rejects another account or chain and cannot silently switch wallet provider', async () => {
  const state = fixture(); let rpcCalled = false;
  const arc = { snapshot: async () => { rpcCalled = true; return state.snapshot; } } as unknown as ArcReader;
  for (const blockchain of ['ARC', 'BASE-SEPOLIA']) {
    const gateway = new AgentWalletGateway(state.policy.sender, arc, async () => ({ data: { wallets: [{ type: 'agent', address: state.policy.sender, blockchain }] } }));
    await assert.rejects(gateway.snapshot(), /AGENT_WALLET_NOT_FOUND/);
  }
  const gateway = new AgentWalletGateway(state.policy.sender, arc, async () => ({ data: { wallets: [{ type: 'agent', address: state.obligations[0].recipient, blockchain: 'ARC-TESTNET' }] } }));
  await assert.rejects(gateway.snapshot(), /AGENT_WALLET_NOT_FOUND/); assert.equal(rpcCalled, false);
  const store = new Store(':memory:', state);
  try { store.bindWallet('agent:test'); store.bindWallet('agent:test'); assert.throws(() => store.bindWallet('circle:test'), /PROVIDER_MISMATCH/); } finally { store.close(); }
});
