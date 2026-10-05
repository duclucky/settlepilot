import type {ModelControl,ModelLimits} from './model-requests.ts';

/** Mirrors admission accounting: unknown outcomes keep their reserved capacity. */
export function modelUsageSummary(control:ModelControl,limits:ModelLimits,now=Date.now()) {
 const day=new Date(now).toISOString().slice(0,10);
 const rows=control.requests.filter(r=>new Date(r.at).toISOString().slice(0,10)===day);
 const reportedTokens=rows.reduce((n,r)=>n+(r.usage?r.usage.inputTokens+r.usage.outputTokens:0),0);
 const reservedTokens=rows.reduce((n,r)=>n+(!r.usage?r.reservedTokens:0),0);
 const estimatedCostNanoUsd=rows.reduce((n,r)=>n+(r.estimatedCostNanoUsd??0),0);
 const reservedCostNanoUsd=rows.reduce((n,r)=>n+(r.estimatedCostNanoUsd===undefined?r.reservedCostNanoUsd??0:0),0);
 return {day,requests:rows.length,reportedTokens,reservedTokens,estimatedCostNanoUsd,reservedCostNanoUsd,
  unpricedRequests:rows.filter(r=>r.estimatedCostNanoUsd===undefined&&r.reservedCostNanoUsd===undefined).length,
  unresolvedRequests:rows.filter(r=>r.status==='UNKNOWN'||r.status==='RESERVED').length,
  remainingRequests:Math.max(0,limits.maxDayRequests-rows.length),remainingTokens:Math.max(0,limits.maxDayTokens-reportedTokens-reservedTokens),
  remainingCostNanoUsd:Math.max(0,limits.maxDayCostNanoUsd-estimatedCostNanoUsd-reservedCostNanoUsd),
  resetsAt:new Date(Date.parse(day)+86400000).toISOString()};
}
