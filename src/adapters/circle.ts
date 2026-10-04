import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { parseUnits } from 'viem';
import { CHAIN_ID, USDC, display, type Intent, type PaymentGateway } from '../domain.ts';
import { ArcReader } from './arc.ts';

type Client = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
export type CirclePort = Pick<Client, 'getWallet' | 'createTransaction' | 'estimateTransferFee' | 'getTransaction' | 'listTransactions'>;
export interface CircleConfig { apiKey: string; entitySecret: string; walletId: string; sender: string; sendEnabled: boolean; authorize?: (intent: Intent) => boolean }
type Quote = { maxFee: string; priorityFee: string; gasLimit: string };
async function deadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), 15000); })]); }
  finally { clearTimeout(timer!); }
}
export class CircleGateway implements PaymentGateway {
  mode = 'testnet' as const;
  private quotes = new Map<string, Quote>();
  private client: CirclePort;
  constructor(private config: CircleConfig, readonly arc: ArcReader, client?: CirclePort) {
    if (!config.apiKey.startsWith('TEST_API_KEY:')) throw new Error('TEST_KEY_REQUIRED');
    const sdk = client ?? initiateDeveloperControlledWalletsClient({ apiKey: config.apiKey, entitySecret: config.entitySecret });
    // A timed-out submission remains unknown: the underlying request may still succeed.
    this.client = new Proxy(sdk, { get(target, prop) { const value = Reflect.get(target, prop); return typeof value === 'function' ? (...args: unknown[]) => deadline(value.apply(target, args)) : value; } });
  }
  private async wallet() {
    await this.arc.network();
    const wallet = (await this.client.getWallet({ id: this.config.walletId })).data?.wallet;
    if (!wallet || wallet.blockchain !== 'ARC-TESTNET' || wallet.accountType !== 'EOA' || wallet.address.toLowerCase() !== this.config.sender.toLowerCase()) throw new Error('WALLET_MISMATCH');
  }
  snapshot() { return this.arc.snapshot(this.config.sender); }
  async estimate(intent: Intent) {
    await this.wallet();
    const fee = (await this.client.estimateTransferFee({ walletId: this.config.walletId, blockchain: 'ARC-TESTNET', tokenAddress: USDC, destinationAddress: intent.recipient, amount: [display(intent.amount)] })).data?.medium;
    if (!fee?.maxFee || !fee.priorityFee || !fee.gasLimit) throw new Error('FEE_ESTIMATE_UNAVAILABLE');
    if (!/^\d+$/.test(fee.gasLimit) || BigInt(fee.gasLimit) <= 0n || !/^\d+(\.\d{1,9})?$/.test(fee.maxFee) || !/^\d+(\.\d{1,9})?$/.test(fee.priorityFee)) throw new Error('INVALID_FEE');
    const quote = { maxFee: fee.maxFee, priorityFee: fee.priorityFee, gasLimit: fee.gasLimit };
    const maxNative = BigInt(quote.gasLimit) * parseUnits(quote.maxFee, 9);
    this.quotes.set(intent.id, quote);
    return ((maxNative + 999_999_999_999n) / 1_000_000_000_000n).toString();
  }
  async submit(intent: Intent) {
    if (!this.config.sendEnabled) throw new Error('TESTNET_SEND_DISABLED');
    if (intent.chainId !== CHAIN_ID || intent.sender.toLowerCase() !== this.config.sender.toLowerCase()) throw new Error('WRONG_CHAIN_OR_SENDER');
    const quote = this.quotes.get(intent.id);
    if (!quote) throw new Error('MISSING_FEE_QUOTE');
    await this.wallet();
    if (!this.config.authorize?.(intent)) throw new Error('SUBMISSION_AUTHORITY_CHANGED');
    const response = await this.client.createTransaction({
      walletId: this.config.walletId, tokenAddress: USDC, amount: [display(intent.amount)],
      destinationAddress: intent.recipient, idempotencyKey: intent.idempotencyKey, refId: intent.id,
      fee: { type: 'absolute', config: quote },
    });
    this.quotes.delete(intent.id);
    if (!response.data?.id) throw new Error('UNKNOWN_SUBMISSION');
    return { providerId: response.data.id };
  }
  async reconcile(intent: Intent) {
    let id = intent.providerId;
    if (!id) {
      // A bounded search may be inconclusive. Absence never authorizes a resend.
      const list = await this.client.listTransactions({ walletIds: [this.config.walletId], blockchain: 'ARC-TESTNET', pageSize: 50 });
      const matches = list.data?.transactions?.filter(t => t.refId === intent.id) ?? [];
      if (matches.length !== 1) return { status: 'pending' as const };
      id = matches[0].id;
    }
    const tx = (await this.client.getTransaction({ id })).data?.transaction;
    if (!tx || tx.blockchain !== 'ARC-TESTNET' || tx.walletId !== this.config.walletId || tx.refId !== intent.id) throw new Error('PROVIDER_TRANSACTION_MISMATCH');
    if (['FAILED', 'DENIED', 'CANCELLED'].includes(tx.state)) throw new Error('PROVIDER_TERMINAL_REQUIRES_REVIEW');
    if (!tx.txHash) return { status: 'pending' as const, providerId: id };
    if (tx.state !== 'COMPLETE') return { status: 'pending' as const, providerId: id, hash: tx.txHash };
    await this.arc.verify(tx.txHash, intent);
    return { status: 'confirmed' as const, providerId: id, hash: tx.txHash };
  }
}
