import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Address, Units, display, isBridgePending, isPending, money, SOURCE_CHAINS, SOURCE_CHAIN_NAMES, type BridgeIntent, type Decision, type SourceChain, type State } from './domain.ts';
import { Store, event } from './store.ts';
import { ArcReader } from './adapters/arc.ts';
import { EvmSourceReader } from './adapters/crosschain.ts';
import type { Cli } from './adapters/agent-wallet.ts';
import { planningEligibility } from './policy.ts';
import { verifiedCrosschainBalances } from './treasury.ts';

const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(x => x.toLowerCase());
const SourceChainSchema = z.enum(SOURCE_CHAIN_NAMES);
const FeeResponse = z.object({ data: z.object({ fromChain: SourceChainSchema, toChain: z.literal('ARC-TESTNET'), fees: z.array(z.object({ finalityThreshold: z.number(), minimumFee: z.number().nonnegative(), forwardFee: z.object({ med: z.union([z.number(), z.string()]) }) })).min(1) }) });
const TransferResponse = z.object({ data: z.object({ fromChain: SourceChainSchema, toChain: z.literal('ARC-TESTNET'), amount: z.string(), status: z.enum(['complete', 'pending']), burnTxHash: Hash, forwardTxHash: Hash.optional() }) });
const Domain = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/)]).transform(Number);
const StatusAmount = z.union([Units, z.number().int().nonnegative().safe()]).transform(String);
const StatusResponse = z.object({ data: z.object({ status: z.string(), cctpVersion: z.number(), sourceDomain: Domain, destinationDomain: Domain, amount: StatusAmount, mintRecipient: z.string(), burnToken: z.string(), forwardTxHash: Hash.nullish() }) });
const Wallets = z.object({ data: z.object({ wallets: z.array(z.object({ type: z.string(), address: Address, blockchain: z.string() })) }) });

export function calculateBridgeQuote(amount: string, minimumFee: number, forwardFee: string) {
  if (!Number.isFinite(minimumFee) || minimumFee < 0 || !Number.isInteger(minimumFee * 10)) throw new Error('INVALID_CCTP_FEE');
  const scaledBps = BigInt(Math.round(minimumFee * 10));
  const protocol = BigInt(amount) * scaledBps / 100_000n;
  const fee = protocol + BigInt(forwardFee);
  return { fee: fee.toString(), totalBurn: (BigInt(amount) + fee).toString() };
}

export function fundingDeficit(state: State, now = Date.now()): string {
  if (state.paused || !state.policy.enabled || Date.parse(state.policy.authorityExpiresAt) <= now || state.intents.some(isPending) || state.bridgeIntents.some(isBridgePending)) return '0';
  const alreadySpent = state.intents.filter(i => ['SETTLED', 'SIMULATED'].includes(i.status)).reduce((n, i) => n + BigInt(i.amount), 0n);
  let budget = BigInt(state.policy.totalBudget) - alreadySpent; if (budget <= 0n) return '0';
  let obligations = 0n;
  for (const o of [...state.obligations].sort((a, b) => Date.parse(a.due) - Date.parse(b.due))) {
    const approved = state.approvals.some(a => a.actor === 'owner' && a.obligationId === o.id && a.obligationVersion === o.version && a.policyVersion === state.policy.version && Date.parse(a.expiresAt) > now);
    if (o.paid || !o.accepted || o.disputed || !state.policy.allowlist.includes(o.recipient.toLowerCase()) || Date.parse(o.due) > now + 14 * 86400000 || BigInt(o.amount) <= 0n || (BigInt(o.amount) > BigInt(state.policy.perObligation) && !approved) || BigInt(o.amount) > budget) continue;
    obligations += BigInt(o.amount); budget -= BigInt(o.amount);
  }
  const target = obligations + BigInt(state.policy.reserve) + BigInt(state.policy.gasLimit);
  return (target > BigInt(state.snapshot.balance) ? target - BigInt(state.snapshot.balance) : 0n).toString();
}

