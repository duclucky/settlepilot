import { randomUUID } from 'node:crypto';
import { isPending, type Intent, type PaymentGateway, type Planner } from './domain.ts';
import { Store, event } from './store.ts';
import { actionBinding } from './action-binding.ts';
import { evaluate } from './policy.ts';
import { validateDecisions } from './planner.ts';
import { AgentEscalationError, AgentUserDecisionRequired } from './agent-escalation.ts';
import { recordPlanDecisions, refreshGoalPlans } from './goal-plans.ts';
import { createDecisionRecord } from './decision-record.ts';
import { modelFailureCodes } from './model-requests.ts';
import { evaluationKey } from './evaluation-control.ts';

export class Engine {
  executionGuard?: () => boolean;
  constructor(readonly store: Store, readonly gateway: PaymentGateway, public planner: Planner, readonly executionEnabled = true, private clock=()=>Date.now()) {}

  setPlanner(planner: Planner) {
    if (this.store.read().runs.some(run => run.status === 'RUNNING')) throw new Error('AGENT_RUN_IN_PROGRESS');
    if (planner.financialEnabled === false) this.store.change(s => {
      for (const run of s.runs.filter(r => r.executionStatus === 'PLANNED')) run.executionStatus = 'INVALIDATED';
    });
    this.planner = planner;
  }

  private start(executionStatus: 'PLANNED' | 'EXECUTING'): string {
    const id = randomUUID();
    this.store.change(s => {
      s.runs.push({ id, createdAt: new Date().toISOString(), source: this.planner.name, status: 'RUNNING', decisions: [], executionStatus });
      event(s, 'RUN_STARTED', id);
    });
    return id;
  }

  private async decide(id: string) {
    if (this.gateway.mode !== this.store.read().mode) throw new Error('MODE_MISMATCH');
    const snapshot = await this.gateway.snapshot();
    this.store.change(s => { s.snapshot = snapshot; });
    const context = this.store.read();
    const planningAt=this.clock();
    this.store.change(s => {
      const run = s.runs.find(r => r.id === id)!;
      run.snapshot = structuredClone(context.snapshot); run.policyVersion = context.policy.version; run.financialVersion = context.financialVersion;
      run.evaluationKey=evaluationKey(context,planningAt);
    });
    const decisions = validateDecisions(await this.planner.plan(structuredClone(context), id), context);
    // Persist the captured financial context with the final reviewed choices before any executor runs.
    const decisionRecord=createDecisionRecord(context,id,this.planner.name,decisions,planningAt);
    this.store.change(s => { const run=s.runs.find(r => r.id === id)!;run.decisions = decisions;run.decisionRecord=decisionRecord;recordPlanDecisions(s,decisions,id); });
    return { context, decisions };
  }

