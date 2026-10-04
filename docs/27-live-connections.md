# SettlePilot live connection activation

Owner requested all existing functions connected on 2026-10-04. This continues the isolated VPS deployment, without changing other applications.

## Scope and acceptance

- Transfer this application's existing LLM, Jev, Telegram and RPC settings over SSH into the dedicated 0600 operator configuration. Preserve the generated observer token and filesystem paths.
- Keep GPT-5.4 and the configured endpoints. Verify a real planning-only model/tool cycle and independent Jev review using explicitly synthetic inputs, without payment execution.
- Verify one generic outbound Telegram connection notification. No inbound Telegram commands.
- Reuse only this application's testnet Circle session if transferable and valid; never copy mainnet credentials or machine Terms acceptance. Obtain explicit Circle Terms consent for the new machine first.
- Verify exact wallet identity and actual balances on Arc plus the seven configured source testnets. Do not describe API acceptance as an onchain payment.
- Keep sends, bridging and daily admission disabled until current finite financial authority is confirmed. Deployment and API configuration do not renew expired spending authority.
- Verify localhost owner access, public read-only state and secret redaction after configuration. Record fresh evidence and outstanding gates.

## Continuation: independent read-only treasury observation

Acceptance for the owner's continuation request: disabling bridge execution must not disable source-chain RPC balance observation. Observed balances remain visible but cannot become funding liquidity while the bridge execution gate is off. A failed Arc wallet connection must not prevent source-chain observations. Funding capability changes invalidate saved plans and wake evaluation. Preserve all transfer, policy and receipt checks; no money-moving permission is added.

Implemented in both sources: source observations run in their own worker and carry a funding execution flag. LLM initial context and treasury tool separate observed source funds from eligible funding; disabled funds cannot be selected or counted in plan previews. Recovery distinguishes a disabled executor from an unavailable RPC. Changes to funding capability invalidate the financial version and scheduler context. Owner inventory labels reflect the execution gate. Telegram user-facing text now uses SettlePilot; severity, reminder intervals, generic content and idempotency remain unchanged.

Regression checks first failed on skipped RPC reads, wallet failure blocking source observations and disabled execution being treated as an RPC failure. After repair, all 195 local and 221 demo tests passed; local/operator/public builds passed. This repair adds read-only observation, not financial authority.

Deployed release `/home/settlepilot/releases/20261004T040601Z`. Linux builds and all 221 tests passed before switching the release; service restarted successfully and retained the paused database and private provider settings. The observer tunnel was not restarted. A separate in-memory test using the deployed treasury code read all seven source RPCs successfully with execution disabled; every observation has `fundingEnabled:false`, funding units remain zero and no payment/bridge intent was created. Arc and source balances are read-only testnet observations; this check did not mutate the production database.

Prepared admission limits are now stored privately and visible on the public schedule: 0.10 USDC per item, 0.20 per case, 0.60 per day, while admission and financial execution remain disabled. Public API checks after restart still return 404 for private settings and 405 for writes, with no configured provider/Telegram secrets in public responses. Browser confirms owner operations paused and public demo waiting for activation. Arena remains healthy at `fabc826` with unchanged containers/ports. Clean pre-deploy archives were scanned with zero configured secret matches; evidence is in `artifacts/release-20261004-110440/verification.json` and `data/implementation-verification/readonly-treasury-vps.json`.

## Verified connection status

Verified on 2026-10-04:

- Existing application provider settings transferred over SSH into the dedicated operator file (0600). Observer token preserved; wallet directory remains 0700. Both SettlePilot services are active.
- GPT-5.4 completed four actual Responses requests with four function calls on a synthetic planning-only fixture. Jev completed one actual review request: `ALLOW`, confidence 0.91, returned model `jev-1.13.0`. All five provider HTTP responses were 200. No executor was attached to this check and no funds moved.
- Localhost owner settings report the primary planner active and Jev enabled. Telegram connection test was accepted by Telegram and the owner API returned 200. User reading the message is not independently verified; the app still has no inbound Telegram channel.
- Direct RPC reads on the VPS verified chain IDs and balances on all eight testnets. Arc had 60,000 units (0.06 USDC); Base Sepolia 11,014,413 units (11.014413 USDC); the remaining six source chains were zero, observed around 03:05 UTC. These are point-in-time observations, not future payment availability.
- Local Circle session is VALID with approximately 20 days remaining, no mainnet session, and the local Arc wallet list matches the expected sender. Session secrets are transferable in principle; no Circle credentials or Terms acceptance were copied to the VPS yet.
- Owner panel remains reachable via localhost 4339; it is paused with sends/bridging/daily admission off. Public assets/state/schedule contain none of the configured primary/reviewer API keys, Telegram token or chat ID. Private settings return 404; public mutations return 405.
- Arena stays at commit `fabc826`, healthy, with unchanged containers and port 8080. Existing local 4317 remains untouched; its runtime send flags are still true despite `.env` flags being false, but its financial authority expired on 2026-10-03. Pause that former executor before granting fresh VPS authority.

Outstanding required consent: Circle Terms on the new machine, followed by valid testnet wallet identity on that profile, and fresh finite financial authority. The prepared private `activation-draft.json` proposes seven days, payout budget 3 USDC, 0.10 per obligation, 0.20 per scenario, 0.60 per day, Arc reserve 0.05, bridge amount at most 0.50 and fee at most 0.02 per bridge. It remains disabled with an expired authority timestamp; approval must set a fresh expiry. No new onchain payment or CCTP transaction occurred.

Private evidence: `data/implementation-verification/connected-surfaces.json`, `live-provider-evidence.txt`; VPS `state/ai-connection-verification.json` and `balances-connection-verification.json`. The public demo remains labelled simulation/waiting for activation until the wallet and financial gates clear. Quick Tunnel hostname persistence and unpublished installer repository remain the deployment limitations documented in section 26.