export function fundingDeficitForDecisions(state: State, decisions: Decision[], now = Date.now()): string {
  if (state.paused || !state.policy.enabled || Date.parse(state.policy.authorityExpiresAt) <= now || state.intents.some(isPending) || state.bridgeIntents.some(isBridgePending)) return '0';
  const alreadySpent = state.intents.filter(i => ['SETTLED', 'SIMULATED'].includes(i.status)).reduce((n, i) => n + BigInt(i.amount), 0n);
  let budget = BigInt(state.policy.totalBudget) - alreadySpent;
  if (budget <= 0n) return '0';
  let selected = 0n, selectedCount = 0n;
  for (const decision of decisions) {
    if (!['PAY_NOW', 'FUND_ARC'].includes(decision.action)) continue;
    const obligation = state.obligations.find(o => o.id === decision.obligationId && !o.paid&&!o.archived);
    if (!obligation) continue;
    const eligibility = planningEligibility(state, obligation, now);
    const amount = BigInt(obligation.amount);
    if (!['ALLOW', 'FUNDING_REQUIRED'].includes(eligibility) || amount > budget) continue;
    selected += amount;
    selectedCount++;
    budget -= amount;
  }
  if (selected === 0n) return '0';
  const target = selected + BigInt(state.policy.reserve) + selectedCount * BigInt(state.policy.gasLimit);
  return (target > BigInt(state.snapshot.balance) ? target - BigInt(state.snapshot.balance) : 0n).toString();
}

export function selectFundingBalances(state: State, now = Date.now()) {
  return verifiedCrosschainBalances(state, now)
    .filter(item => BigInt(item.balance) > 0n)
    .sort((a, b) => {
      const byCapacity = BigInt(b.balance) - BigInt(a.balance);
      return byCapacity === 0n ? a.sourceChain.localeCompare(b.sourceChain) : byCapacity > 0n ? 1 : -1;
    });
}

export function validateBridgeStatus(value: unknown, recipientAddress: string, sourceChain: SourceChain): string {
  const s = z.object({ status: z.string(), cctpVersion: z.number(), sourceDomain: Domain, destinationDomain: Domain, mintRecipient: z.string(), forwardTxHash: Hash.nullish() }).parse(value);
  const recipient = Address.parse(recipientAddress);
  const decoded = s.mintRecipient.toLowerCase().replace(/^0x0{24}/, '0x');
  if (s.status !== 'complete' || s.cctpVersion !== 2 || s.sourceDomain !== SOURCE_CHAINS[sourceChain].domain || s.destinationDomain !== 26 || decoded !== recipient || !s.forwardTxHash) throw new Error('CCTP_STATUS_MISMATCH');
  return s.forwardTxHash;
}

