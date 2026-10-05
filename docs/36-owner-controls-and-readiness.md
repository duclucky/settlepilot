# Owner controls, readiness and usage

Approved scope: complete local installation through owner-controlled financial authority, show operational prerequisites accurately, expose durable model usage and budgets, and verify first-run/recovery behavior. Public observers do not receive owner controls.

Acceptance:
- Session-protected authority grants bind to wallet, policy and financial versions, with an explicit confirmation. Allowlist, integer money, expiry and bridge scope are validated. Grants require idle operations; revocation immediately pauses new work while submitted transactions remain reconcilable.
- SQLite is the authoritative versioned policy after initialization; restart preserves history and authority. Execution switches are saved separately and require restart, never silently enabled by model or wallet setup.
- Overview reports pending receipts, authority, execution switches, model blocks, automation and freshness without claiming an unavailable Agent is monitoring. Operational status is separate from recorded model decisions.
- UTC-day model requests, reported usage, outstanding reservations, known-price estimates, unknown pricing, remaining allowances and provider blocks are visible. Owner budget changes preserve usage and pause; resets cannot bypass consumed budgets.
- Offline tests cover stale grants, concurrency, pending operations, invalid input, restart and first-run APIs. Live checks use the existing authorized VPS session without starting a production Agent on this PC; missing live prerequisites are documented honestly.

Implemented in `owner-controls.ts`, `operational-readiness.ts`, `model-usage-summary.ts`, protected local APIs and the installer Setup UI. Owner-control regressions cover version binding, concurrent grants, pending-operation rejection, usage preservation and full runtime restart with persisted policy.

The installer passes 282 offline tests and the TypeScript/Vite build. An isolated browser fixture verified exact recipient/amount/expiry review, saved sending switches with a restart notice, mobile budget editing, retained usage and no horizontal overflow at 390px. The fixture and tab were closed; no real Agent worker or provider was used on this PC.

Read-only VPS state was verified through the administrator SSH alias; the dedicated `settlepilot-vps` alias permits forwarding and cannot run administrative commands. The production Agent remains inactive and paused. No live Circle/RPC/model request or transfer was made during this increment; real provider verification remains separate from offline acceptance.
