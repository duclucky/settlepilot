# Measured tool-history reservation — 2026-10-05

The bounded VPS attempt used two completed GPT-5.4 mini requests, estimated at USD 0.0174405. It read context and chose Base Sepolia, then the USD 0.10 reservation guard stopped the third round. No payout or CCTP was dispatched. The second request had no eligible plaintext prefix; raw provider output was not retained. This release addresses that fallback with controlled reasoning-replay cases, rather than claiming a successful live payment.

## Scope and acceptance

Retain request, token and estimated-cost ceilings, the 8,000-token output cap, loop detection and durable unresolved reservations. Admit exact, measured provider history without repeatedly reserving every byte of already measured reasoning. Save hashes and item counts only; do not retain prompts, reasoning text, encrypted provider state or tool arguments in the usage ledger. The downloaded operator and hosted backend use the same implementation.

For a completed official OpenAI Responses request with valid usage and supported manual tool history, the meter stores a hash of the original input plus the provider's emitted reasoning/tool items. A subsequent request can use this prefix only with the same provider, model, settings, run and exact history, within five minutes. Its new items must be plaintext. Reserve the previous input plus total output tokens, a 20% margin, every new UTF-8 byte, item framing and a fixed allowance. Cached-token discounts are never assumed during reservation; actual reported usage still settles the ledger.

Changed hashes, new unmeasured opaque items, different endpoints/settings/runs, stale usage, incomplete responses, missing usage and unsupported modalities retain the byte fallback. Unknown in-flight requests remain charged. Replay hashes persist in SQLite across restart; existing records without these hashes remain valid.

## Verification

Before implementation, controlled three-round reasoning replay failed with `MODEL_RUN_LIMIT`, and a restarted meter fell back to byte reservation. Both cases pass after implementation. Additional checks cover altered history, unknown opaque additions, scope changes, missing/stale usage, unsupported output, restart and budget rejection before transport. The actual ModelPlanner completes batched context, explicit source selection and finish in three offline requests under unchanged USD 0.10 and eight-request limits; no financial executor is used.

The change does not authorize another live evaluation or enable scheduled operation. Live end-to-end settlement remains unverified for this increment. Estimated prices and observed-prefix margins are application accounting estimates, not provider invoice guarantees.

Full offline verification: installer 286 tests and production build; hosted backend 337 tests and both builds. No paid provider, Circle, RPC or Telegram request was made during this optimization.
