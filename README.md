# SettlePilot — local payment agent

SettlePilot watches business obligations and incoming USDC, uses a language model to choose payment, funding or waiting, and reconciles the result. It can bring canonical USDC from permitted source testnets to Arc through CCTP V2 before paying contractors.

This repository is the **installable local operator**. Your wallet session, provider keys, business records and SQLite history stay on your computer. The separate public showcase uses the maintainer's own configuration and synthetic scenarios. Installing this source does not import the showcase wallet or credentials.

The interface and Agent output are in English. The supported payment network is **Arc Testnet, chain ID 5042002**. Simulation is offchain and works without a wallet or API keys.

## 1. Install and open the panel

### Requirements

- Windows PowerShell for the included launcher.
- Node.js **24.11 or newer**, with npm.
- Git if you clone the source; a downloaded and extracted ZIP also works.
- Internet access when using model providers, Circle or testnet RPCs.

Check the installed tools:

```powershell
node --version
npm --version
git --version
```

Download [the installer source](https://github.com/duclucky/settlepilot) using **Code → Download ZIP**, extract it, and open PowerShell in the extracted project folder. Or clone it:

```powershell
git clone https://github.com/duclucky/settlepilot.git
cd settlepilot
```

Run:

```powershell
npm ci
npm run build
powershell -File .\Open-SettlePilot.ps1
```

The launcher starts the server in the background and opens **http://127.0.0.1:4317**. It reuses an existing healthy local panel. Leave the server running while the Agent works.

For a visible server console instead:

```powershell
npm start
```

Then open the same localhost URL. Stop a foreground server with **Ctrl+C**. Closing the browser alone does not stop a background server started by the launcher.

No `.env` is required for the first simulation startup. A clean database starts with labelled sample obligations and automatic evaluations disabled. Without a configured LLM, the planner is labelled **rules baseline — no AI model**.

If the default port is occupied by another application:

```powershell
powershell -File .\Open-SettlePilot.ps1 -Port 4327
```

Use **http://127.0.0.1:4327**. For foreground startup, set `$env:PORT = '4327'` in that PowerShell session before `npm start`.

## 2. Configure the language models

Open **Authority & connections → LLM connection**.

1. Enable the primary model.
2. Enter the **endpoint**, **model** and **API key** supplied by your provider. The supported primary API is **OpenAI Responses-compatible**; a Chat Completions-only endpoint is not interchangeable.
3. For the demonstrated OpenAI configuration, use `https://api.openai.com/v1/responses` and model `gpt-5.4`.
4. Enable Jev if you want typed review of financial proposals. Its default endpoint is `https://api.typesafe.ai/v1/systemone`, model `jev-latest`, and minimum confidence `0.80`. Enter your own Jev API key.
5. Save. The planner changes for the next evaluation without a server restart. Wait for any active evaluation to finish before changing providers.

Keys are write-only: the panel shows whether a key is configured and never returns its value. Saving writes the ignored local `.env`. Later saves can retain an existing key without re-entering it. Model configuration does not enable testnet transfers.

When enabled, the providers receive obligation summaries and requested business evidence. Provider calls consume your configured allowance. Use data you permit those providers to process. Wallet private keys and Circle session credentials never enter model context.

The model reads operating instructions, current policy, skill descriptions and bounded memory, then calls tools to inspect evidence, balances and feasible plans. Jev returns `ALLOW`, `REVIEW` or `BLOCK`; low-confidence or unsafe financial proposals can be held for new facts or owner input.

## 3. Connect your own Circle Agent Wallet

Skip this section to stay in simulation. A real testnet installation needs a separate Circle session, wallet, policy and database.

This adapter was verified with **Circle CLI 1.1.4**. Install that version separately from the application's dependencies:

```powershell
npm install -g @circle-fin/cli@1.1.4
circle --version
circle wallet status
```

If Circle requires Terms acceptance, inspect the current Terms and Privacy Policy in your own terminal:

```powershell
circle terms show --init --output json
```

Only if you agree, accept them yourself using `circle terms accept`. SettlePilot never accepts Terms automatically.

Mainnet and testnet sessions are separate. If a testnet session is missing, start the **testnet** email login:

```powershell
circle wallet login YOUR_EMAIL --type agent --testnet --init
```

Replace `REQUEST_ID` and `OTP_FROM_EMAIL` with the values from this login request, and complete it in your own terminal:

```powershell
circle wallet login --type agent --testnet --request REQUEST_ID --otp OTP_FROM_EMAIL
```

Request IDs are single-use and expire. If the CLI reports an expired request, start a new login request instead of reusing it. Do not commit or screenshot OTPs or session material. Then verify:

```powershell
circle wallet status
circle wallet list --chain ARC-TESTNET --type agent --output json
```

Use the wallet address returned for **ARC-TESTNET** as the policy sender. Login normally provisions wallets. If no testnet wallet exists, follow the CLI's setup flow; the explicit creation command is `circle wallet create --testnet --output json`.

Find the CLI entrypoint required by the backend:

```powershell
$circleModuleRoot = (npm root -g).Trim()
$circleEntry = Join-Path $circleModuleRoot '@circle-fin/cli/dist/index.js'
Test-Path -LiteralPath $circleEntry
```

The result should be `True`. Save that path as `CIRCLE_CLI_ENTRYPOINT` in the local configuration. Use the same operating-system account for Circle login and the SettlePilot process, so it can access that account's session.

The Circle Agent Wallet path does not require importing a private key into the panel or supplying the separate developer-controlled-wallet entity secret fields. See [Circle's CLI documentation](https://developers.circle.com/agent-stack/circle-cli) for provider setup and version changes.

## 4. Configure testnet startup and authority

Model, Telegram and business-source connections are edited in the panel. Wallet mode, CLI path, RPCs and the initial financial policy are startup configuration in this release.

### Create local configuration without overwriting existing settings

If no `.env` exists, copy the example:

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
New-Item -ItemType Directory -Path 'data' -Force | Out-Null
if (-not (Test-Path -LiteralPath 'data/policy.json')) {
  Copy-Item -LiteralPath 'policy.example.json' -Destination 'data/policy.json'
}
```

If the panel already created `.env`, edit that file and retain its provider settings. Keep these files private and ignored by Git.

Set these startup values, replacing the placeholders locally:

```dotenv
TAMEION_MODE=testnet
WALLET_PROVIDER=agent
CIRCLE_CLI_ENTRYPOINT=C:/actual/path/to/@circle-fin/cli/dist/index.js
POLICY_FILE=data/policy.json
DATABASE_PATH=data/testnet.db
ARC_TESTNET_RPC_URL=YOUR_PRIVATE_ARC_TESTNET_RPC
SEND_ENABLED=false
BRIDGE_ENABLED=false
```

Use your unique Arc RPC issued by the Canteen CLI when participating in the contest. Keep the tokenized URL private. The application's historical `TAMEION_` variable names remain valid even though the product is called SettlePilot.

Always use a separate testnet database. A database is bound to its wallet backend and sender; changing `.env` does not convert simulation history into testnet history.

### Edit the policy

Replace the sender and allowlist placeholders in `data/policy.json`. Set:

| Field | Meaning |
| --- | --- |
| `chainId` | Must be `5042002` |
| `sender` | Your authenticated Arc Testnet Agent Wallet address |
| `allowlist` | Contractor recipients explicitly permitted for this installation |
| `reserve` | Protected USDC balance |
| `gasLimit` | Conservative gas allowance for each payout |
| `perObligation` | Maximum principal for one whole obligation |
| `totalBudget` | Cumulative principal budget for this database; it does not reset daily |
| `authorityExpiresAt` | Future ISO UTC expiry for the authority you grant |
| `enabled` | Whether the configured payment authority is enabled |

Policy amounts are **integer micro-USDC strings**: `"1000000"` means 1 USDC; `"100000"` means 0.10 USDC. Business export amounts, by contrast, use decimal strings such as `"0.10"`.

The example policy is disabled, expired and contains placeholders. Complete it before the first testnet startup. For an authority you have explicitly chosen to grant, initialize `enabled: true` and a future expiry while keeping `SEND_ENABLED=false`. If you intend to use CCTP, initialize the authorized bridge policy with `bridge.enabled: true` while keeping `BRIDGE_ENABLED=false`. This establishes the saved scope without enabling transfers. Generate an expiry you intend to authorize; for example, this prints a timestamp seven days ahead:

```powershell
[DateTime]::UtcNow.AddDays(7).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
```

For CCTP, add a `bridge` object to the policy, choosing only routes and limits you authorize. Example structure:

```json
"bridge": {
  "version": 1,
  "enabled": false,
  "sourceChains": ["BASE-SEPOLIA"],
  "maxAmount": "1000000",
  "maxFee": "10000"
}
```

This example allows a maximum net bridge amount of 1 USDC and a 0.01 USDC fee ceiling, with bridging still disabled. Add it inside the policy's top-level JSON object with the required separating comma. It is a configuration example, not a transfer request.

Supported source testnets and optional RPC overrides:

| Source chain | Environment variable |
| --- | --- |
| Ethereum Sepolia | `ETH_SEPOLIA_RPC_URL` |
| Avalanche Fuji | `AVAX_FUJI_RPC_URL` |
| Optimism Sepolia | `OP_SEPOLIA_RPC_URL` |
| Arbitrum Sepolia | `ARB_SEPOLIA_RPC_URL` |
| Base Sepolia | `BASE_SEPOLIA_RPC_URL` |
| Polygon Amoy | `MATIC_AMOY_RPC_URL` |
| Unichain Sepolia | `UNI_SEPOLIA_RPC_URL` |

### Restart and verify before enabling execution

Stop the existing server process and restart it from the project folder. With foreground startup, use Ctrl+C, then `npm start`. Rebuilding alone does not replace a running backend. The local installer's launcher reuses a healthy server and is not a restart command.

In **Authority & connections**, check the wallet connection, Arc Testnet identity, balances, recipients, limits and expiry. Fund your own testnet wallet with canonical testnet USDC using a supported faucet; simulation sample balances do not carry across.

After verifying a database initialized with the intended enabled policy, set `SEND_ENABLED=true` and restart to activate payouts within that saved scope. CCTP additionally requires an enabled saved bridge policy and `BRIDGE_ENABLED=true`. Sending and bridging are separate gates. Enabling source monitoring or the LLM alone does not turn them on. If you initialized the database with a disabled policy, editing the seed file is not an activation method.

General policy editing and authority renewal for an existing database are not implemented in this panel. One-time approvals support only the specific overridable rule named in a request; expired or disabled authority is not such an override. An existing installation needing a scope/expiry change requires a reviewed policy migration preserving its financial history.

The seed policy initializes a **new** database. Editing its principal budget or expiry does not silently replace the policy already persisted in an existing database; do not assume a restart grants more authority. A changed sender or bridge configuration can also be rejected against saved state. Keep the active panel's limits as the source of truth. Do not delete or replace a database with unresolved operations to work around a mismatch.

## 5. Connect business records

Open **Authority & connections → Automatic operations**.

1. Create or select an existing local folder that your business system exports to.
2. Enter its absolute path in **Business export folder**.
3. Enable **Trust structured acceptance fields from this source** only if that exporter is authorized to declare work accepted or disputed.
4. Enable **automatic evaluations** and save.

Your upstream system supplies obligations, expected receivables, parties, deadlines, acceptance status and evidence. SettlePilot includes a folder connector for versioned JSON/CSV exports. The [JSON schema example](examples/source-export.example.json) is an integration reference; replace its labelled sample data in the upstream exporter.

A record uses a stable `externalId` and an increasing `revision` when facts change. Reusing a revision with different content is quarantined. Payees must be registered and allowlisted. Free-text evidence cannot grant acceptance or payment authority. CSV supplies records; party mappings must already exist. The connector scans only the configured folder, not its subfolders.

After saving, **Overview** shows the worker and evaluation status. **Payments** shows imported obligations and incoming transfers. A clean testnet database has no business obligations until a source supplies them.

Daily users do not enter transaction hashes, CCTP routes or transfer amounts into forms. The Agent obtains technical facts from the connected sources and providers.

## 6. Use the Agent day to day

| Page | What to do |
| --- | --- |
| **Overview** | Observe connection health, mission status, balances and upcoming obligations |
| **Agent actions** | Resolve bounded requests through **Approve**, **Cancel** or **Comment**; export saved decision records |
| **Payments** | Follow imported obligations, incoming USDC, payout/bridge status and receipt links |
| **Authority & connections** | Configure models, source monitoring, Telegram and wallet checks |

### Understand payment readiness

**Cash against upcoming obligations** compares open liabilities due now, within 24 hours, 7 days and 14 days. These periods are cumulative and include work awaiting acceptance.

**Additional Arc funding needed** includes the configured reserve and a gas ceiling for every payout. **Gap after conditional CCTP** uses fresh, funding-enabled source balances after conservative fees and route limits. Open the calculation details for its assumptions.

Expected customer payments never count as available cash. Source funds and a pending bridge become spendable Arc funds only after verified mint and a fresh Arc observation. Stale observations show unknown coverage. Financial coverage alone does not establish acceptance or spending authority.

The LLM selects priorities and funding routes. If it proposes several individually eligible payments that collectively exceed cash or budget, it receives structured feedback and must revise its selection. The backend does not silently choose which contractor gets paid.

### Respond to an exception

Open the request in **Agent actions** and inspect its exact scope.

- **Approve** grants the specific authority offered by that request, bound to the obligation, policy, financial state and expiry. It cannot manufacture funds or bypass recipient, network, idempotency or receipt checks.
- **Cancel** rejects that proposal. It does not invent a dispute.
- **Comment** supplies instructions for the Agent to reconsider. Comment alone is not financial approval.

Operational uncertainty may offer instructions instead of payment approval. Changed facts can invalidate an approval. Resolve the current request rather than approving an old screenshot or notification.

**Pause operations** stops new submissions while reconciliation continues. Resume within current authority when ready. Keep one spending process per operating wallet.

### Read transaction states and export history

A plan, provider acceptance, transaction hash and verified settlement are different stages. Only a verified successful receipt for the expected chain, sender, recipient and amount marks a testnet payment settled. Simulation never produces a real hash.

In **Agent actions → Decision history**, select **Export decision**. It captures financial facts, document digests and final reviewed choices saved before execution, with execution outcomes labelled separately. New records survive restart; older runs have no reconstructed history.

To check an exported file's integrity locally:

```powershell
npm run verify:decision -- 'C:\path\to\settlepilot-decision.json'
```

The digest detects edits to the captured payload. It is not a signature or independent settlement proof; an editor can recompute a digest. Treat the export as private business data. The public showcase does not expose it.

## 7. Enable optional Telegram alerts

Open **Authority & connections → Telegram notifications**.

1. Enter your bot token and chat ID.
2. Enable notifications and save.
3. Send the optional generic connection test.

Settings apply without restart. Telegram is outbound-only: no commands, conversations or approvals are accepted there. All decisions stay on the local panel.

| Severity | Behaviour |
| --- | --- |
| **NORMAL** | Completion notification, sent once |
| **MEDIUM** | Unresolved owner action, repeated every six hours |
| **HIGH** | Action within 24 hours of its deadline, or an uncertain operation; repeated every 30 minutes while unresolved |

Alerts contain only generic severity and event class. Contractor names, invoices, amounts, wallet addresses, transaction hashes, evidence and owner instructions stay private. Delivery attempts persist in SQLite.

## 8. Restart, update and preserve data

Simulation defaults to `data/simulation.db`; testnet uses the configured `DATABASE_PATH`. SQLite persists obligations, policy, intents, decisions, memory and worker checkpoints. Restart does not reset the budget or erase unresolved operations.

Before updating, pause new submissions and allow known operations to reconcile. Stop the server cleanly, keep a private backup of the database and local configuration, obtain the updated source, then:

```powershell
npm ci
npm run build
npm start
```

If copying a live SQLite database, retain its `-wal` and `-shm` companions consistently, or make the backup after clean shutdown. Also protect the Circle session using Circle's supported recovery process. Do not put database/configuration backups in a public repository.

For an independent **simulation** rehearsal, use a new database filename. Do not run two independent financial databases against the same wallet.

## 9. Troubleshooting

| Symptom | Action |
| --- | --- |
| Panel does not open | Run `npm start` from the project folder and open the configured localhost port |
| Launcher cannot start | Check `data/panel-startup-errors.log` locally; run `npm ci` and `npm run build` if missing |
| Port already occupied | Choose a free launcher port; do not stop another application |
| SQLite experimental warning | Expected on the supported Node version; it is distinct from a startup failure |
| Rules baseline appears | Enable and save the primary model connection; verify endpoint type and key |
| Model request fails | Check the provider connection, model access and allowance; the run stops without assuming a payment |
| Jev holds a proposal | Inspect current review status; new facts or a scoped owner response may be needed |
| No imported obligations | Check the absolute export folder, schema, party mappings, revisions and source worker status |
| Source records quarantined | Correct the invalid upstream records; preserve their IDs and increment revisions |
| Wallet not found | Verify the Circle testnet session, OS account, CLI entrypoint and policy sender |
| Funds visible on another chain but no bridge | Check permitted routes, observation freshness, bridge gates, limits and current authority |
| Policy expired or budget exhausted | Inspect the current scope. An exact budget request may offer approval; expired authority requires a reviewed migration, not a comment or restart |
| Transaction response or hash missing | Keep the original intent and allow reconciliation; never create a replacement solely because of a timeout |
| Saved wallet/bridge policy mismatch | Restore the bound configuration and reconcile; do not erase the database to bypass the check |
| Telegram silent | Check enabled settings and chat access with a generic test; inspect delivery/worker status |
| Pause seems incomplete | Pending transactions still reconcile; pausing does not undo a submitted transaction |

## 10. Development and optional verification

```powershell
npm test
npm run build
```

The offline suite uses labelled fixtures. It does not spend funds, contact real models or send Telegram alerts.

Development UI: run `npm run dev` for the API and `npm run ui` in another terminal for Vite on port 5173.

Optional checks:

| Command | Effect |
| --- | --- |
| `npm run check:arc` | Reads Arc network/head/token metadata; no transaction |
| `npm run check:ai` | Calls configured models on a fixture; no wallet transaction |
| `npm run eval:liquidity` | Calls configured primary/Jev models on three synthetic portfolios with execution disabled; writes a labelled local report |
| `npm run audit:autonomous` | Runs the labelled offline 50-case autonomous suite |
| `npm run verify:decision -- FILE` | Checks the captured decision payload's digest |

Live model evaluation checks expectations and reports any unmet result, including a final hold after review. Its inputs are synthetic, not customer traction. These commands do not authorize financial activation or deployment.

## Status and supporting documentation

The public [SettlePilot showcase](https://settlepilot-mu.vercel.app) has a separate Vercel frontend and continuous VPS backend. This source increment is verified locally; new code is not automatically deployed by a local build. See [implementation status](docs/03-implementation-status.md) for dated onchain/provider evidence and outstanding activation/publication requirements.

- [Installation reference](docs/INSTALLATION.md)
- [Product scope](docs/01-product-scope.md)
- [Adaptive Agent loop](docs/06-adaptive-agent-loop.md)
- [Runtime instructions and memory](docs/12-hermes-inspired-agent-runtime.md)
- [Telegram behaviour](docs/13-telegram-notifications.md)
- [Current product improvement record](docs/28-product-intelligence-review.md)

Licensed under [MIT](LICENSE).
