import { z } from 'zod';
import type { AutonomyState } from './autonomy-types.ts';
import type { ReviewFeedback, ReviewObservation } from './planning-types.ts';
import type { DecisionRecord } from './decision-record.ts';

export const CHAIN_ID = 5042002;
export const USDC = '0x3600000000000000000000000000000000000000' as const;
export const SOURCE_CHAIN_NAMES = ['ETH-SEPOLIA', 'AVAX-FUJI', 'OP-SEPOLIA', 'ARB-SEPOLIA', 'BASE-SEPOLIA', 'MATIC-AMOY', 'UNI-SEPOLIA'] as const;
export type SourceChain = typeof SOURCE_CHAIN_NAMES[number];
export const OVERRIDABLE_POLICY_REASONS = ['NEEDS_APPROVAL', 'BUDGET_EXCEEDED', 'OUTSIDE_PLANNING_WINDOW', 'RESERVE_CONFLICT'] as const;
export type OverridablePolicyReason = typeof OVERRIDABLE_POLICY_REASONS[number];
export const SOURCE_CHAINS: Record<SourceChain, { chainId: number; domain: number; usdc: `0x${string}`; rpc: string; label: string; explorer: string }> = {
  'ETH-SEPOLIA': { chainId: 11155111, domain: 0, usdc: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', label: 'Ethereum Sepolia', explorer: 'https://sepolia.etherscan.io/tx/' },
  'AVAX-FUJI': { chainId: 43113, domain: 1, usdc: '0x5425890298aed601595a70ab815c96711a31bc65', rpc: 'https://api.avax-test.network/ext/bc/C/rpc', label: 'Avalanche Fuji', explorer: 'https://subnets-test.avax.network/c-chain/tx/' },
  'OP-SEPOLIA': { chainId: 11155420, domain: 2, usdc: '0x5fd84259d66cd46123540766be93dfe6d43130d7', rpc: 'https://sepolia.optimism.io', label: 'Optimism Sepolia', explorer: 'https://sepolia-optimism.etherscan.io/tx/' },
  'ARB-SEPOLIA': { chainId: 421614, domain: 3, usdc: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', label: 'Arbitrum Sepolia', explorer: 'https://sepolia.arbiscan.io/tx/' },
  'BASE-SEPOLIA': { chainId: 84532, domain: 6, usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', rpc: 'https://sepolia.base.org', label: 'Base Sepolia', explorer: 'https://sepolia.basescan.org/tx/' },
  'MATIC-AMOY': { chainId: 80002, domain: 7, usdc: '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582', rpc: 'https://polygon-amoy-bor-rpc.publicnode.com', label: 'Polygon Amoy', explorer: 'https://amoy.polygonscan.com/tx/' },
  'UNI-SEPOLIA': { chainId: 1301, domain: 10, usdc: '0x31d0220469e10c4e71834a79b1f276d740d3768f', rpc: 'https://sepolia.unichain.org', label: 'Unichain Sepolia', explorer: 'https://unichain-sepolia.blockscout.com/tx/' },
};
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s.toLowerCase()).refine(s => s !== `0x${'0'.repeat(40)}`);
export const Units = z.string().regex(/^(0|[1-9]\d{0,29})$/);
export function money(value: string): string {
  if (!/^(0|[1-9]\d{0,23})(\.\d{1,6})?$/.test(value)) throw new Error('INVALID_AMOUNT');
  const [whole, part = ''] = value.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(part.padEnd(6, '0'))).toString();
}
export function display(units: string): string {
  const amount = BigInt(units);
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, '0')}`;
}
export interface Evidence { id: string; obligationId: string; text: string; author: string; createdAt: string }
export interface EvidenceRequest {
  id: string; runId: string; obligationId: string; obligationVersion: number;
  requestedFrom: 'PROJECT_OWNER'; question: string;
  status: 'OPEN' | 'RESOLVED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string; expiresAt: string; resolvedAt?: string;
  resolution?: 'ACCEPTED' | 'DISPUTED'; response?: string;
}
export interface Obligation {
  archived?:boolean;
  id: string; title: string; contractor: string; recipient: string; amount: string;
  due: string; accepted: boolean; disputed: boolean; paid: boolean; version: number;
}
export interface Policy {
  version: number; chainId: number; sender: string; allowlist: string[];
  reserve: string; gasLimit: string; perObligation: string; totalBudget: string;
  authorityExpiresAt: string; enabled: boolean;
}
export interface BridgePolicy {
  version: number; enabled: boolean; sourceChains: SourceChain[]; maxAmount: string; maxFee: string;
}
export interface Snapshot { balance: string; chainId: number; block: string; observedAt: string }
export const DecisionSchema = z.object({
  obligationId: z.string().min(1).max(80),
  action: z.enum(['PAY_NOW', 'FUND_ARC', 'HOLD', 'REQUEST_EVIDENCE']),
  reason: z.string().min(1).max(1200), evidenceIds: z.array(z.string()).max(30),
  fundingSourceChain: z.enum(SOURCE_CHAIN_NAMES).optional(),
  review: z.object({
    provider: z.literal('Jev'), model: z.string().min(1).max(120),
    verdict: z.enum(['ALLOW', 'REVIEW', 'BLOCK']), confidence: z.number().min(0).max(1),
  }).strict().optional(),
}).strict();
export type Decision = z.infer<typeof DecisionSchema>;
export interface Run {
  decisionRecord?: DecisionRecord;
  decisionRecordSummary?: { sha256: string; capturedAt: string };
  id: string; createdAt: string; source: string; status: 'RUNNING' | 'DONE' | 'ERROR' | 'AWAITING_USER'; decisions: Decision[];
  error?: string; snapshot?: Snapshot; policyVersion?: number; financialVersion?: number;
  executionStatus?: 'PLANNED' | 'EXECUTING' | 'EXECUTED' | 'INVALIDATED';
}
export interface Intent {
  id: string; runId: string; obligationId: string; amount: string; recipient: string; sender: string;
  chainId: number; policyVersion: number; obligationVersion: number; idempotencyKey: string;
  status: 'PREPARED' | 'SUBMITTING' | 'PROVIDER_ACCEPTED' | 'HASH_OBSERVED' | 'EXECUTION_UNKNOWN' | 'SETTLED' | 'SIMULATED' | 'CANCELLED';
  createdAt: string; providerId?: string; hash?: string; error?: string; settledAt?: string; snapshot?: Snapshot;
  agentDispatchAt?: string;
  submissionStateVersion?: number;
}
export interface Approval { id: string; obligationId: string; obligationVersion: number; policyVersion: number; stateVersion: number; expiresAt: string; actor: string; reason?: OverridablePolicyReason }
export interface Revenue { id: string; hash?: string; source: string; amount: string; invoice: string; createdAt: string; simulated: boolean; sourceChain?: SourceChain | 'ARC-TESTNET'; bridged?: boolean }
export interface Receivable { id: string; source: string; amount: string; invoice: string; cursor: string; createdAt: string; receivedHash?: string }
export interface CrosschainReceivable { id: string; sourceChain: SourceChain; source: string; amount: string; invoice: string; cursor: string; createdAt: string; receivedHash?: string; bridgeId?: string }
export interface CrosschainBalance {
  sourceChain: SourceChain; balance: string; chainId: number; block: string; observedAt: string;
  status: 'VERIFIED' | 'UNAVAILABLE';
  fundingEnabled?: boolean;
}
export interface AgentMemoryEntry { id: string; kind: 'FACT' | 'LESSON'; content: string; createdAt: string; updatedAt: string }
export interface AgentToolCall { id: string; runId: string; name: string; status: 'SUCCESS' | 'ERROR'; detail: string; at: string }
export interface AgentNotification {
  id: string; runId: string; type: 'POLICY_ESCALATION' | 'USER_DECISION_REQUIRED'; status: 'OPEN' | 'RESOLVED';
  title: string; message: string; issues: { obligationId: string; reason: string }[];
  createdAt: string; resolvedAt?: string; question?: string;
  obligationVersion?: number; policyVersion?: number; stateVersion?: number;
  resolution?: 'APPROVE_ONCE' | 'KEEP_POLICY'; response?: string;
}
export type TelegramSeverity = 'NORMAL' | 'MEDIUM' | 'HIGH';
export type TelegramNotificationKind = 'REVENUE_VERIFIED' | 'BRIDGE_SETTLED' | 'PAYMENT_SETTLED' | 'OWNER_ACTION_REQUIRED' | 'OPERATION_UNCERTAIN' | 'AUDIT_STARTED' | 'AUDIT_COMPLETED' | 'AUDIT_ATTENTION';
export interface TelegramDelivery {
  id: string; fingerprint: string; kind: TelegramNotificationKind; subjectId: string;
  severity: TelegramSeverity; status: 'ACTIVE' | 'RESOLVED' | 'DELIVERED'; repeat: boolean;
  createdAt: string; deadlineAt?: string; lastSentAt?: string; lastSentSeverity?: TelegramSeverity;
  sendCount: number; failureCount: number; nextAttemptAt?: string; telegramMessageId?: string;
}
export interface FundingEvaluation { receivableId: string; runId: string; attempt: number; at: string; financialVersion: number; result: 'PLANNING_FAILED' | 'NO_BRIDGE_REQUIRED' | 'BRIDGE_CREATED' }
export interface BridgeIntent {
  id: string; runId?: string; receivableId?: string; sourceChain: SourceChain; destinationChain: 'ARC-TESTNET'; sourceWallet: string; recipient: string;
  amount: string; fee: string; totalBurn: string; policyVersion: number; idempotencyKey: string;
  status: 'PREPARED' | 'DISPATCHING' | 'BURN_OBSERVED' | 'MINT_OBSERVED' | 'EXECUTION_UNKNOWN' | 'SETTLED' | 'CANCELLED';
  createdAt: string; dispatchAt?: string; burnHash?: string; mintHash?: string; error?: string; settledAt?: string; arcSnapshot?: Snapshot;
  actualFee?: string; actualBurn?: string; feeLimit?: string;
}
export interface Event { id: string; at: string; type: string; detail: string }
export interface State {
  autonomy?: AutonomyState;
  version: number; financialVersion: number; mode: 'simulation' | 'testnet'; paused: boolean; policy: Policy;
  snapshot: Snapshot; obligations: Obligation[]; evidence: Evidence[]; intents: Intent[];
  runs: Run[]; approvals: Approval[]; revenues: Revenue[]; receivables: Receivable[]; events: Event[];
  bridgePolicy: BridgePolicy; crosschainBalances: CrosschainBalance[]; crosschainReceivables: CrosschainReceivable[]; bridgeIntents: BridgeIntent[];
  evidenceRequests: EvidenceRequest[]; fundingEvaluations: FundingEvaluation[]; agentMemory: AgentMemoryEntry[]; agentToolCalls: AgentToolCall[]; agentNotifications: AgentNotification[];
  telegramDeliveries: TelegramDelivery[]; telegramNotificationsStartedAt?: string;
}
export const isPending = (i: Intent) => !['SETTLED', 'SIMULATED', 'CANCELLED'].includes(i.status);
export const isBridgePending = (i: BridgeIntent) => !['SETTLED', 'CANCELLED'].includes(i.status);
export interface PaymentGateway {
  mode: State['mode'];
  snapshot(): Promise<Snapshot>;
  estimate(intent: Intent): Promise<string>;
  submit(intent: Intent): Promise<{ providerId: string }>;
  reconcile(intent: Intent): Promise<{ status: 'pending' | 'confirmed' | 'simulated'; providerId?: string; hash?: string }>;
  recover?(intent: Intent, providerId: string): Promise<void>;
}
export interface Planner {
  name: string; plan(state: State, runId?: string): Promise<Decision[]>;
  reconsider?(state:State,feedback:ReviewFeedback,runId?:string):Promise<Decision[]>;
  lookupReview?(fingerprint:string,caseBinding:string):ReviewObservation|undefined;
  recordReview?(observation:ReviewObservation):void;
}
export function fixture(): State {
  const now = new Date().toISOString();
  return {
    version: 0, financialVersion: 0, mode: 'simulation', paused: false,
    policy: { version: 1, chainId: CHAIN_ID, sender: `0x${'1'.repeat(40)}`, allowlist: [`0x${'2'.repeat(40)}`, `0x${'3'.repeat(40)}`, `0x${'4'.repeat(40)}`], reserve: money('5'), gasLimit: money('1'), perObligation: money('10'), totalBudget: money('20'), enabled: true, authorityExpiresAt: new Date(Date.now() + 86400000).toISOString() },
    snapshot: { balance: money('6'), chainId: CHAIN_ID, block: 'simulation:0', observedAt: now },
    obligations: [
      { id: 'A', title: 'Landing page design', contractor: 'North Studio', recipient: `0x${'2'.repeat(40)}`, amount: money('4'), due: now, accepted: true, disputed: false, paid: false, version: 1 },
      { id: 'B', title: 'Next month content package', contractor: 'Frame Content', recipient: `0x${'3'.repeat(40)}`, amount: money('7'), due: new Date(Date.now() + 86400000 * 3).toISOString(), accepted: true, disputed: false, paid: false, version: 1 },
      { id: 'C', title: 'Video revisions', contractor: 'Orbit Motion', recipient: `0x${'4'.repeat(40)}`, amount: money('2'), due: now, accepted: false, disputed: true, paid: false, version: 1 },
    ],
    evidence: [
      { id: 'e-a', obligationId: 'A', text: 'The project owner accepted the final delivery.', author: 'Project owner (sample)', createdAt: now },
      { id: 'e-c', obligationId: 'C', text: 'The contractor reports completion, but the project owner requested changes to the ending. A new acceptance confirmation is needed.', author: 'Updates inbox (sample)', createdAt: now },
    ], intents: [], runs: [], approvals: [], revenues: [], receivables: [], events: [], evidenceRequests: [],
    bridgePolicy: { version: 1, enabled: false, sourceChains: [...SOURCE_CHAIN_NAMES], maxAmount: money('25'), maxFee: money('1') },
    crosschainBalances: [], crosschainReceivables: [], bridgeIntents: [], fundingEvaluations: [], agentMemory: [], agentToolCalls: [], agentNotifications: [], telegramDeliveries: [],
  };
}
