import { z } from 'zod';
import { SOURCE_CHAIN_NAMES, type State } from './domain.ts';
import { evaluate } from './policy.ts';
import { verifiedCrosschainBalances } from './treasury.ts';
import { fundingPortfolio } from './funding-portfolio.ts';

export const PreviewInput=z.object({steps:z.array(z.object({obligationId:z.string().min(1).max(80),action:z.enum(['FUND_ARC','PAY_NOW','HOLD','REQUEST_EVIDENCE']),sourceChain:z.enum(SOURCE_CHAIN_NAMES).nullable()}).strict()).min(1).max(200)}).strict();
export function previewPlan(state:State,raw:unknown,now=Date.now()) {
  const input=PreviewInput.parse(raw),s=structuredClone(state),sources=new Map(verifiedCrosschainBalances(s,now).map(b=>[b.sourceChain,BigInt(b.balance)]));
  let arc=BigInt(s.snapshot.balance),spent=s.intents.filter(i=>['SETTLED','SIMULATED'].includes(i.status)).reduce((n,i)=>n+BigInt(i.amount),0n),conditional=false,financialSteps=0;
  const reserve=BigInt(s.policy.reserve),gas=BigInt(s.policy.gasLimit),fee=BigInt(s.bridgePolicy.maxFee),paid=new Set<string>();
  const steps=input.steps.map((step,index)=>{
    const o=s.obligations.find(o=>o.id===step.obligationId&&!o.paid&&!o.archived);if(!o)throw new Error('UNKNOWN_CANDIDATE');
    if(step.action!=='FUND_ARC'&&step.sourceChain)throw new Error('INVALID_FUNDING_SOURCE');
    s.snapshot.balance=arc.toString();if(financialSteps)s.approvals=[];
    const eligibility=evaluate(s,o,now);
    let result=eligibility,funding=0n,cost=0n;
    if(step.action==='FUND_ARC'){
      if(!step.sourceChain||!s.bridgePolicy.enabled||!s.bridgePolicy.sourceChains.includes(step.sourceChain))throw new Error('SOURCE_NOT_ALLOWED');
      const targets=[...new Set(input.steps.slice(index).filter(step=>['FUND_ARC','PAY_NOW'].includes(step.action)&&!paid.has(step.obligationId)).map(step=>step.obligationId))];
      const portfolio=fundingPortfolio(s,targets,now,spent);
      if(portfolio.conflicts.length)result=portfolio.conflicts[0].result;
      else if(portfolio.gapUnits==='0')result='FUNDING_NOT_NEEDED';
      else {
        const available=sources.get(step.sourceChain);
        if(available===undefined)result='SOURCE_BALANCE_UNAVAILABLE';
        else {
          const gap=BigInt(portfolio.gapUnits!),capacity=available>fee?available-fee:0n;
          funding=[gap,capacity,BigInt(s.bridgePolicy.maxAmount)].reduce((a,b)=>a<b?a:b);
          if(funding<=0n)result='SOURCE_CAPACITY_INSUFFICIENT';
          else {cost=fee;sources.set(step.sourceChain,available-funding-fee);arc+=funding;conditional=true;financialSteps++;result=funding>=gap?'CONDITIONAL_FUNDING_COVERS_GAP':'CONDITIONAL_PARTIAL_FUNDING';}
        }
      }
    }else if(step.action==='PAY_NOW'){
      if(paid.has(o.id))throw new Error('DUPLICATE_PAYOUT');
      paid.add(o.id);
      // evaluate already honors a current exact approval on the first step.
      // Financial changes invalidate that approval for subsequent steps.
      if(financialSteps>0&&spent+BigInt(o.amount)>BigInt(s.policy.totalBudget))result='BUDGET_EXCEEDED';
      if(result==='ALLOW'){arc-=BigInt(o.amount)+gas;spent+=BigInt(o.amount);cost=gas;financialSteps++;result=conditional?'CONDITIONAL_PAYMENT_FEASIBLE':'PAYMENT_FEASIBLE';}
    }
    return {obligationId:o.id,action:step.action,sourceChain:step.sourceChain,result,fundingUnits:funding.toString(),costCeilingUnits:cost.toString(),projectedArcBalance:arc.toString(),reserveUnits:reserve.toString(),projectedSpentUnits:spent.toString(),conditionalOnVerifiedMint:conditional};
  });
  return {kind:'CONSERVATIVE_PROJECTION',executionAuthorized:false,costsAreProviderQuotes:false,expectedReceiptsIncluded:false,steps,sourceBalancesAfter:sources.size?Object.fromEntries([...sources].map(([c,b])=>[c,b.toString()])):{}};
}