  private fail(id: string, error?: unknown) {
    // Raw provider/model errors may contain credentials or request bodies. Never persist them.
    this.store.change(s => {
      const run = s.runs.find(r => r.id === id)!;
      const userDecision = error instanceof AgentUserDecisionRequired;
      if(!userDecision&&!(error instanceof AgentEscalationError)){
        const codes=new Set([...modelFailureCodes,'MODEL_REQUEST_FAILED','JEV_REQUEST_FAILED','INVALID_TOOL_SEQUENCE','MODEL_TOOL_LIMIT','CIRCLE_AGENT_REQUEST_FAILED','MODE_MISMATCH','INVALID_JEV_RESPONSE']);
        const code=error instanceof Error&&codes.has(error.message)?error.message:'UNCLASSIFIED_RUN_FAILURE';
        run.failureCode=code;
        event(s,'RUN_FAILURE_CODE',`${id}: ${code}`);
      }
      run.status = userDecision ? 'AWAITING_USER' : 'ERROR'; run.executionStatus = 'INVALIDATED'; run.error = error instanceof AgentEscalationError || userDecision ? 'AGENT_NEEDS_USER_DECISION' : 'RUN_FAILED_CHECK_CONFIGURATION_OR_INPUT'; event(s, userDecision ? 'AGENT_USER_DECISION_REQUESTED' : 'RUN_FAILED', id);
      if (userDecision && !s.agentNotifications.some(notification => notification.runId === id && notification.type === 'USER_DECISION_REQUIRED')) {
        const request = error.request;
        s.agentNotifications.push({
          id: randomUUID(), runId: id, type: 'USER_DECISION_REQUIRED', status: 'OPEN',
          title: 'Agent is asking for your decision',
          message: request.policyReason==='OWNER_INSTRUCTION_REQUIRED'?'The Agent needs your instructions before it can proceed.':'The Agent found an operating-policy conflict it cannot resolve autonomously.',
          issues: [{ obligationId: request.obligationId, reason: request.policyReason }], question: request.question,
          obligationVersion: request.obligationVersion, policyVersion: request.policyVersion, stateVersion: request.stateVersion,
          createdAt: new Date().toISOString(),
        });
        event(s, 'AGENT_USER_ACTION_REQUIRED', id);
      }
      if (error instanceof AgentEscalationError && !s.agentNotifications.some(notification => notification.runId === id && notification.type === 'POLICY_ESCALATION')) {
        const issues = error.issues.filter(issue => s.obligations.some(obligation => obligation.id === issue.obligationId)).slice(0, 200);
        if (issues.length) {
          s.agentNotifications.push({
            id: randomUUID(), runId: id, type: 'POLICY_ESCALATION', status: 'OPEN',
            title: 'Agent needs your decision',
            message: 'The Agent could not find a policy-compliant alternative. Review the affected obligation or policy before trying again.',
            issues, createdAt: new Date().toISOString(),
          });
          event(s, 'AGENT_USER_ACTION_REQUIRED', id);
        }
      }
    });
  }

  private finish(id: string, executionStatus: 'PLANNED' | 'EXECUTED') {
    this.store.change(s => {
      const now = this.clock();
      for (const request of s.evidenceRequests.filter(r => r.status === 'OPEN')) {
        const obligation = s.obligations.find(o => o.id === request.obligationId);
        if (Date.parse(request.expiresAt) <= now) { request.status = 'EXPIRED'; event(s, 'EVIDENCE_REQUEST_EXPIRED', request.id); }
        else if (!obligation || obligation.version !== request.obligationVersion || obligation.paid) { request.status = 'CANCELLED'; event(s, 'EVIDENCE_REQUEST_CANCELLED', request.id); }
      }
      const run = s.runs.find(r => r.id === id)!;
      for (const decision of run.decisions.filter(d => d.action === 'REQUEST_EVIDENCE')) {
        const obligation = s.obligations.find(o => o.id === decision.obligationId && !o.paid&&!o.archived);
        if(obligation&&s.autonomy?.rejectionBindings.some(d=>d.obligationId===obligation.id&&d.binding===actionBinding(s,obligation.id)))continue;
        if (!obligation || s.evidenceRequests.some(r => r.status === 'OPEN' && r.obligationId === obligation.id && r.obligationVersion === obligation.version)) continue;
        const createdAt = new Date();
        const question = obligation.disputed
          ? `Resolve the dispute for “${obligation.title}” and confirm whether the final delivery is accepted.`
          : !obligation.accepted
            ? `Confirm whether the final delivery for “${obligation.title}” is accepted and whether any dispute remains.`
            : decision.reason;
        s.evidenceRequests.push({
          id: randomUUID(), runId: id, obligationId: obligation.id, obligationVersion: obligation.version,
          requestedFrom: 'PROJECT_OWNER', question, status: 'OPEN',
          createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        });
        event(s, 'EVIDENCE_REQUEST_CREATED', obligation.id);
      }
      for (const notification of s.agentNotifications.filter(item => item.status === 'OPEN' && item.type === 'POLICY_ESCALATION')) {
        const resolved = notification.issues.every(issue => {
          const obligation = s.obligations.find(item => item.id === issue.obligationId);
          return !obligation || obligation.paid || run.decisions.some(decision => decision.obligationId === issue.obligationId);
        });
        if (resolved) { notification.status = 'RESOLVED'; notification.resolvedAt = new Date().toISOString(); event(s, 'AGENT_NOTIFICATION_RESOLVED', notification.id); }
      }
      run.status = 'DONE'; run.executionStatus = executionStatus;
      refreshGoalPlans(s);
    });
  }

