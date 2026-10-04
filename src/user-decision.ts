import { randomUUID } from 'node:crypto';
import { OVERRIDABLE_POLICY_REASONS, type OverridablePolicyReason } from './domain.ts';
import { planningEligibility } from './policy.ts';
import { Store, event } from './store.ts';

export function resolveAgentUserDecision(store: Store, notificationId: string, decision: 'APPROVE_ONCE' | 'KEEP_POLICY', response: string) {
  return store.change(state => {
    const notification = state.agentNotifications.find(item => item.id === notificationId && item.type === 'USER_DECISION_REQUIRED');
    if (!notification || notification.status !== 'OPEN' || notification.issues.length !== 1) throw new Error('USER_DECISION_REQUEST_NOT_OPEN');
    const issue = notification.issues[0];
    if (!OVERRIDABLE_POLICY_REASONS.includes(issue.reason as OverridablePolicyReason)) throw new Error('POLICY_OVERRIDE_NOT_ALLOWED');
    const obligation = state.obligations.find(item => item.id === issue.obligationId && !item.paid);
    if (!obligation || obligation.version !== notification.obligationVersion || state.policy.version !== notification.policyVersion || state.financialVersion !== notification.stateVersion) throw new Error('USER_DECISION_REQUEST_STALE');
    if (planningEligibility(state, obligation) !== issue.reason) throw new Error('POLICY_CONFLICT_CHANGED');
    if (decision === 'APPROVE_ONCE') {
      state.approvals.push({
        id: randomUUID(), obligationId: obligation.id, obligationVersion: obligation.version,
        policyVersion: state.policy.version, stateVersion: state.financialVersion,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), actor: 'owner', reason: issue.reason as OverridablePolicyReason,
      });
    }
    notification.status = 'RESOLVED'; notification.resolution = decision; notification.response = response;
    notification.resolvedAt = new Date().toISOString();
    event(state, 'OWNER_POLICY_DECISION', `${obligation.id}: ${issue.reason} → ${decision}`);
    return { obligationId: obligation.id, reason: issue.reason, decision };
  });
}
