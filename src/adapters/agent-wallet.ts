import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseUnits } from 'viem';
import { z } from 'zod';
import { Address, CHAIN_ID, USDC, Units, display, money, isPending, type Intent, type PaymentGateway } from '../domain.ts';
import { Store, event } from '../store.ts';
import { ArcReader } from './arc.ts';

export type Cli = (args: string[]) => Promise<unknown>;
const execute = promisify(execFile);
const Wallets = z.object({ data: z.object({ wallets: z.array(z.object({ type: z.string(), address: Address, blockchain: z.string() })) }) });
const Transaction = z.object({ id: z.string().uuid(), idempotencyKey: z.string().optional(), state: z.string(), blockchain: z.string(), sourceAddress: Address, destinationAddress: Address, amounts: z.array(z.string()).length(1), operation: z.literal('TRANSFER'), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(), createDate: z.iso.datetime() });
type Tx = z.infer<typeof Transaction>;
interface Execution { store: Store; sendEnabled: boolean; authorize: (intent: Intent) => boolean; responseTimeoutMs?: number }
const binding = (i: Intent) => JSON.stringify([i.id, i.sender, i.recipient, i.amount, i.chainId, i.policyVersion, i.obligationVersion, i.idempotencyKey]);
const Fee = z.object({ data: z.object({ blockchain: z.literal('ARC-TESTNET'), medium: z.object({ gasLimit: z.string().regex(/^[1-9]\d*$/), maxFee: z.string().regex(/^\d+(\.\d{1,9})?$/), priorityFee: z.string().regex(/^\d+(\.\d{1,9})?$/) }) }) });