  async plan(): Promise<string> {
    const id = this.start('PLANNED');
    try {
      await this.decide(id);
      this.finish(id, 'PLANNED');
    } catch (error) { this.fail(id, error); }
    return id;
  }

  async executePlanned(id: string): Promise<void> {
    const context = this.store.change(s => {
      const run = s.runs.find(r => r.id === id);
      if (!run || run.status !== 'DONE' || run.executionStatus !== 'PLANNED') throw new Error('PLAN_NOT_EXECUTABLE');
      if (run.financialVersion !== s.financialVersion || run.policyVersion !== s.policy.version) { run.executionStatus = 'INVALIDATED'; return undefined; }
      run.executionStatus = 'EXECUTING';
      return structuredClone(s);
    });
    if (!context) throw new Error('FUNDING_PLAN_STALE');
    try {
      const decisions = this.store.read().runs.find(r => r.id === id)!.decisions;
      await this.executeDecisions(id, context, decisions);
      this.finish(id, 'EXECUTED');
    } catch (error) { this.fail(id, error); }
  }

  async run(): Promise<string> {
    const id = this.start('EXECUTING');
    try {
      const { context, decisions } = await this.decide(id);
      await this.executeDecisions(id, context, decisions);
      this.finish(id, 'EXECUTED');
    } catch (error) { this.fail(id, error); }
    return id;
  }

