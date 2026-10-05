import type { SourceChain } from './domain.ts';
import type { GoalPlan, ReviewObservation } from './planning-types.ts';

export type Network = SourceChain | 'ARC-TESTNET';
export interface SourceRecord {
  sourceId: string; externalId: string; revision: number; hash: string; kind: 'OBLIGATION' | 'RECEIVABLE';
  partyId: string; title: string; amount: string; due: string; acceptance: 'ACCEPTED' | 'DISPUTED' | 'UNKNOWN';
  evidence: string; active: boolean; importedAt: string; retired?:boolean; amendment?: boolean; authoritative?: boolean;
}
export interface Party { id: string; name: string; address: string }
export interface ObservedTransfer {
  id: string; chain: Network; hash: string; logIndex: number; sender: string; recipient: string; amount: string;
  block: string; blockHash: string; status: 'VERIFIED' | 'REORGED'; classification: 'UNMATCHED' | 'CUSTOMER' | 'INTERNAL' | 'MINT';
}
export interface ReceiptAllocation { transferId: string; sourceRecordKey: string; amount: string }
export interface ChainCheckpoint { chain: Network; nextBlock: string; block?: string; blockHash?: string; openingBalance: string }
export interface AgentJob {
  id: string; key: string; cause: string; dueAt: number; status: 'READY' | 'LEASED' | 'DONE' | 'NEEDS_ATTENTION';
  attempts: number; leaseOwner?: string; leaseUntil?: number; fence?: number; runId?: string; error?: string; coalescedInto?:string; evaluationKey?: string;
}
export interface WorkerHealth { name: string; status: 'HEALTHY' | 'DEGRADED' | 'NOT_CONNECTED'; lastAttempt: number; lastSuccess?: number; error?: string; failures: number; retryAt?: number }
export interface ActionRequest {
  id: string; legacyId?: string; kind: 'POLICY' | 'ACCEPTANCE' | 'MATCH' | 'OPERATION'; scope: string;
  title: string; question: string; action: { obligationId?: string; amount?: string; recipient?: string; reason?: string; transferId?:string; sourceRecordKey?:string };
  digest: string; binding: string; policyVersion: number; obligationVersion?: number; expiresAt: number;
  status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED'; createdAt: number;
}
export interface OwnerResponse { id: string; requestId: string; digest: string; kind: 'APPROVE' | 'CANCEL' | 'COMMENT'; comment: string; actor: string; at: number }
export type WaitCondition = 'OBSERVATION_RECOVERY' | 'EXPECTED_RECEIPT' | 'OPERATION_RECONCILIATION';
export interface AgentWait {
  id: string; obligationId: string; condition: WaitCondition; reason: string;
  contextKey: string; attempt: number; createdAt: number; dueAt: number;
}
export interface AutonomyState {
  evaluationFailure?: { key: string; attempts: number; code: string; retryAt?: number; jobId: string };
  enabled: boolean;
  schemaVersion: 1; records: SourceRecord[]; parties: Party[]; transfers: ObservedTransfer[]; allocations: ReceiptAllocation[];
  checkpoints: ChainCheckpoint[]; jobs: AgentJob[]; requests: ActionRequest[]; responses: OwnerResponse[];
  workers: WorkerHealth[]; fence: number; lease?: { owner: string; fence: number; until: number };
  sourceDirectory?: string; sourceAuthority: boolean; observationPaused?: boolean;
  deferredUntil?: Record<string,number>;
  waits?: AgentWait[];
  plans?: GoalPlan[];
  reviews?: ReviewObservation[];
  lastDecisionKey?: string; rejectionBindings: { obligationId: string; binding: string }[];
  lastEvaluationKey?:string;
}
export const emptyAutonomy = (): AutonomyState => ({ enabled:false,schemaVersion: 1, records: [], parties: [], transfers: [], allocations: [], checkpoints: [], jobs: [], requests: [], responses: [], workers: [], fence: 0, sourceAuthority: false, rejectionBindings: [] });