export class AgentWalletGateway implements PaymentGateway {
  mode = 'testnet' as const;
  private sender: string;
  private quotes = new Map<string, { binding: string; at: number; fee: string }>();
  constructor(sender: string, readonly arc: ArcReader, private cli: Cli, private execution?: Execution) { this.sender = Address.parse(sender); }
  private async wallet() {
    const result = Wallets.parse(await this.cli(['wallet', 'list', '--chain', 'ARC-TESTNET', '--type', 'agent', '--output', 'json']));
    if (!result.data.wallets.some(w => w.type === 'agent' && w.blockchain === 'ARC-TESTNET' && w.address === this.sender)) throw new Error('AGENT_WALLET_NOT_FOUND');
  }
  async snapshot() { await this.wallet(); return this.arc.snapshot(this.sender); }
  private transferArgs(i: Intent) {
    if (i.chainId !== CHAIN_ID || Address.parse(i.sender) !== this.sender) throw new Error('WRONG_CHAIN_OR_SENDER');
    if (BigInt(Units.parse(i.amount)) <= 0n) throw new Error('INVALID_AMOUNT');
    z.string().uuid().parse(i.idempotencyKey);
    return ['wallet', 'transfer', Address.parse(i.recipient), '--amount', display(i.amount), '--token', USDC, '--address', this.sender, '--chain', 'ARC-TESTNET', '--output', 'json'];
  }
  async estimate(i: Intent) {
    const args = this.transferArgs(i); await this.wallet(); await this.arc.network();
    const { medium } = Fee.parse(await this.cli([...args, '--estimate'])).data;
    const maxFee = parseUnits(medium.maxFee, 9), priority = parseUnits(medium.priorityFee, 9);
    if (maxFee <= 0n || priority > maxFee) throw new Error('INVALID_FEE');
    // This pinned Agent Wallet path sponsors gas: the network estimate is paid
    // by Circle, not the operating wallet. Never fall back to an unsponsored path.
    // Receipt verification rejects any wallet outflow beyond the exact payment.
    const fee = '0';
    this.quotes.set(i.id, { binding: binding(i), at: Date.now(), fee }); return fee;
  }
  private matches(tx: Tx, i: Intent) {
    if (tx.blockchain !== 'ARC-TESTNET' || tx.sourceAddress !== i.sender.toLowerCase() || tx.destinationAddress !== i.recipient.toLowerCase() || money(tx.amounts[0]) !== i.amount || Date.parse(tx.createDate) + 1000 < Date.parse(i.agentDispatchAt ?? i.createdAt)) throw new Error('PROVIDER_TRANSACTION_MISMATCH');
  }
  async submit(i: Intent) {
    const execution = this.execution;
    if (!execution?.sendEnabled) throw new Error('TESTNET_SEND_DISABLED');
    const args = this.transferArgs(i), quote = this.quotes.get(i.id);
    if (execution.store.read().intents.find(x => x.id === i.id)?.agentDispatchAt) throw new Error('AGENT_ALREADY_DISPATCHED');
    if (!quote || quote.binding !== binding(i) || Date.now() - quote.at > 60000) throw new Error('QUOTE_MISMATCH');
    await this.wallet(); await this.arc.network();
    execution.store.change(s => {
      const saved = s.intents.find(x => x.id === i.id);
      if (saved?.agentDispatchAt) throw new Error('AGENT_ALREADY_DISPATCHED');
      if (!saved || saved.status !== 'SUBMITTING' || binding(saved) !== binding(i) || !execution.authorize(i) || BigInt(quote.fee) > BigInt(s.policy.gasLimit) || Date.now() - quote.at > 60000) throw new Error('SUBMISSION_AUTHORITY_CHANGED');
      saved.agentDispatchAt = new Date().toISOString();
      event(s, 'AGENT_DISPATCHED', `${i.id}: Circle-sponsored ARC-TESTNET transfer`);
    });
    this.quotes.delete(i.id);
    // Persist a late successful response even if the HTTP caller has timed out.
    const request = this.cli([...args, '--idempotency-key', i.idempotencyKey]).then(result => {
      const tx = Transaction.parse(z.object({ data: Transaction }).parse(result).data);
      this.matches(tx, execution.store.read().intents.find(x => x.id === i.id)!);
      if (tx.idempotencyKey !== i.idempotencyKey) throw new Error('IDEMPOTENCY_MISMATCH');
      execution.store.change(s => {
        const saved = s.intents.find(x => x.id === i.id)!;
        if (!isPending(saved)) return;
        if (saved.providerId && saved.providerId !== tx.id) throw new Error('PROVIDER_TRANSACTION_MISMATCH');
        if (s.intents.some(x => x.id !== i.id && (x.providerId === tx.id || (tx.txHash && x.hash?.toLowerCase() === tx.txHash.toLowerCase())))) throw new Error('TRANSACTION_ALREADY_USED');
        saved.providerId = tx.id;
        if (tx.txHash) saved.hash = tx.txHash;
        event(s, 'AGENT_RESPONSE_SAVED', i.id);
      });
      return { providerId: tx.id };
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AGENT_SUBMISSION_UNKNOWN')), execution.responseTimeoutMs ?? 20000); })]); }
    finally { clearTimeout(timer); }
  }
  private async transaction(id: string) {
    z.string().uuid().parse(id); let cursor: string | undefined;
    // Bounded pagination; absence is inconclusive and never permits a resend.
    for (let page = 0; page < 5; page++) {
      const result = z.object({ data: z.object({ transactions: z.array(z.object({ id: z.string() }).passthrough()) }) }).parse(await this.cli(['transaction', 'list', '--address', this.sender, '--chain', 'ARC-TESTNET', '--limit', '50', '--output', 'json', ...(cursor ? ['--cursor', cursor] : [])]));
      const transactions = result.data.transactions, match = transactions.find(t => t.id === id);
      if (match) return Transaction.parse(match);
      if (transactions.length < 50 || transactions.at(-1)!.id === cursor) return undefined;
      cursor = transactions.at(-1)!.id;
    }
    return undefined;
  }
  private async proof(i: Intent, tx: Tx) {
    this.matches(tx, i);
    if (['FAILED', 'CANCELLED', 'DENIED'].includes(tx.state)) throw new Error('PROVIDER_TERMINAL_REQUIRES_REVIEW');
    if (!['CONFIRMED', 'COMPLETE'].includes(tx.state) || !tx.txHash) return false;
    const receipt = await this.arc.verifyAgentTransfer(tx.txHash, i);
    if (!i.agentDispatchAt || !i.snapshot || BigInt(receipt.block) <= BigInt(i.snapshot.block) || receipt.timestamp + 999 < Date.parse(i.agentDispatchAt)) throw new Error('RECEIPT_PREDATES_INTENT');
    if (this.execution?.store.read().intents.some(x => x.id !== i.id && (x.providerId === tx.id || x.hash?.toLowerCase() === tx.txHash!.toLowerCase()))) throw new Error('TRANSACTION_ALREADY_USED');
    return true;
  }
  async reconcile(i: Intent) {
    if (!i.providerId) return { status: 'pending' as const };
    const tx = await this.transaction(i.providerId); if (!tx) return { status: 'pending' as const };
    const confirmed = await this.proof(i, tx);
    return { status: confirmed ? 'confirmed' as const : 'pending' as const, providerId: tx.id, hash: tx.txHash };
  }
  async recover(i: Intent, providerId: string) {
    if (!this.execution || !isPending(i) || !i.agentDispatchAt) throw new Error('RECOVERY_NOT_ALLOWED');
    const tx = await this.transaction(providerId);
    if (!tx || !await this.proof(i, tx)) throw new Error('RECOVERY_PROOF_UNAVAILABLE');
    this.execution.store.change(s => {
      const saved = s.intents.find(x => x.id === i.id)!;
      if (!isPending(saved) || (saved.providerId && saved.providerId !== providerId) || s.intents.some(x => x.id !== i.id && (x.providerId === providerId || x.hash?.toLowerCase() === tx.txHash!.toLowerCase()))) throw new Error('RECOVERY_CONFLICT');
      saved.providerId = providerId; saved.hash = tx.txHash;
      event(s, 'AGENT_RECOVERY_ATTACHED', `${i.id}: ${providerId}`);
    });
  }
}

export function circleCli(entrypoint: string): Cli {
  return async args => {
    try {
      // Pin the command contract, especially the sponsored-gas behavior. No secrets in arguments.
      const installed = JSON.parse(readFileSync(resolve(dirname(entrypoint), '../package.json'), 'utf8'));
      if (installed.name !== '@circle-fin/cli' || installed.version !== '1.1.4') throw new Error('UNSUPPORTED_CLI');
      const { stdout } = await execute(process.execPath, [entrypoint, ...args], { timeout: args.includes('--idempotency-key') ? 240000 : 30000, maxBuffer: 1024 * 1024, windowsHide: true });
      return JSON.parse(stdout);
    } catch { throw new Error('CIRCLE_AGENT_REQUEST_FAILED'); }
  };
}