interface Options { enabled: boolean; responseTimeoutMs?: number; decisionEnabled?: () => boolean }
export class CctpBridge {
  executionGuard?: () => boolean;
  private quotes = new Map<string, { fee: string; totalBurn: string; at: number }>();
  constructor(readonly store: Store, readonly sources: Map<SourceChain, EvmSourceReader>, readonly arc: ArcReader, private cli: Cli, private options: Options) {}
  private source(chain: SourceChain) { const reader = this.sources.get(chain); if (!reader) throw new Error('SOURCE_CHAIN_NOT_CONFIGURED'); return reader; }
  private async wallet(address: string, chain: SourceChain) {
    const result = Wallets.parse(await this.cli(['wallet', 'list', '--chain', chain, '--type', 'agent', '--output', 'json']));
    if (!result.data.wallets.some(w => w.type === 'agent' && w.blockchain === chain && w.address === Address.parse(address))) throw new Error('SOURCE_AGENT_WALLET_NOT_FOUND');
  }
  async quote(id: string, amount: string, chain: SourceChain) {
    const result = FeeResponse.parse(await this.cli(['bridge', 'get-fee', 'ARC-TESTNET', '--amount', display(amount), '--chain', chain, '--output', 'json']));
    if (result.data.fromChain !== chain) throw new Error('CCTP_QUOTE_ROUTE_MISMATCH');
    const fast = result.data.fees.find(f => f.finalityThreshold === 1000); if (!fast) throw new Error('CCTP_FAST_QUOTE_MISSING');
    const q = calculateBridgeQuote(amount, fast.minimumFee, String(fast.forwardFee.med));
    this.quotes.set(id, { ...q, at: Date.now() }); return q;
  }
  async fund(receivableId: string, runId?: string): Promise<string | undefined> {
    const requested = this.store.read().crosschainReceivables.find(r => r.id === receivableId && r.receivedHash && !r.bridgeId);
    if (!requested) return;
    return this.fundAvailable(runId, receivableId);
  }
  async fundFromInventory(runId: string): Promise<string | undefined> {
    return this.fundAvailable(runId);
  }
  private async fundAvailable(runId?: string, receivableId?: string): Promise<string | undefined> {
    const before = this.store.read();
    if (!this.options.enabled || !before.bridgePolicy.enabled || this.options.decisionEnabled?.() === false) {
      this.store.change(s => event(s, 'CCTP_AWAITING_AUTHORITY', receivableId ?? 'treasury inventory'));
      return;
    }
    const plannedRun = runId ? before.runs.find(r => r.id === runId && r.status === 'DONE' && r.executionStatus === 'PLANNED') : undefined;
    if (runId && (!plannedRun || plannedRun.financialVersion !== before.financialVersion || plannedRun.policyVersion !== before.policy.version)) throw new Error('FUNDING_PLAN_STALE');
    const amount = plannedRun ? fundingDeficitForDecisions(before, plannedRun.decisions) : fundingDeficit(before);
    if (BigInt(amount) <= 0n) return;
    const modelSources = plannedRun ? [...new Set(plannedRun.decisions.filter(decision => ['PAY_NOW', 'FUND_ARC'].includes(decision.action)).map(decision => decision.fundingSourceChain).filter((chain): chain is SourceChain => !!chain))] : [];
    const chosenChain = plannedRun ? modelSources.length === 1 ? modelSources[0] : undefined : receivableId ? before.crosschainReceivables.find(item => item.id === receivableId)?.sourceChain : undefined;
    if (!chosenChain) {
      this.store.change(s => event(s, 'CCTP_LLM_SOURCE_REQUIRED', `${display(amount)} USDC Arc shortfall`));
      return;
    }
    let selected: { id: string; chain: SourceChain; amount: string; fee: string; totalBurn: string } | undefined;
    for (const candidate of selectFundingBalances(before).filter(item => item.sourceChain === chosenChain)) {
      try {
        await this.wallet(before.policy.sender, candidate.sourceChain);
        const live = await this.source(candidate.sourceChain).snapshot(before.policy.sender);
        let spendable = BigInt(candidate.balance) < BigInt(live.balance) ? BigInt(candidate.balance) : BigInt(live.balance);
        const maxAmount = BigInt(before.bridgePolicy.maxAmount);
        let recipientAmount = BigInt(amount);
        if (recipientAmount > maxAmount) recipientAmount = maxAmount;
        if (recipientAmount > spendable) recipientAmount = spendable;
        for (let attempt = 0; attempt < 4 && recipientAmount > 0n; attempt++) {
          const id = randomUUID();
          const quote = await this.quote(id, recipientAmount.toString(), candidate.sourceChain);
          if (BigInt(quote.fee) > BigInt(before.bridgePolicy.maxFee)) { this.quotes.delete(id); break; }
          if (BigInt(quote.totalBurn) <= spendable) {
            selected = { id, chain: candidate.sourceChain, amount: recipientAmount.toString(), ...quote };
            break;
          }
          this.quotes.delete(id);
          const excess = BigInt(quote.totalBurn) - spendable;
          recipientAmount = excess >= recipientAmount ? 0n : recipientAmount - excess;
        }
      } catch { /* The selected source could not produce a valid live quote. */ }
      if (selected) break;
    }
    if (!selected) {
      this.store.change(s => {
        const balance = s.crosschainBalances.find(item => item.sourceChain === chosenChain);
        if (balance) balance.status = 'UNAVAILABLE';
        event(s, 'CCTP_SOURCE_LIQUIDITY_UNAVAILABLE', `${chosenChain}: ${display(amount)} USDC Arc shortfall`);
      });
      return;
    }
    const { id, chain, amount: transferAmount, fee, totalBurn } = selected;
    const intent = this.store.change(s => {
      const p = s.bridgePolicy;
      const inventory = selectFundingBalances(s).find(item => item.sourceChain === chain);
      if (!inventory || !this.options.enabled || this.options.decisionEnabled?.() === false || !p.enabled || !p.sourceChains.includes(chain)) throw new Error('BRIDGE_AUTHORITY_DISABLED');
      const currentRun = runId ? s.runs.find(run => run.id === runId && run.status === 'DONE' && run.executionStatus === 'PLANNED') : undefined;
      const currentAmount = currentRun ? fundingDeficitForDecisions(s, currentRun.decisions) : fundingDeficit(s);
      if ((runId && (!currentRun || currentRun.financialVersion !== s.financialVersion || currentRun.policyVersion !== s.policy.version)) || currentAmount !== amount || s.intents.some(isPending) || s.bridgeIntents.some(isBridgePending) || BigInt(transferAmount) > BigInt(currentAmount) || BigInt(transferAmount) > BigInt(p.maxAmount) || BigInt(fee) > BigInt(p.maxFee)) throw new Error('BRIDGE_POLICY_CHANGED');
      if (BigInt(inventory.balance) < BigInt(totalBurn)) throw new Error('SOURCE_FUNDS_OR_FEE_INSUFFICIENT');
      const linked = receivableId ? s.crosschainReceivables.find(r => r.id === receivableId && r.receivedHash && !r.bridgeId && r.sourceChain === chain) : undefined;
      const i: BridgeIntent = { id, ...(runId ? { runId } : {}), ...(linked ? { receivableId: linked.id } : {}), sourceChain: chain, destinationChain: 'ARC-TESTNET', sourceWallet: s.policy.sender, recipient: s.policy.sender, amount: transferAmount, fee, totalBurn, feeLimit: p.maxFee, policyVersion: p.version, idempotencyKey: randomUUID(), status: 'PREPARED', createdAt: new Date().toISOString() };
      s.bridgeIntents.push(i); if (linked) linked.bridgeId = i.id; event(s, 'CCTP_INTENT_PREPARED', `${display(transferAmount)} USDC ${SOURCE_CHAINS[chain].label} → Arc Testnet`); return i;
    });
    await this.submit(intent); return intent.id;
  }
  private async submit(intent: BridgeIntent) {
    const quote = this.quotes.get(intent.id);
    this.store.change(s => {
      const i = s.bridgeIntents.find(x => x.id === intent.id)!;
      if (this.options.decisionEnabled?.() === false || this.executionGuard && !this.executionGuard() || !quote || Date.now() - quote.at > 60_000 || i.status !== 'PREPARED' || i.policyVersion !== s.bridgePolicy.version || !s.bridgePolicy.enabled || !this.options.enabled || quote.fee !== i.fee || quote.totalBurn !== i.totalBurn) throw new Error('BRIDGE_QUOTE_OR_AUTHORITY_CHANGED');
      i.status = 'DISPATCHING'; i.dispatchAt = new Date().toISOString(); event(s, 'CCTP_DISPATCHED', i.id);
    });
    this.quotes.delete(intent.id);
    const args = ['bridge', 'transfer', 'ARC-TESTNET', Address.parse(intent.recipient), '--amount', display(intent.amount), '--address', Address.parse(intent.sourceWallet), '--chain', intent.sourceChain, '--idempotency-key', intent.idempotencyKey, '--output', 'json'];
    const request = this.cli(args).then(result => this.persistTransfer(intent.id, result)).catch(() => undefined);
    const timeout = new Promise<undefined>(resolve => setTimeout(resolve, this.options.responseTimeoutMs ?? 240_000));
    const result = await Promise.race([request, timeout]);
    if (!result) {
      this.store.change(s => { const i = s.bridgeIntents.find(x => x.id === intent.id)!; if (i.status === 'DISPATCHING') { i.status = 'EXECUTION_UNKNOWN'; i.error = 'CCTP_RESPONSE_UNKNOWN'; } });
      return;
    }
    await this.reconcile();
  }
  private persistTransfer(id: string, raw: unknown) {
    const response = TransferResponse.parse(raw).data;
    this.store.change(s => {
      const i = s.bridgeIntents.find(x => x.id === id)!;
      if (!isBridgePending(i) || money(response.amount) !== i.amount || i.sourceChain !== response.fromChain || i.destinationChain !== response.toChain) throw new Error('CCTP_TRANSFER_MISMATCH');
      i.burnHash = response.burnTxHash; i.status = 'BURN_OBSERVED';
      if (response.forwardTxHash) i.mintHash = response.forwardTxHash;
      i.error = undefined; event(s, 'CCTP_BURN_OBSERVED', response.burnTxHash);
    });
    return response;
  }
  async recover(intentId: string, burnHash: string) {
    const i = this.store.read().bridgeIntents.find(x => x.id === intentId);
    if (!i || !isBridgePending(i) || i.burnHash) throw new Error('CCTP_RECOVERY_NOT_AVAILABLE');
    await this.source(i.sourceChain).verifyWalletOutflow(Hash.parse(burnHash), i.sourceWallet, i.totalBurn);
    this.store.change(s => { const saved = s.bridgeIntents.find(x => x.id === intentId)!; saved.burnHash = Hash.parse(burnHash); saved.status = 'BURN_OBSERVED'; saved.error = undefined; event(s, 'CCTP_RECOVERY_ATTACHED', burnHash); });
  }
  async reconcile(): Promise<boolean> {
    let settled = false;
    const state = this.store.read();
    for (const copy of state.bridgeIntents.filter(i => isBridgePending(i) && !!i.burnHash)) {
      try {
        const raw=await this.cli(['bridge', 'status', copy.burnHash!, '--chain', copy.sourceChain, '--output', 'json']);
        if(z.object({data:z.object({status:z.string()})}).parse(raw).data.status==='pending')continue;
        const status = StatusResponse.parse(raw).data;
        if (status.status !== 'complete') continue;
        const mintHash = validateBridgeStatus(status, copy.recipient, copy.sourceChain);
        const actualBurn = BigInt(status.amount), recipientAmount = BigInt(copy.amount);
        const actualFee = actualBurn - recipientAmount;
        // CLI get-fee is an estimate; transfer fetches its own forwarding fee.
        // Bind the approved cap durably, never enlarge it from a later policy.
        // Legacy intents can use the policy only while its version still matches.
        const feeLimit = copy.feeLimit ?? (copy.policyVersion === state.bridgePolicy.version ? state.bridgePolicy.maxFee : copy.fee);
        if (actualBurn < recipientAmount || actualFee > BigInt(Units.parse(feeLimit)) || status.burnToken.toLowerCase().replace(/^0x0{24}/, '0x') !== SOURCE_CHAINS[copy.sourceChain].usdc) throw new Error('CCTP_MESSAGE_MISMATCH');
        await Promise.all([this.source(copy.sourceChain).verifyWalletOutflow(copy.burnHash!, copy.sourceWallet, actualBurn.toString()), this.arc.verifyCctpMint(mintHash, copy.recipient, copy.amount)]);
        const snapshot = await this.arc.snapshot(copy.recipient);
        this.store.change(s => {
          const i = s.bridgeIntents.find(x => x.id === copy.id)!; if (!isBridgePending(i)) return;
          i.mintHash = mintHash; i.actualBurn = actualBurn.toString(); i.actualFee = actualFee.toString(); i.status = 'SETTLED'; i.settledAt = new Date().toISOString(); i.arcSnapshot = snapshot; i.error = undefined;
          s.snapshot = snapshot;
          const linked = i.receivableId ? s.crosschainReceivables.find(r => r.id === i.receivableId) : undefined;
          const revenue = linked ? s.revenues.find(r => r.hash?.toLowerCase() === linked.receivedHash?.toLowerCase()) : undefined; if (revenue) revenue.bridged = true;
          event(s, 'CCTP_MINT_VERIFIED', `${i.burnHash} → ${mintHash}`); settled = true;
        });
      } catch {
        this.store.change(s => { const i = s.bridgeIntents.find(x => x.id === copy.id)!; if (isBridgePending(i)) { i.status = 'EXECUTION_UNKNOWN'; i.error = 'CCTP_PROOF_UNVERIFIED'; } });
      }
    }
    return settled;
  }
  recoverPrepared() {
    this.store.change(s => { for (const i of s.bridgeIntents.filter(isBridgePending)) { if (i.status === 'PREPARED') { i.status = 'CANCELLED'; i.error = 'RESTART_BEFORE_BRIDGE_SUBMIT'; } else if (i.status === 'DISPATCHING' && !i.burnHash) { i.status = 'EXECUTION_UNKNOWN'; i.error = 'CCTP_RESPONSE_UNKNOWN'; } } });
  }
}
