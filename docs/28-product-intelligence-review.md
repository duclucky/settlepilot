# Product intelligence review — 2026-10-04

## Scope and authorization

Owner requested a product-wide review, optimization and necessary features to strengthen intelligent operation and practical utility. Preserve the approved contractor/business payment product, two repositories, GPT/Jev decision boundary and testnet-only constraints. This increment changes code and documentation; it does not activate financial workers, accept Circle Terms, publish, deploy or claim customer traction.

## Review findings

- ModelPlanner validates PAY_NOW items independently against the same balance and budget. Multiple individually valid payments can therefore form an infeasible plan. Executor safety still prevents overspending, but the model's stated plan can be inconsistent.
- preview_plan models ordered costs, but its unconditional aggregate-budget branch rejects even a first payment covered by an exact owner budget exception. Later steps must not inherit that exception.
- Treasury inspection exposes balances but lacks an aggregate obligation/deadline view, conditional funding capacity and explicit unmet demand. This leaves economic tradeoffs implicit in prose.
- Runs retain a balance snapshot and version numbers, but the historical document/policy/obligation context can change. A reviewer cannot reconstruct the exact decision inputs from current state alone.
- Existing strengths to preserve: integer money, fresh execution validation, durable intents, reconciliation instead of blind retries, source authority, Jev review, scoped owner requests, worker isolation and public redaction.
- Remaining operational gaps: public deployment financial activation, stable origin, installer publication, real pilot evidence. They are not fixed by offline code tests.

## Implementation and acceptance

1. Add a read-only liquidity analysis: cumulative overdue/24-hour/7-day/14-day liabilities, acceptance/blockers, gas/reserve/budget, conditional source capacity and expected receipts excluded from cash. Always give the model the summary; allow detailed inspection. Backend calculates facts; LLM chooses order and action.
2. Reject aggregate PAY_NOW overcommitment through structured tool feedback so the LLM can revise its plan. Preserve first-step exact approvals and remove them after projected financial change. Regression cases cover competing obligations, budget, gas, reserve, changed liquidity, stale observations and unavailable chains.
3. Persist a versioned decision record before execution with exact relevant input, decisions and SHA-256 integrity digest. Add local authenticated export and offline verification. Clearly distinguish local integrity from signatures, independent business evidence and verified chain settlement. Omit private records from every public projection.
4. Show the liquidity analysis in both panels, with conservative/conditional/stale labels, no new transaction forms. Add reproducible focused checks. Verify desktop/mobile rendering in an isolated simulation environment. Owner explicitly declined a reviewer-directed guide; do not add one.

## Verification plan

Observe RED before behavior fixes; run focused tests, full suites and TypeScript/Vite builds in both repositories. Test restart/tamper detection, API authentication, public isolation, and engine/executor invariants. No transaction is required for these acceptance checks. Record actual results below after completion, distinguishing scripted model tests from live model evaluation.

## Completed increment and observed evidence

- Implemented all four code/UI milestones in both repositories. Final model selections now receive aggregate cash/budget conflict feedback. Selected funding includes a gas ceiling for each payout; first-step exact budget approval is preserved without reuse after projected spending.
- Three regression cases were observed failing before implementation, then passing. Full suites pass: 206 local tests and 234 public-repo tests. Local/application builds and the dedicated public frontend build pass.
- Decision records survive SQLite reopen, freeze captured facts, detect payload edits and exist before simulated submission. Authenticated exports pass; unknown historical records return 404. Both direct and coalesced public run projections omit private records. Public endpoints block private export. Panel polling returns compact summaries instead of repeating full historical portfolios.
- Offline CLI verification returned exit 0 for an exported decision and exit 1 for a modified payload. Execution outcomes are outside that digest; this is local integrity, not signed or independent settlement evidence.
- Actual configured GPT-5.4 + Jev evaluation used synthetic portfolios and no financial executor. With two accepted 4-USDC obligations, 1-USDC reserve and 1-USDC gas ceiling per payout, 10-USDC Arc cash produced PAY_NOW/HOLD; 11-USDC cash produced PAY_NOW/PAY_NOW. The source-funded case completed with HOLD/HOLD after review recovery; the final funding expectation was not met and the harness correctly exited 1. Do not report three successful funding/payment cases. Detailed labelled results remain under ignored data/implementation-verification/liquidity-real-model.json.
- Isolated desktop UI at 1280 pixels and mobile at 375 pixels showed four deadline cards and responsive one-column mobile layout without horizontal overflow. Public build showed visible-case liabilities and no private export control; browser error log was empty. Local export displayed success; this browser's blob-download event timed out, so file delivery was verified through authenticated API/CLI rather than claiming the browser automation captured the downloaded file.
- README in both repositories now documents installation, configuration, source connection, daily requests, payment readiness, exports, Telegram, updates and troubleshooting. Hosted README also covers the private administration listener, daily admission and Vercel/backend configuration. Relative links and code-fence balance pass validation. No reviewer-directed guide remains.

No new onchain transaction, Circle Terms acceptance, wallet login, publication or deployment occurred in this increment. Existing VPS/Vercel release still requires its recorded financial activation steps. General policy renewal/migration for an existing database remains an implementation gap; README states it explicitly instead of suggesting that editing the seed file changes saved authority.
