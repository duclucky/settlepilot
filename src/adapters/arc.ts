import { createPublicClient, http, erc20Abi, decodeEventLog, decodeFunctionData, parseAbiItem, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { CHAIN_ID, USDC, Address, type Intent, type Snapshot } from '../domain.ts';

export const SYSTEM_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';
type ExpectedTransfer = Pick<Intent, 'sender' | 'recipient' | 'amount' | 'chainId'>;
export interface TransferProof {
  chainId: number; hash: string; transactionHash: string; blockHash: string; transactionBlockHash: string;
  status: string; from: string; to: string | null; input: Hex; value: bigint;
  logs: { address: string; topics: readonly Hex[]; data: Hex }[];
}
export function verifyTransfer(proof: TransferProof, expected: Pick<Intent, 'sender' | 'recipient' | 'amount' | 'chainId'>): void {
  if (proof.chainId !== CHAIN_ID || expected.chainId !== CHAIN_ID) throw new Error('WRONG_CHAIN');
  if (proof.status !== 'success' || proof.hash !== proof.transactionHash || proof.blockHash !== proof.transactionBlockHash) throw new Error('INVALID_RECEIPT');
  if (proof.from.toLowerCase() !== expected.sender.toLowerCase()) throw new Error('WRONG_SENDER');
  const recipient = Address.parse(expected.recipient);
  const amount = BigInt(expected.amount);
  if (amount <= 0n) throw new Error('INVALID_AMOUNT');
  if (proof.to?.toLowerCase() === USDC) {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: proof.input });
    if (decoded.functionName !== 'transfer' || decoded.args[0].toLowerCase() !== recipient || decoded.args[1] !== amount || proof.value !== 0n) throw new Error('WRONG_TRANSFER_CALL');
  } else if (proof.to?.toLowerCase() !== recipient || proof.value !== amount * 1_000_000_000_000n || proof.input !== '0x') {
    throw new Error('WRONG_NATIVE_TRANSFER');
  }
  // Inspect each stream separately: a normal ERC-20 transfer has BOTH logs.
  let matched = false;
  for (const emitter of [SYSTEM_EMITTER, USDC]) {
    const movements: bigint[] = [];
    for (const log of proof.logs.filter(l => l.address.toLowerCase() === emitter)) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
        if (decoded.args.from.toLowerCase() === expected.sender.toLowerCase() && decoded.args.to.toLowerCase() === recipient) movements.push(decoded.args.value);
      } catch { /* A different event from the same contract is not transfer evidence. */ }
    }
    if (movements.length) {
      const unitAmount = emitter === SYSTEM_EMITTER ? amount * 1_000_000_000_000n : amount;
      if (movements.length !== 1 || movements[0] !== unitAmount) throw new Error('WRONG_TRANSFER_LOG');
      matched = true;
    }
  }
  if (!matched) throw new Error('NO_TRANSFER_LOG');
}

/** A contract wallet can be called by a bundler/relayer. Authentic USDC logs,
 * not the outer transaction's from field, prove the wallet's actual payment.
 * Reject any additional wallet outflow (including a wallet-funded gas charge).
 */
