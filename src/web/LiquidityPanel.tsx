import React from 'react';
import { display } from '../domain.ts';
import type { LiquidityAnalysis } from '../liquidity-analysis.ts';

export type LiquidityView = Pick<LiquidityAnalysis,'asOf'|'mode'|'arc'|'sources'|'conditionalMintOneBridgePerSourceUnits'> & {
  horizons: Omit<LiquidityAnalysis['horizons'][number],'budgetGapUnits'>[];
};
const labels:Record<string,string>={OVERDUE:'Due now',NEXT_24_HOURS:'Within 24 hours',NEXT_7_DAYS:'Within 7 days',NEXT_14_DAYS:'Within 14 days'};
const amount=(value:string|null)=>value===null?'Awaiting observation':`${display(value)} USDC`;

export function LiquidityPanel({analysis,publicView=false}:{analysis?:LiquidityView;publicView?:boolean}) {
  if(!analysis)return null;
  return <section className="panel liquidity-panel" aria-label="Payment readiness">
    <div className="section-title"><div><span className="eyebrow">PAYMENT READINESS</span><h2>Cash against upcoming obligations</h2></div><span className="badge">{analysis.mode==='simulation'?'SIMULATED INPUTS':'CONSERVATIVE ESTIMATE'}</span></div>
    <p className="sub">{publicView?'Visible demo obligations':'Open obligations'} by deadline. Each period includes earlier unpaid amounts, including work awaiting acceptance.</p>
    {!analysis.arc.observationFresh&&<p role="status" className="notice">Arc observation is stale or unavailable. Coverage will update after a fresh observation.</p>}
    <div className="liquidity-horizons">{analysis.horizons.map(h=><article className="liquidity-horizon" key={h.horizon}>
      <h3>{labels[h.horizon]}</h3><strong>{amount(h.principalUnits)}</strong><p>{h.obligationCount} obligations · {h.acceptedCount} accepted</p>
      <dl><dt>Additional Arc funding needed</dt><dd>{amount(h.arcShortfallUnits)}</dd><dt>Gap after conditional CCTP</dt><dd>{amount(h.conditionalShortfallUnits)}</dd></dl>
    </article>)}</div>
    <details><summary>How these estimates are calculated</summary><p>Reserve {amount(analysis.arc.reserveUnits)} is retained once. Every payout includes a gas ceiling of {amount(analysis.arc.gasCeilingPerPayoutUnits)}. Expected customer payments are excluded until received.</p>
      <p>Conditional source capacity: {amount(analysis.conditionalMintOneBridgePerSourceUnits)}, after maximum configured bridge fees and the per-bridge limit, assuming one bridge per verified source. Actual quotes and mint confirmations are still required. A covered liability may still need acceptance or authority.</p>
      {publicView&&<p>These totals cover visible demo obligations only. They do not authorize spending from the shared wallet.</p>}
      <p className="sub">Calculated {new Date(analysis.asOf).toLocaleString('en-GB')}.</p>
    </details>
  </section>;
}
