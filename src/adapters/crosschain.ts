import { createPublicClient, decodeEventLog, defineChain, erc20Abi, http, parseAbiItem, type Hex } from 'viem';
import { Address, SOURCE_CHAINS, type Snapshot, type SourceChain } from '../domain.ts';

export class EvmSourceReader {
  readonly client;
  readonly config;
  constructor(readonly sourceChain: SourceChain, rpc = SOURCE_CHAINS[sourceChain].rpc) {
    this.config = SOURCE_CHAINS[sourceChain];
    const url = new URL(rpc);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('HTTPS_RPC_REQUIRED');
    const chain = defineChain({ id: this.config.chainId, name: this.config.label, nativeCurrency: { name: 'Testnet gas', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
    this.client = createPublicClient({ chain, transport: http(rpc, { timeout: 12000, retryCount: 0 }) });
  }
  async network() { if (await this.client.getChainId() !== this.config.chainId) throw new Error('WRONG_SOURCE_CHAIN'); }
  async snapshot(address: string): Promise<Snapshot> {
    await this.network(); const block = await this.client.getBlockNumber();
    const balance = await this.client.readContract({ address: this.config.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [Address.parse(address) as Hex], blockNumber: block });
    return { balance: balance.toString(), chainId: this.config.chainId, block: block.toString(), observedAt: new Date().toISOString() };
  }
  async incoming(source: string, recipient: string, fromBlock: bigint, toBlock: bigint, amount: string) {
    await this.network();
    const logs = await this.client.getLogs({ address: this.config.usdc, event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'), args: { from: Address.parse(source) as Hex, to: Address.parse(recipient) as Hex }, fromBlock, toBlock });
    return [...new Set(logs.filter(l => l.args.value === BigInt(amount)).map(l => l.transactionHash).filter((h): h is Hex => !!h))];
  }
  async verifyIncoming(hash: string, expected: { sender: string; recipient: string; amount: string }) {
    const { receipt, block } = await this.proof(hash);
    // EIP-3009 may be relayed through an ERC-4337 EntryPoint, so neither tx.from nor
    // tx.to identifies the token owner. The canonical USDC Transfer log does.
    const matches = this.outflows(receipt.logs, Address.parse(expected.sender)).filter(x => x.to === Address.parse(expected.recipient) && x.value === BigInt(expected.amount));
    if (matches.length !== 1 || this.outflows(receipt.logs, Address.parse(expected.sender)).length !== 1) throw new Error('WRONG_SOURCE_TRANSFER');
    return { hash, block: receipt.blockNumber.toString(), timestamp: Number(block.timestamp) * 1000 };
  }
  async verifyWalletOutflow(hash: string, wallet: string, totalBurn: string) {
    const { receipt, block } = await this.proof(hash);
    const sender = Address.parse(wallet);
    const code = await this.client.getCode({ address: sender as Hex, blockNumber: receipt.blockNumber });
    if (!code || code === '0x') throw new Error('CONTRACT_WALLET_REQUIRED');
    const outflows = this.outflows(receipt.logs, sender);
    if (!outflows.length || outflows.reduce((n, x) => n + x.value, 0n) !== BigInt(totalBurn)) throw new Error('WRONG_BURN_AMOUNT');
    return { hash, block: receipt.blockNumber.toString(), timestamp: Number(block.timestamp) * 1000 };
  }
  private outflows(logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[], sender: string) {
    return logs.filter(l => l.address.toLowerCase() === this.config.usdc).flatMap(log => {
      try {
        const d = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
        return d.args.from.toLowerCase() === sender ? [{ to: d.args.to.toLowerCase(), value: d.args.value }] : [];
      } catch { return []; }
    });
  }
  private async proof(hash: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_HASH');
    await this.network(); const h = hash as Hex;
    const [receipt, tx] = await Promise.all([this.client.getTransactionReceipt({ hash: h }), this.client.getTransaction({ hash: h })]);
    const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || tx.hash.toLowerCase() !== hash.toLowerCase() || !tx.blockHash || block.hash !== receipt.blockHash) throw new Error('NONCANONICAL_SOURCE_RECEIPT');
    return { receipt, tx, block };
  }
}
