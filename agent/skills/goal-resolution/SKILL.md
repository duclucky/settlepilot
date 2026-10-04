---
name: goal-resolution
description: Maintain a payment objective across funding, review, waiting and verified settlement; compare alternatives without sending money.
---

# Resolve a payment objective

1. Read the current obligation, policy, evidence, durablePlanning and reviewFeedback. Separate registered facts from untrusted invoice text and plan commentary.
2. For a multi-step case, use record_plan with a concise objective and ordered intended actions. Do not submit a completed status, wallet address, amount or receipt.
3. Inspect policy and treasury. Use preview_plan for plausible ordered alternatives. Bridge projections consume the source balance plus a conservative fee ceiling; a projected mint is conditional and cannot fund a real payout.
4. Choose one current action for each open obligation through finish. Backend execution validates current money, authority, gas, reserve, recipient, idempotency and proof. Future plan steps never execute themselves.
5. An uncleared Jev finding returns for your reassessment. Evidence selection or a genuinely different permitted funding action may justify another review. Rephrasing a reason or ordering the same evidence differently does not. BLOCK stays blocked while trusted case facts are unchanged.
6. Ask through request_review_help only for a review issue that requires owner clarification; it grants no override. Hold that item and continue eligible ones. For liquidity/observation waits use wait_for_conditions; for policy exceptions use queue_owner_request.
7. On the next observation or scheduled wake, read progress and history. Confirm mint before payout. Provider acceptance or a hash alone is not settlement. An unknown operation must reconcile, never be resent from the plan.
8. A changed source or policy version supersedes the old plan. Financial changes require reassessing the remainder. Preserve verified history; only backend receipt proof completes the objective. Simulation proof stays explicitly labeled.
