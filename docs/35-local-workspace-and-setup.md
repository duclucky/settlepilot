# Local workspace and Setup

Approved scope, 5 October 2026: apply the simplified public workspace visual to the downloadable operator and add a dedicated Setup page for the model and the owner's Circle Agent Wallet.

The overview answers three questions: what customers paid, what remains owed, and who needs payment. Contractor names and deadlines lead the queue. Funds, payment records and Agent decisions remain separate destinations. Simulation is explicitly offchain. A settled badge requires a matching verified intent; accepted submissions and transaction hashes alone are not settlement.

Setup reuses the write-only model and Jev settings. Wallet setup discovers the pinned Circle CLI, presents its current Terms before explicit acceptance, supports testnet email/OTP login, lists Arc Testnet Agent Wallets and verifies the selected wallet and RPC network. Only a vetted CLI entrypoint can execute, with fixed argument arrays and hidden windows. OTPs stay transient; provider errors are not returned verbatim. No wallet private key is requested.

Saving wallet startup configuration preserves existing model/Telegram settings, financial history and policy. A first connection creates a disabled policy and uses a separate testnet database. It does not grant authority or enable transfers. Changing the sender of an existing workspace is refused. Startup changes require stopping an idle panel and reopening the existing hidden launcher; pending operations cannot be abandoned by this control.

Acceptance checks: offline regression tests for summary accounting, configuration persistence, identity/network validation, Terms consent and authentication; production build; desktop/mobile browser inspection with labelled fixtures and no Agent workers; clean public-source scan; hidden launcher preserved; README updated with navigation and setup steps. No paid model call, real login, notification or financial transaction is part of verification.

## Verification result

- `npm test`: 260/260 offline tests pass; `npm run build` passes.
- Browser inspection at 1440 × 1000 and 390 × 844: Setup model save, wallet selection, RPC save/restart message, section navigation, Payments records, Funds, Agent log and owner-request page remain reachable. No horizontal page overflow or missing visible form labels was found in the inspected mobile views; no browser console errors were recorded.
- The preview used an in-memory simulation, dummy credentials and a fake Circle adapter, with no worker loop or external provider transport. It was stopped after inspection. Actual email/OTP authentication still depends on the user's Circle account; this verification is not a live authentication claim.
- Public-source scan: 222 tracked source files, no configured secrets or private runtime files, no missing Markdown documents. All three Windows launcher files match the previous release.