  private async executeDecisions(id: string, context: ReturnType<Store['read']>, decisions: ReturnType<typeof validateDecisions>) {
    for (const decision of decisions) {
        if (decision.action !== 'PAY_NOW') continue;
        const fresh = await this.gateway.snapshot();
        this.store.change(s => { s.snapshot = fresh; });
        const intent = this.store.change(s => {
          const obligation = s.obligations.find(o => o.id === decision.obligationId)!;
          const original = context.obligations.find(o => o.id === obligation.id)!;
          const evidenceChanged = JSON.stringify(s.evidence) !== JSON.stringify(context.evidence);
          const result = !this.executionEnabled || this.planner.financialEnabled === false ? 'EXECUTION_DISABLED' : obligation.version !== original.version || evidenceChanged ? 'STALE_DECISION' : evaluate(s, obligation,this.clock());
          if (result !== 'ALLOW') {
            event(s, 'POLICY_HOLD', `${obligation.id}: ${result}`); return undefined;
          }
          const intent: Intent = {
            id: randomUUID(), runId: id, obligationId: obligation.id, amount: obligation.amount,
            recipient: obligation.recipient, sender: s.policy.sender, chainId: s.policy.chainId,
            policyVersion: s.policy.version, obligationVersion: obligation.version, idempotencyKey: randomUUID(),
            status: 'PREPARED', createdAt: new Date().toISOString(), snapshot: structuredClone(s.snapshot),
          };
          s.intents.push(intent); event(s, 'INTENT_PREPARED', intent.id); return intent;
        });
        if (!intent) continue;
        try {
          const fee = await this.gateway.estimate(intent);
          const latest = await this.gateway.snapshot();
          this.store.change(s => { s.snapshot = latest; });
          const claimed = this.store.change(s => {
            const i = s.intents.find(i => i.id === intent.id)!;
            if (i.status !== 'PREPARED') return false;
            const o = s.obligations.find(o => o.id === intent.obligationId)!;
            const checkState = { ...s, intents: s.intents.filter(other => other.id !== i.id) };
            const check = evaluate(checkState, o,this.clock());
            if (this.planner.financialEnabled === false || this.executionGuard && !this.executionGuard() || check !== 'ALLOW' || BigInt(fee) > BigInt(s.policy.gasLimit) || BigInt(fee) < 0n || o.version !== i.obligationVersion || s.policy.version !== i.policyVersion || o.recipient !== i.recipient || o.amount !== i.amount || s.policy.sender !== i.sender || JSON.stringify(s.evidence) !== JSON.stringify(context.evidence)) {
              i.status = 'CANCELLED'; i.error = check !== 'ALLOW' ? check : 'STATE_OR_FEE_CHANGED';
              event(s, 'INTENT_CANCELLED', `${i.id}: ${i.error}`); return false;
            }
            i.status = 'SUBMITTING'; i.submissionStateVersion = s.financialVersion;
            event(s, 'SUBMITTING', i.id); return true;
          });
          if (!claimed) continue;
          // No automatic resend after this durable boundary, even if response is lost.
          const accepted = await this.gateway.submit(intent);
          this.store.change(s => { const i = s.intents.find(i => i.id === intent.id)!; if (isPending(i)) { i.providerId = accepted.providerId; i.status = 'PROVIDER_ACCEPTED'; event(s, 'PROVIDER_ACCEPTED', i.id); } });
          await this.reconcile();
        } catch {
          this.store.change(s => {
            const i = s.intents.find(i => i.id === intent.id)!;
            if (i.status === 'PREPARED') i.status = 'CANCELLED';
            else if (isPending(i)) i.status = 'EXECUTION_UNKNOWN';
            i.error = 'EXECUTION_REQUIRES_RECONCILIATION'; event(s, i.status, i.id);
          });
        }
    }
  }
  async reconcile(): Promise<void> {
    for (const intent of this.store.read().intents.filter(isPending)) {
      // PREPARED was never submitted. Recovery cancels it; the old worker's CAS then fails.
      if (intent.status === 'PREPARED') continue;
      try {
        const result = await this.gateway.reconcile(intent);
        if (result.status === 'confirmed' && (this.gateway.mode !== 'testnet' || !result.hash)) throw new Error('MISSING_PROOF');
        if (result.status === 'simulated' && this.gateway.mode !== 'simulation') throw new Error('MODE_MISMATCH');
        const snapshot = result.status === 'confirmed' ? await this.gateway.snapshot() : undefined;
        this.store.change(s => {
          const i = s.intents.find(i => i.id === intent.id)!;
          if (!isPending(i)) return;
          if (result.providerId) i.providerId = result.providerId;
          if (result.hash) { i.hash = result.hash; i.status = 'HASH_OBSERVED'; }
          if (result.status === 'pending') return;
          i.status = result.status === 'confirmed' ? 'SETTLED' : 'SIMULATED';
          i.settledAt = new Date().toISOString(); i.error = undefined;
          const obligation = s.obligations.find(o => o.id === i.obligationId)!;
          obligation.paid = true; obligation.version++;
          if (snapshot) s.snapshot = snapshot;
          else { s.snapshot.balance = (BigInt(s.snapshot.balance) - BigInt(i.amount)).toString(); s.snapshot.observedAt = new Date().toISOString(); }
          event(s, i.status, `${i.obligationId}: ${i.id}`);
          refreshGoalPlans(s);
        });
      } catch {
        this.store.change(s => { const i = s.intents.find(i => i.id === intent.id)!; if (isPending(i)) { i.status = 'EXECUTION_UNKNOWN'; i.error = 'RECEIPT_OR_PROVIDER_UNVERIFIED'; } });
      }
    }
  }
  recoverPrepared() {
    this.store.change(s => {
      for (const i of s.intents.filter(i => i.status === 'PREPARED')) { i.status = 'CANCELLED'; i.error = 'RESTART_BEFORE_SUBMIT'; }
      for (const run of s.runs.filter(r => r.status === 'RUNNING')) { run.status = 'ERROR'; run.error = 'PROCESS_RESTARTED'; }
    });
  }
}
