import { createHash } from 'node:crypto';
import type { State, Decision } from './domain.ts';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reviewCaseBinding(s:State,obligationId:string) {
  return hash([s.policy,s.bridgePolicy,s.obligations.find(o=>o.id===obligationId),s.evidence.filter(e=>e.obligationId===obligationId).sort((a,b)=>a.id.localeCompare(b.id))]);
}
export function sameFinancialProposal(a:Decision,b:Decision) {
  return JSON.stringify([a.obligationId,a.action,a.fundingSourceChain??null,[...a.evidenceIds].sort()])===JSON.stringify([b.obligationId,b.action,b.fundingSourceChain??null,[...b.evidenceIds].sort()]);
}
export function reviewFingerprint(item:unknown,model:string) {
  const copy=structuredClone(item) as {proposal:{reason?:string;evidenceIds:string[]}};
  delete copy.proposal.reason;copy.proposal.evidenceIds.sort();
  return hash([model,copy]);
}
