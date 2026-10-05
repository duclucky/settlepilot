# Portfolio funding and payment priority

Approved repair scope, 2026-10-05: resolve the mismatch between individually affordable obligations and an unaffordable selected portfolio. The LLM chooses registered obligations, order and one source; the backend derives the shared deficit, validates constraints and executes only within existing authority. No provider, wallet, UI or scheduler expansion.

Acceptance criteria:

- An explicit FUND_ARC portfolio may include individually ALLOW obligations when its total principal, one reserve and per-payout gas exceeds current Arc funds.
- Zero deficit, duplicate/unknown/closed targets, hard policy blocks, aggregate budget excess and stale observations cannot authorize funding. Source selection and funding skill remain required. Preview and CCTP use the same deficit calculation; partial funding stays conditional.
- PAY_NOW still requires existing Arc funds. Funding never authorizes a payout before verified mint and fresh model/policy evaluation.
- Infeasible payout feedback exposes a conditional funding alternative instead of directing only HOLD. Priority defaults to actionable overdue/earliest due obligations; departures need trusted business reasons, not preference for small amounts alone.
- Funding choices retain their targets and source in durable goals through mint. Reassessment may change a goal with an explicit reason; goals do not grant authority or prove payment.
- Existing request/cost/time limits, anti-loop controls, idempotency and reconciliation remain unchanged. Verification is offline; live execution needs separate authorization.

Verification: the new regression failed on the original planner (four scripted requests and HOLD fallback instead of three requests ending FUND_ARC). The original preview returned zero funding for the shared gap, and the original feedback omitted a funding alternative. The implemented repair passes all 296 installer tests and the TypeScript/Vite build; shared hosted code passes 347 tests and both builds. Ten new offline cases cover the collectively short portfolio, six-obligation deadline facts, zero-gap rejection, prerequisites, shared budget and hard policy blockers, partial caps/stale sources, retained goals, reviewer portfolio context and one-time CCTP dispatch. All providers and receipts in these cases are explicitly controlled fixtures; no live model behavior, transaction or business traction is claimed.

The model receives urgency facts and an explicit default priority, while retaining responsibility for choices and explaining deviations. Offline scripted tools prove that the backend accepts and validates the new path; they do not prove a live LLM will always choose the best priority. Existing request/cost/time controls are unchanged and the previous reasoning-replay and loop regression suite still passes.
