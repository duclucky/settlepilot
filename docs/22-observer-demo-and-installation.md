# Daily autonomous showcase and public local installer

User selected this product delivery on 2026-10-04. This replaces visitor-created Test Lab on the public website. The local operator remains installed on the owner's PC; its clean source is intended for a public GitHub repository. Public website UI and agent output remain English.

## Scope and authority

- Public website is read-only: visitors observe shared demo cases, Agent decision explanations, tool activity, review verdicts, plans, payout/CCTP hashes and settlement evidence. Explanations are concise observable decision rationale, not private model chain of thought.
- A server worker schedules 1–3 scenarios per UTC day, generated deterministically and persisted before admission. It supplies business conditions only. The existing LLM, scheduler and wallet executor choose/validate/execute all financial actions. Same-day missed slots may run when safe; prior days are marked missed, never replayed in bulk.
- The demo uses the host's real testnet wallet/API credentials. There are no fake funds or fabricated onchain outcomes. Scenario completion and payment settlement are distinct. Insufficient funds, expired authority, owner requests and unknown outcomes remain visible; the worker cannot auto-approve, increase caps, renew authority or resend unknown transactions.
- Keep financial/demo gates disabled by default. The old live scope is settled, budget exhausted and authority expired; this work does not activate recurring spending. Activation needs a concrete fresh finite policy scope. Public publication destination is pending; never invent a GitHub URL.
- Installation is a separate public page with prerequisites, download/clone, PowerShell startup, initial model/endpoint/key, wallet/authority/source/Telegram setup, local-only owner actions and troubleshooting. No visitor input or secrets.

## Implementation order

1. Add persisted daily slot scheduling and internal scenario admission using existing validated Test Lab backend. Verify 1–3 slots, deterministic restart, concurrent tick dedup, prior-day handling, disabled/expired/paused gates and pending reconciliation without financial calls in tests.
2. Replace public APIs/UI with observer DTO. Disable visitor scenario submission and all mutations; preserve loopback host admin. Scope public history to auto-demo ledger, expose safe decision summaries/tool metadata and verified financial proofs, redact secrets, private host memory/comments/evidence/session data.
3. Add Live Demo and Installation pages, history selection, readable chronology and explorer links. Preserve established component styles, responsive/keyboard navigation. Local repo loses private-source positioning and gets reproducible installer documentation without secrets/demo data.
4. Run public/local regression suites and builds, isolated offline scheduler/API tests and browser verification. Keep the settled local live service unchanged; preview public mode using isolated simulation with explicit offchain label and no financial adapters. Update implementation status with exact evidence and any remaining publication/activation prerequisites.

## Acceptance

- All visitors see the same autonomous demo history without creating tests, signing in to wallets, entering technical details or granting shared wallet approval.
- Calendar has 1–3 durable slots per day; one admission per slot across restart/ticks, daily amount reservations retained. Worker only enqueues conditions, never calls payment/model directly.
- No scenario replaces unresolved financial operations or owner requests. Authorization failure cannot execute transactions. Real testnet state/hashes never relabeled from simulation.
- Viewer can inspect each case's conditions, chosen actions and short rationale, tool call names/results/timestamps, Jev review and payout/CCTP onchain information; private payloads are absent.
- Installation page has actual project commands/settings and a validated GitHub link only after destination is configured. Repo publication and daily live activation are reported separately from verified local implementation.

## Verification — 2026-10-04

Implemented the calendar/admission worker, server tick integration, shared read-only observer API/UI and separate installation page. Eight new scheduler/observer tests cover reproducible 1–3 slots, concurrent/restart dedup, authority/paused/disabled gates, unknown outcome reservations, prior-day misses/crash after admission, a full three-slot day, public projection privacy and blocked mutations. Calendar and first admission tests observed RED against the initial no-op implementation; guard/API cases also provide post-implementation coverage. Public final **204/204**, TypeScript/Vite build pass.

The clean local installer source has **182 files**, no configured secrets, database, Git history or demo `.env`. Independent fresh-folder `npm ci`, build, **191/191 tests** and secret-free simulation startup pass. Sending, bridging and model calls were disabled for smoke verification; zero financial calls. The downloadable archive was prepared locally, not published to GitHub. Its manifest/check evidence is in local ignored `data/implementation-verification/installer-current.json`, `installer-verification.json`, `installer-start-verification.json`, `installer-tests.log` and `installer-build.log`.

Browser QA used an isolated in-memory offchain fixture on localhost 4321, not the settled database on 4317. Verified shared scenario selection, decision/tool chronology, explicit offchain label, installation sections, zero technical inputs and no horizontal overflow at 375 px. The website distinguishes an admitted scenario, completed evaluation and verified settlement; unavailable/disabled authority is visible, never a fabricated transaction. Public JSON export contains the safe projection only.

Public evidence logs: `data/implementation-verification/daily-demo-tests.log` and `daily-demo-build.log`. No new live LLM calls or testnet transactions were performed for this feature. Daily runs have not yet been activated or verified across real days. Site hosting/domain, the actual installer GitHub destination and a fresh finite spending authority remain deployment prerequisites. The old settled demo budget/expiry were not renewed.

Final export verification: the server attachment route returns only the selected automatic case; HTTP regression asserts file headers, exact case scoping, private-case exclusion and unknown-slot rejection. Final public tests remain **204/204** and build passes. Browser download from the real export link succeeded to `tameion-2026-10-04-1.json`; the isolated simulation log has one obligation, one tool call and no payment. No live adapter was present.

## Canteen research

Read official [Builder Bento Box](https://arc-canteen.dev/), [Arc OSS requirements](https://arc-canteen.dev/arc-oss/) and [CLI README](https://github.com/the-canteen-dev/ARC-cli) on 2026-10-04. Showcase applications may use the Google form or `arc-canteen submit-showcase` after GitHub login. The guided application requests main repo, live site, forkable repo/reusable primitives and open-source/live-site commitments. `update product`/`update traction` publish progress; no command was installed, authenticated or submitted as a side effect of reading. This feature does not claim Showcase eligibility or acceptance.

The same OSS page currently advertises a separate mainnet bounty with a valid Showcase entry deadline of September 30, 2026. The current date is October 4; no pre-deadline submission has been established. Do not infer bounty eligibility or expand this testnet project to mainnet from that webpage.
