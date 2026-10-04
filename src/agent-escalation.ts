export interface AgentPolicyIssue { obligationId: string; reason: string }
export interface AgentUserDecisionRequest {
  obligationId: string; policyReason: string; question: string;
  obligationVersion: number; policyVersion: number; stateVersion: number;
}

export class AgentUserDecisionRequired extends Error {
  readonly request: AgentUserDecisionRequest;
  constructor(request: AgentUserDecisionRequest) {
    super('AGENT_USER_DECISION_REQUIRED');
    this.name = 'AgentUserDecisionRequired';
    this.request = { ...request };
  }
}

export class AgentEscalationError extends Error {
  readonly issues: AgentPolicyIssue[];
  constructor(issues: AgentPolicyIssue[]) {
    super('AGENT_POLICY_ESCALATION');
    this.name = 'AgentEscalationError';
    this.issues = issues.map(issue => ({ obligationId: issue.obligationId, reason: issue.reason }));
  }
}
