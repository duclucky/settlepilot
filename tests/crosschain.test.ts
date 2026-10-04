import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem';
import { EvmSourceReader } from '../src/adapters/crosschain.ts';

const customer = '0xA3148e448c74F0D7e819Ee565d24b7881898F343';
const agent = '0xd66f5ff4002084e7a8b84972613739dfa59746c8';
const token = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const hash = `0x${'a'.repeat(64)}`;

function transferLog(from: `0x${string}` = customer, to: `0x${string}` = agent, value = 10_000_000n) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  };
}

test('gasless EIP-3009 receipt accepts the token owner from Transfer even when a payee relays the transaction', async () => {
  const reader = new EvmSourceReader('BASE-SEPOLIA');
  (reader as never as { proof(hash: string): Promise<unknown> }).proof = async () => ({
    receipt: { blockNumber: 2n, logs: [transferLog()] },
    tx: { from: '0x3e3d8eded44e4f1e87e02767f8171ede9a47cec0', to: '0x0000000071727de22e5e9d8baf0edac6f37da032' },
    block: { timestamp: 100n },
  });
  await assert.doesNotReject(reader.verifyIncoming(hash, { sender: customer, recipient: agent, amount: '10000000' }));
});

test('gasless incoming verification still rejects the wrong token owner or extra owner outflow', async () => {
  const reader = new EvmSourceReader('BASE-SEPOLIA');
  (reader as never as { proof(hash: string): Promise<unknown> }).proof = async () => ({
    receipt: { blockNumber: 2n, logs: [transferLog(agent, agent), transferLog(customer, agent, 1n)] },
    tx: { from: agent, to: token },
    block: { timestamp: 100n },
  });
  await assert.rejects(reader.verifyIncoming(hash, { sender: customer, recipient: agent, amount: '10000000' }), /WRONG_SOURCE_TRANSFER/);
});
