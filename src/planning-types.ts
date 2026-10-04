import type { Decision, SourceChain } from './domain.ts';

export interface ReviewObservation {
  fingerprint:string; caseBinding:string; obligationId:string;
  review:NonNullable<Decision['review']>; at:number;
  minimumConfidence?:number;
}
export interface ReviewFeedback {
  attempt:number; maxRevisions:number; planningAt:number;
  issues:{obligationId:string; proposal:Decision; observation:ReviewObservation; review:NonNullable<Decision['review']>}[];
}
export type PlanAction = 'OBSERVE'|'PREVIEW'|'FUND_ARC'|'PAY_NOW'|'WAIT'|'OWNER_REVIEW';
export interface GoalPlan {
  id:string; obligationId:string; obligationVersion:number; policyVersion:number; bridgePolicyVersion:number;
  objective:string; contextKey:string; createdAt:number; updatedAt:number;
  status:'ACTIVE'|'WAITING'|'OWNER_REVIEW'|'RECONCILING'|'COMPLETED'|'SUPERSEDED'; needsReassessment:boolean;
  steps:{action:PlanAction; reason:string; sourceChain:SourceChain|null; status:'PLANNED'|'VERIFIED'|'SIMULATED'|'WAITING'; proofId?:string}[];
  history:{runId:string; action:Decision['action']; reason:string; sourceChain?:SourceChain; review?:Decision['review']; at:number}[];
}
