# Implementation status — 2026-10-04

The installable local operator is published at [duclucky/settlepilot](https://github.com/duclucky/settlepilot), under MIT. This source contains no configured credentials, wallet session, database or operator history. Start with the installation and daily-use instructions in [README](../README.md).

A fresh GitHub clone passed all 206 tests and the application build. Credential-free startup was verified in simulation: authenticated state exposes the four liquidity horizons; unauthenticated state is rejected and unknown decision exports return 404. These checks use controlled adapters and do not spend funds.

The current shared product increment includes conservative deadline liquidity analysis, aggregate model cash/budget feedback, per-payout funding gas, and private frozen decision records with integrity verification. See [product improvement record](28-product-intelligence-review.md) for model evaluation results and their limits. No reviewer-directed guide is included.

The separate [public showcase](https://settlepilot-mu.vercel.app) is deployed on Vercel with a continuous private VPS backend. Its Linux release passed 234 tests and builds, preserving saved state and settings. Public HTTP/privacy checks pass; the installation page links to this repository. The function build's Node typings diagnostic has been resolved.

The hosted Agent remains in simulation with operations paused and financial execution/daily admission disabled. Installing this repo does not inherit demo credentials or grant financial authority. Configure your own providers, Circle testnet session, sender/recipient policy, reserves, budget and finite authority before enabling real testnet actions. Existing-database policy renewal/migration, a stable hosted observer origin and real pilot traction remain outstanding; do not infer them from a build or a simulated result.
