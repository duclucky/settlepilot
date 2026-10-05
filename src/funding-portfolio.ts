import {type State} from './domain.ts';
import {evaluate} from './policy.ts';

/** Financial facts for model-selected targets; never chooses targets or grants authority. */
export function fundingPortfolio(state:State,obligationIds:string[],now=Date.now(),spentUnits?:bigint){
  const spent=spentUnits??state.intents.filter(i=>['SETTLED','SIMULATED'].includes(i.status)).reduce((n,i)=>n+BigInt(i.amount),0n);
  const conflicts:{obligationId:string;result:string}[]=[];
  const seen=new Set<string>();let principal=0n;
  for(const id of obligationIds){
    if(seen.has(id)){conflicts.push({obligationId:id,result:'DUPLICATE_CANDIDATE'});continue;}
    seen.add(id);
    const o=state.obligations.find(o=>o.id===id&&!o.paid&&!o.archived);
    if(!o){conflicts.push({obligationId:id,result:'UNKNOWN_CANDIDATE'});continue;}
    const eligibility=evaluate(state,o,now);
    if(!['ALLOW','INSUFFICIENT_FUNDS','RESERVE_CONFLICT'].includes(eligibility))conflicts.push({obligationId:id,result:eligibility});
    principal+=BigInt(o.amount);
    // New cash cannot enlarge spending authority, including an aggregate portfolio.
    if(spent+principal>BigInt(state.policy.totalBudget))conflicts.push({obligationId:id,result:'BUDGET_EXCEEDED'});
  }
  const target=obligationIds.length?principal+BigInt(state.policy.reserve)+BigInt(seen.size)*BigInt(state.policy.gasLimit):0n;
  const gap=target>BigInt(state.snapshot.balance)?target-BigInt(state.snapshot.balance):0n;
  return {obligationIds:[...seen],principalUnits:principal.toString(),targetArcUnits:target.toString(),
    gapUnits:conflicts.length?null:gap.toString(),conflicts,executionAuthorized:false as const,requiresVerifiedMint:true as const};
}
