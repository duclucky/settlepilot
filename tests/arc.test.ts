import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, erc20Abi, type Hex } from 'viem';
import { fixture, CHAIN_ID, USDC } from '../src/domain.ts';
import { SYSTEM_EMITTER, verifyTransfer, verifyAgentTransferProof, verifyCctpMintProof, type TransferProof } from '../src/adapters/arc.ts';

const sender = fixture().policy.sender as Hex, recipient = fixture().obligations[0].recipient as Hex;
const expected = { sender, recipient, amount: '4000000', chainId: CHAIN_ID };
function proof(): TransferProof {
  return { chainId: CHAIN_ID, hash: 'same', transactionHash: 'same', blockHash: 'block', transactionBlockHash: 'block', status: 'success', from: sender, to: USDC, value: 0n,
    input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, 4000000n] }),
    logs: [USDC, SYSTEM_EMITTER].map(address => ({ address, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: sender, to: recipient } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [address === USDC ? 4000000n : 4_000_000_000_000_000_000n]) })),
  };
}
test('Arc verifies both log streams without double-counting 6/18 decimal values', () => { assert.doesNotThrow(() => verifyTransfer(proof(), expected)); });
test('T09 rejects wrong receipt, sender, amount, recipient, chain or forged emitter', () => {
  for (const mutate of [
    (p: TransferProof) => { p.status = 'reverted'; },
    (p: TransferProof) => { p.chainId = 1; },
    (p: TransferProof) => { p.from = recipient; },
    (p: TransferProof) => { p.logs = []; },
    (p: TransferProof) => { p.logs.forEach(l => { l.address = recipient; }); },
    (p: TransferProof) => { p.transactionBlockHash = 'other'; },
    (p: TransferProof) => { p.input = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [sender, 4000000n] }); },
    (p: TransferProof) => { p.logs[1].data = encodeAbiParameters([{ type: 'uint256' }], [4000000n]); },
  ]) { const p = proof(); mutate(p); assert.throws(() => verifyTransfer(p, expected)); }
});
test('native transfer requires exact 18-decimal value and a system log', () => {
  const p = proof(); p.to = recipient; p.input = '0x'; p.value = 4_000_000_000_000_000_000n; p.logs = [p.logs[1]];
  assert.doesNotThrow(() => verifyTransfer(p, expected)); p.value++; assert.throws(() => verifyTransfer(p, expected));
});

test('Agent contract wallet proof permits a relayer while requiring exact authentic wallet outflows', () => {
  const p = proof(); p.from = `0x${'9'.repeat(40)}`; p.to = `0x${'8'.repeat(40)}`; p.input = '0xabcdef';
  assert.doesNotThrow(() => verifyAgentTransferProof(p, expected, '0x6000'));
  assert.throws(() => verifyTransfer(p, expected), /WRONG_SENDER/);
  for (const mutate of [
    (p: TransferProof) => { p.status = 'reverted'; },
    (p: TransferProof) => { p.transactionHash = 'other'; },
    (p: TransferProof) => { p.transactionBlockHash = 'other'; },
    (p: TransferProof) => { p.chainId = 1; },
    (p: TransferProof) => { p.logs = []; },
    (p: TransferProof) => { p.logs.forEach(l => { l.address = recipient; }); },
    (p: TransferProof) => { p.logs.push(p.logs[0]); },
    (p: TransferProof) => { p.logs[1].data = encodeAbiParameters([{ type: 'uint256' }], [4000000n]); },
    (p: TransferProof) => { p.logs.push({ address: USDC, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: sender, to: `0x${'7'.repeat(40)}` } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [1n]) }); },
  ]) { const bad = structuredClone(p); mutate(bad); assert.throws(() => verifyAgentTransferProof(bad, expected, '0x6000')); }
  assert.throws(() => verifyAgentTransferProof(p, expected, '0x'), /CONTRACT_WALLET_REQUIRED/);
});

test('CCTP mint proof requires canonical zero-address mint of the exact Arc amount', () => {
  const p = proof(); const zero = `0x${'0'.repeat(40)}` as Hex;
  p.logs = [USDC, SYSTEM_EMITTER].map(address => ({ address, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: zero, to: recipient } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [address === USDC ? 4000000n : 4_000_000_000_000_000_000n]) }));
  assert.doesNotThrow(() => verifyCctpMintProof(p, recipient, '4000000'));
  p.logs[0].data = encodeAbiParameters([{ type: 'uint256' }], [3999999n]);
  assert.throws(() => verifyCctpMintProof(p, recipient, '4000000'), /WRONG_MINT_AMOUNT/);
});
