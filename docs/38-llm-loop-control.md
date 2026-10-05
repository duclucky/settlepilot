# LLM loop control — 2026-10-05

Scope: stop repeated paid evaluations and stalled tool loops while preserving decisions after real financial changes. This is implemented in the installer and private hosted backend. No model/provider request is needed for the offline regressions.

Evidence and resulting behavior:

- JSON indentation and object-key ordering no longer evade repeated-tool detection.
- Two consecutive tool errors or actions without new decision context stop with `MODEL_NO_PROGRESS`. Rewriting memory notes/plan descriptions does not reset progress. A policy conflict already identified still produces a scoped owner notification.
- Successfully evaluated inputs have a durable key captured before planning. Scheduled rechecks and worker restarts do not resample the same facts. New receipts/balances during execution remain eligible for the next evaluation.
- Provider failure retry identity excludes observation timestamps and freshness: an RPC refresh cannot replenish a failed model's retry allowance. Temporary provider failures make one request, wait at least five minutes, and allow at most one scheduler retry for unchanged business inputs.
- Empty payment portfolios skip the model unless there are verified unmatched receipts and active authoritative receivable records to resolve.
- A continuously changing funding snapshot permits at most one immediate replan. Further drift invalidates the plan and stops. A verified CCTP mint queues one durable continuation instead of recursively creating up to nine independently budgeted runs.
- Existing request/token/known-cost admission, uncertain reservations, SQLite persistence, leases and receipt checks remain enforced. Clearing a block never erases consumed usage or implicitly enables spending.

Acceptance regressions: idle/recheck spam; differently formatted repeated reads; changing invalid IDs; repeated memory writes; HTTP cooldown across reconstructed meters; unchanged failures across scheduler/SQLite restart; actual balance changes; snapshot freshness without retry reset; bounded funding drift; CCTP across one/two chains and capped transfers; owner notification on an unresolved policy conflict; budgets enforced before transport.

Limits: these changes bound identified request loops; they do not guarantee provider billing totals or eliminate calls for genuinely new business inputs. Unknown prices retain request/token controls. Live provider behavior and paid savings need separately authorized measurement.
