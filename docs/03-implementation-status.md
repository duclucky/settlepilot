# Implementation status — 2026-10-04

The installable local operator is published at [duclucky/settlepilot](https://github.com/duclucky/settlepilot), under MIT. This source contains no configured credentials, wallet session, database or operator history. Start with the installation and daily-use instructions in [README](../README.md).

A fresh GitHub clone passed all 206 tests and the application build. Credential-free startup was verified in simulation: authenticated state exposes the four liquidity horizons; unauthenticated state is rejected and unknown decision exports return 404. These checks use controlled adapters and do not spend funds.

The current shared product increment includes conservative deadline liquidity analysis, aggregate model cash/budget feedback, per-payout funding gas, and private frozen decision records with integrity verification. See [product improvement record](28-product-intelligence-review.md) for model evaluation results and their limits. No reviewer-directed guide is included.

The separate [public showcase](https://settlepilot-mu.vercel.app) is deployed on Vercel with a continuous private VPS backend. Its Linux release passed 234 tests and builds, preserving saved state and settings. Public HTTP/privacy checks pass; the installation page links to this repository. The function build's Node typings diagnostic has been resolved.

The hosted Agent remains in simulation with operations paused and financial execution/daily admission disabled. Installing this repo does not inherit demo credentials or grant financial authority. Configure your own providers, Circle testnet session, sender/recipient policy, reserves, budget and finite authority before enabling real testnet actions. Existing-database policy renewal/migration, a stable hosted observer origin and real pilot traction remain outstanding; do not infer them from a build or a simulated result.

## Installer update — 2026-10-05

The downloadable installer now includes shared primary/reviewer usage budgets, durable SQLite request history and archive, bounded recovery of unchanged evaluations, batched tool prerequisites, incomplete-response rejection and disabled-model financial guards. Fresh model settings default to GPT-5.4 mini; existing settings are retained. See [update scope and verification](34-installer-agent-update.md) and [installation and usage](../README.md).

Both the installer checkout and a fresh credential-free GitHub clone pass 252 offline tests and the TypeScript/Vite build. The Windows launcher files are unchanged and pass static validation; the product was not started on this PC. No live model, Telegram or testnet execution was performed for this release.

## Local workspace and Setup — 2026-10-05

The installer adopts the simplified white/indigo workspace with Overview, Payments, Funds, Agent log, Your decisions and Setup. The overview separates customer receipts, unsettled obligations and matching verified payouts; offchain outcomes remain explicitly labelled. Exact owner Approve/Cancel/Comment controls and decision exports are retained.

Setup contains write-only model endpoint/model/API key fields, optional Jev and Telegram, business-source settings, and a Circle Agent Wallet connection flow. It discovers the pinned CLI, presents current Terms for explicit consent, supports testnet email/OTP authentication, lists eligible Arc wallets and verifies the selected wallet and RPC network. Startup configuration cannot silently switch an existing wallet or grant spending authority. Local stop is session-protected and blocked by active or unresolved operations. Launcher files remain unchanged.

Verification uses offline adapters and an isolated browser fixture with an in-memory database and no Agent workers. No real Circle login, Terms acceptance, provider call, alert or financial transaction was performed. See [scope and verification](35-local-workspace-and-setup.md); actual Circle login remains dependent on the owner's account and OTP.

The local workspace/Setup increment passes 260 offline tests and the production build. Desktop/mobile fixture inspection and the 222-file public-source scan pass. The isolated preview was closed after verification.

## Owner controls, Hermes patterns and LLM loop repair — 2026-10-05

Setup supports reviewed, version-bound spending grants/revocation, saved sending switches, usage/budget limits and connection recovery. SQLite authority and consumed usage survive restart. Overview shows prerequisites and stalled evaluations. See [owner controls](36-owner-controls-and-readiness.md).

Selected Hermes patterns are implemented in TypeScript: frozen per-evaluation instructions/policy/skills/memory, hash manifests, lazy repeat skill reads and duplicate memory suppression. The separate reference checkout is pinned in [selection record](37-hermes-backend-selection.md). Memory never grants spending authority.

The [LLM loop repair](38-llm-loop-control.md) suppresses unchanged rechecks, canonicalizes repeated tools, stops stalled/error loops, defers temporary provider retries and replaces recursive CCTP replanning with durable jobs. New financial facts, owner delays/approval expiry and deadline transitions remain eligible. Verification: 282 offline tests and build; desktop/mobile fixture checks; no live provider call or transfer. Publication is verified separately after upload.
