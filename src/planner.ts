import { DecisionSchema, type State, type Decision, type Planner } from './domain.ts';

export function validateDecisions(input: unknown, state: State): Decision[] {
  const decisions = DecisionSchema.array().max(200).parse(input);
  if (new Set(decisions.map(d => d.obligationId)).size !== decisions.length) throw new Error('DUPLICATE_CANDIDATE');
  if (decisions.length !== state.obligations.filter(o => !o.paid&&!o.archived).length) throw new Error('INCOMPLETE_DECISIONS');
  for (const d of decisions) {
    if (!state.obligations.some(o => o.id === d.obligationId && !o.paid&&!o.archived)) throw new Error('UNKNOWN_CANDIDATE');
    if (d.evidenceIds.some(id => !state.evidence.some(e => e.id === id && e.obligationId === d.obligationId))) throw new Error('UNKNOWN_EVIDENCE');
    if (d.action === 'FUND_ARC' && !d.fundingSourceChain) throw new Error('FUNDING_SOURCE_REQUIRED');
    if (d.fundingSourceChain && (!['PAY_NOW', 'FUND_ARC'].includes(d.action) || !state.bridgePolicy.sourceChains.includes(d.fundingSourceChain))) throw new Error('INVALID_FUNDING_SOURCE');
  }
  return decisions;
}
export class RulesPlanner implements Planner {
  name = 'Rules baseline — no AI model';
  async plan(state: State): Promise<Decision[]> {
    return state.obligations.filter(o => !o.paid&&!o.archived).sort((a,b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id)).map(o => ({
      obligationId: o.id, action: o.accepted && !o.disputed ? 'PAY_NOW' : 'REQUEST_EVIDENCE',
      reason: o.accepted && !o.disputed ? 'Accepted; prioritized by due date. Funds and spending authority are checked before submission.' : 'Authoritative acceptance and dispute resolution are required.',
      evidenceIds: state.evidence.filter(e => e.obligationId === o.id).map(e => e.id),
    }));
  }
}
