---
name: fund-arc-with-cctp
description: Choose a verified source-chain treasury balance when Arc lacks USDC for selected obligations.
---

# Fund Arc with CCTP V2

1. Call `inspect_treasury` and consider only fresh `VERIFIED` balances.
2. Choose one allowlisted source with `choose_funding_source`. The backend will not substitute another chain.
   Finish the selected obligations with action `FUND_ARC`. A selected portfolio can lack money even when every individual policy result is ALLOW. Compare its total principal plus one reserve plus a gas ceiling for each payout with Arc cash. The backend derives the positive shared deficit and validates the full portfolio and spending budget. Choosing a source alone does not dispatch a bridge. `HOLD` does nothing; `PAY_NOW` requires sufficient existing Arc funds. `FUND_ARC` creates only a validated funding intent, never a payout. After verified mint, make a new decision before payment.
3. Prefer a source that can cover the deficit and fee; if none can, choose the best safe partial source and re-plan after the verified mint.
4. Do not count revenue history as treasury liquidity.
5. Wait for independent source burn and Arc mint proofs before considering any payout.
6. If the chosen source becomes unavailable, observe the failure and choose again in a new plan.
7. In `preview_plan`, a funding step covers the unique financial targets in the remaining steps; include the intended subsequent payouts to preview the shared gap. A funding/payout pair for the same ID counts once. Projections remain conditional; costs are policy ceilings, not provider quotes.
8. Reuse the retained funding goals after mint. If new facts change priorities, explain the change; do not silently abandon an overdue target to clear smaller, later-due payments.