export function verifyAgentTransferProof(proof: TransferProof, expected: ExpectedTransfer, senderCode: Hex) {
  if (proof.chainId !== CHAIN_ID || expected.chainId !== CHAIN_ID) throw new Error('WRONG_CHAIN');
  if (proof.status !== 'success' || proof.hash !== proof.transactionHash || proof.blockHash !== proof.transactionBlockHash) throw new Error('INVALID_RECEIPT');
  if (!senderCode || senderCode === '0x') throw new Error('CONTRACT_WALLET_REQUIRED');
  const sender = Address.parse(expected.sender), recipient = Address.parse(expected.recipient);
  const amount = BigInt(expected.amount); if (amount <= 0n || sender === recipient) throw new Error('INVALID_AMOUNT');
  let streams = 0;
  for (const emitter of [USDC, SYSTEM_EMITTER]) {
    const outgoing: { to: string; value: bigint }[] = [];
    for (const log of proof.logs.filter(l => l.address.toLowerCase() === emitter)) {
      let decoded;
      try { decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] }); }
      catch { continue; }
      if (decoded.args.from.toLowerCase() === sender) outgoing.push({ to: decoded.args.to.toLowerCase(), value: decoded.args.value });
    }
    if (!outgoing.length) continue;
    const scaled = amount * (emitter === SYSTEM_EMITTER ? 1_000_000_000_000n : 1n);
    if (outgoing.length !== 1 || outgoing[0].to !== recipient || outgoing[0].value !== scaled) throw new Error('UNEXPECTED_WALLET_OUTFLOW');
    streams++;
  }
  if (!streams) throw new Error('NO_TRANSFER_LOG');
}
export function verifyCctpMintProof(proof: TransferProof, recipientAddress: string, amountUnits: string) {
  if (proof.chainId !== CHAIN_ID || proof.status !== 'success' || proof.hash !== proof.transactionHash || proof.blockHash !== proof.transactionBlockHash) throw new Error('INVALID_MINT_RECEIPT');
  const recipient = Address.parse(recipientAddress), amount = BigInt(amountUnits); let streams = 0;
  for (const emitter of [USDC, SYSTEM_EMITTER]) {
    const mints: bigint[] = [];
    for (const log of proof.logs.filter(l => l.address.toLowerCase() === emitter)) {
      try {
        const d = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
        if (d.args.from === `0x${'0'.repeat(40)}` && d.args.to.toLowerCase() === recipient) mints.push(d.args.value);
      } catch { /* Ignore other protocol events. */ }
    }
    if (!mints.length) continue;
    const expected = amount * (emitter === SYSTEM_EMITTER ? 1_000_000_000_000n : 1n);
    if (mints.length !== 1 || mints[0] !== expected) throw new Error('WRONG_MINT_AMOUNT');
    streams++;
  }
  if (!streams) throw new Error('NO_MINT_LOG');
}
export class ArcReader {
  readonly client;
  constructor(rpc = 'https://rpc.testnet.arc.io') {
    const url = new URL(rpc);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('HTTPS_RPC_REQUIRED');
    this.client = createPublicClient({ chain: arcTestnet, transport: http(rpc, { timeout: 12000, retryCount: 0 }) });
  }
  async network() { if (await this.client.getChainId() !== CHAIN_ID) throw new Error('WRONG_CHAIN'); }
  async snapshot(sender: string): Promise<Snapshot> {
    await this.network(); const block = await this.client.getBlockNumber();
    const balance = await this.client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [Address.parse(sender) as Hex], blockNumber: block });
    return { balance: balance.toString(), chainId: CHAIN_ID, block: block.toString(), observedAt: new Date().toISOString() };
  }
  async verify(hash: string, expected: Pick<Intent, 'sender' | 'recipient' | 'amount' | 'chainId'>) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_HASH');
    await this.network();
    const [receipt, tx] = await Promise.all([this.client.getTransactionReceipt({ hash: hash as Hex }), this.client.getTransaction({ hash: hash as Hex })]);
    const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash || !tx.blockHash) throw new Error('NONCANONICAL_RECEIPT');
    verifyTransfer({ chainId: CHAIN_ID, hash: receipt.transactionHash, transactionHash: tx.hash, blockHash: receipt.blockHash, transactionBlockHash: tx.blockHash, status: receipt.status, from: tx.from, to: tx.to, input: tx.input, value: tx.value, logs: receipt.logs }, expected);
    return { hash, block: receipt.blockNumber.toString(), timestamp: Number(block.timestamp) * 1000 };
  }
  async incoming(source: string, recipient: string, fromBlock: bigint, toBlock: bigint, amount: string) {
    await this.network();
    const logs = await this.client.getLogs({
      address: [SYSTEM_EMITTER as Hex, USDC],
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
      args: { from: Address.parse(source) as Hex, to: Address.parse(recipient) as Hex }, fromBlock, toBlock,
    });
    return [...new Set(logs.filter(l => l.args.value === BigInt(amount) * (l.address.toLowerCase() === SYSTEM_EMITTER ? 1_000_000_000_000n : 1n)).map(l => l.transactionHash).filter((h): h is Hex => !!h))];
  }
  async verifyAgentTransfer(hash: string, expected: ExpectedTransfer) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_HASH');
    await this.network();
    const [receipt, tx] = await Promise.all([this.client.getTransactionReceipt({ hash: hash as Hex }), this.client.getTransaction({ hash: hash as Hex })]);
    const [block, code] = await Promise.all([this.client.getBlock({ blockNumber: receipt.blockNumber }), this.client.getCode({ address: Address.parse(expected.sender) as Hex, blockNumber: receipt.blockNumber })]);
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || tx.hash.toLowerCase() !== hash.toLowerCase() || tx.chainId !== CHAIN_ID || block.hash !== receipt.blockHash || !tx.blockHash) throw new Error('NONCANONICAL_RECEIPT');
    verifyAgentTransferProof({ chainId: CHAIN_ID, hash: receipt.transactionHash, transactionHash: tx.hash, blockHash: receipt.blockHash, transactionBlockHash: tx.blockHash, status: receipt.status, from: tx.from, to: tx.to, input: tx.input, value: tx.value, logs: receipt.logs }, expected, code ?? '0x');
    return { hash, block: receipt.blockNumber.toString(), timestamp: Number(block.timestamp) * 1000 };
  }
  async verifyCctpMint(hash: string, recipient: string, amount: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_HASH');
    await this.network(); const h = hash as Hex;
    const [receipt, tx] = await Promise.all([this.client.getTransactionReceipt({ hash: h }), this.client.getTransaction({ hash: h })]);
    const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || tx.hash.toLowerCase() !== hash.toLowerCase() || tx.chainId !== CHAIN_ID || block.hash !== receipt.blockHash || !tx.blockHash) throw new Error('NONCANONICAL_RECEIPT');
    verifyCctpMintProof({ chainId: CHAIN_ID, hash: receipt.transactionHash, transactionHash: tx.hash, blockHash: receipt.blockHash, transactionBlockHash: tx.blockHash, status: receipt.status, from: tx.from, to: tx.to, input: tx.input, value: tx.value, logs: receipt.logs }, recipient, amount);
    return { hash, block: receipt.blockNumber.toString(), timestamp: Number(block.timestamp) * 1000 };
  }
}
