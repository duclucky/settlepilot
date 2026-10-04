import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DecisionSchema, type Decision, type State, type Run } from './domain.ts';
import { analyzeLiquidity } from './liquidity-analysis.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function integrityDigest(value: unknown) {
  return createHash('sha256').update(canonical(JSON.parse(JSON.stringify(value)))).digest('hex');
}

/** Captures financial facts and document digests, not raw prompts or internal reasoning. */
export function createDecisionRecord(state: State, runId: string, planner: string, decisions: Decision[], now = Date.now()) {
  const obligations = state.obligations.filter(o => !o.paid && !o.archived);
  const ids = new Set(obligations.map(o => o.id));
  const payload = structuredClone({
    format: 'settlepilot-decision-v1' as const, runId, capturedAt: new Date(now).toISOString(), mode: state.mode, planner,
    context: {
      financialVersion: state.financialVersion, paused: state.paused, policy: state.policy, bridgePolicy: state.bridgePolicy,
      snapshot: state.snapshot, sourceBalances: state.crosschainBalances, obligations,
      approvals: state.approvals,
      evidenceDigests: state.evidence.filter(e => ids.has(e.obligationId)).map(e => ({id: e.id, obligationId: e.obligationId, sha256: integrityDigest(e)})),
      sourceDigests: (state.autonomy?.records ?? []).filter(r => ids.has(`${r.sourceId}-${r.externalId}`))
        .map(r => ({sourceId: r.sourceId, externalId: r.externalId, revision: r.revision, hash: r.hash, authoritative: r.authoritative === true, active: r.active, amendment: r.amendment === true})),
      pendingPaymentIds: state.intents.filter(i => !['SETTLED','SIMULATED','CANCELLED'].includes(i.status)).map(i => i.id),
      pendingBridgeIds: state.bridgeIntents.filter(i => !['SETTLED','CANCELLED'].includes(i.status)).map(i => i.id),
    },
    analysis: analyzeLiquidity(state, now), decisions,
  });
  return { payload, sha256: integrityDigest(payload) };
}
export type DecisionRecord = ReturnType<typeof createDecisionRecord>;

/** Polling the panel must not retransmit a full historical portfolio for every run. */
export function summarizeDecisionRun({decisionRecord,...run}:Run) {
  return {...run,...(decisionRecord?{decisionRecordSummary:{sha256:decisionRecord.sha256,capturedAt:decisionRecord.payload.capturedAt}}:{})};
}

const RecordSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.object({
    format: z.literal('settlepilot-decision-v1'), runId: z.string().min(1), capturedAt: z.iso.datetime(),
    mode: z.enum(['simulation','testnet']), planner: z.string(), context: z.record(z.string(), z.unknown()),
    analysis: z.record(z.string(), z.unknown()), decisions: DecisionSchema.array(),
  }).strict(),
}).strict();

/** Integrity only: an editor can recompute a hash. This is not a signature or chain proof. */
export function verifyDecisionRecord(raw: unknown): boolean {
  const result = RecordSchema.safeParse(raw);
  return result.success && integrityDigest(result.data.payload) === result.data.sha256;
}

export function exportDecisionRecord(state: State, runId: string) {
  const run = state.runs.find(r => r.id === runId);
  if (!run?.decisionRecord) throw new Error('DECISION_RECORD_UNAVAILABLE');
  return {
    label: 'PRIVATE_LOCAL_DECISION_RECORD', integrityOnly: true, settlementIndependentlyVerifiedByExport: false,
    record: structuredClone(run.decisionRecord),
    execution: {status: run.executionStatus, runStatus: run.status,
      payments: state.intents.filter(i => i.runId === runId).map(i => ({id: i.id, obligationId: i.obligationId, status: i.status, amount: i.amount, chainId: i.chainId, sender: i.sender, recipient: i.recipient, hash: i.hash})),
      bridges: state.bridgeIntents.filter(i => i.runId === runId).map(i => ({id: i.id, sourceChain: i.sourceChain, amount: i.amount, status: i.status, burnHash: i.burnHash, mintHash: i.mintHash})),
    },
  };
}
