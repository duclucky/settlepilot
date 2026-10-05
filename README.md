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
```

After this one-time setup, close PowerShell and **double-click `Open-SettlePilot.vbs`**. This is the normal daily launcher: PowerShell and the backend run hidden; only your default browser opens **http://127.0.0.1:4317**. It reuses an existing healthy local panel. Leave the server running while the Agent works. A startup failure shows a dialog instead of a console window. If Windows blocks a downloaded script or Windows Script Host is unavailable, follow your device's script policy or use the manual console option below.

For a different port with the same hidden startup:

```powershell
wscript.exe .\Open-SettlePilot.vbs 4327
```

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

Open **Setup → LLM connection**.

1. Enable the primary model.
2. Enter the **endpoint**, **model** and **API key** supplied by your provider. The supported primary API is **OpenAI Responses-compatible**; a Chat Completions-only endpoint is not interchangeable.
3. For the demonstrated OpenAI configuration, use `https://api.openai.com/v1/responses` and model `gpt-5.4-mini`.
4. Enable Jev if you want typed review of financial proposals. Its default endpoint is `https://api.typesafe.ai/v1/systemone`, model `jev-latest`, and minimum confidence `0.80`. Enter your own Jev API key.
5. Save. The planner changes for the next evaluation without a server restart. Wait for any active evaluation to finish before changing providers.

Keys are write-only: the panel shows whether a key is configured and never returns its value. Saving writes the ignored local `.env`. Later saves can retain an existing key without re-entering it. Model configuration does not enable testnet transfers.

When enabled, the providers receive obligation summaries and requested business evidence. Provider calls consume your configured allowance. Use data you permit those providers to process. Wallet private keys and Circle session credentials never enter model context.

The model reads operating instructions, current policy, skill descriptions and bounded memory, then calls tools to inspect evidence, balances and feasible plans. Jev returns `ALLOW`, `REVIEW` or `BLOCK`; low-confidence or unsafe financial proposals can be held for new facts or owner input.

### Model usage and recovery

Open **Setup → AI cost & budget** to see today's requests, reported tokens, outstanding reservations and known-price cost estimates. The day resets at 00:00 UTC, with the next reset displayed in your local time. Unknown provider prices are explicitly shown as unavailable; their requests still consume token and request allowances.

Open **Set model usage limits** to set request, token and estimated USD allowances for each evaluation and UTC day. Review the values, check the confirmation box and save. Changes apply to the next admitted request, survive restart, and retain consumed usage and reservations. Set provider billing limits as well: application cost estimates are not invoices or guaranteed billing caps.

Defaults are 40 requests, 250,000 tokens and $0.50 in known-price allowance per evaluation; 120 requests, 500,000 tokens and $1.00 per UTC day. Historical `LLM_MAX_RUN_REQUESTS`, `LLM_MAX_DAY_REQUESTS`, `LLM_MAX_RUN_TOKENS`, `LLM_MAX_DAY_TOKENS`, `LLM_MAX_RUN_COST_NANO_USD` and `LLM_MAX_DAY_COST_NANO_USD` environment values initialize defaults. Owner limits saved in SQLite take precedence.

Every request reserves capacity before contacting the provider. Reported usage replaces the reservation; timeouts and missing usage retain it. Authentication, exhausted credit and configuration failures block repeated calls, while temporary failures have a cooldown. After fixing the provider issue, use **Recover a blocked model connection**, confirm and choose **Clear connection blocks**. Clearing blocks preserves usage, limits and the current pause state.

Routine polling and scheduled rechecks do not call the model again after the same facts have been evaluated. New funds, evidence, owner responses, meaningful deadline transitions or a model configuration/reset can require another evaluation. Empty payment portfolios with no actionable unmatched receipts make no planner calls. Temporary provider errors wait at least five minutes before a bounded scheduler retry; restarting does not renew that retry allowance. Repeated tools, consecutive errors and notes that do not advance the decision stop the evaluation. Changing liquidity allows at most one immediate replan; verified CCTP settlement resumes through a saved scheduler job rather than recursive model calls.

The Agent freezes its instruction files, skill contents and bounded memory for each evaluation. Skills are sent only when needed, with short repeat-read results. Saved runs contain a hash manifest identifying their context; the full financial history remains in SQLite.

## 3. Connect your own Circle Agent Wallet

Skip this section to stay in simulation. A real testnet installation needs your own Circle session, wallet, private Arc RPC, policy and separate database.

### Connect from the Setup page

1. Install the supported **Circle CLI 1.1.4** once, using your own Windows account:

   ```powershell
   npm install -g @circle-fin/cli@1.1.4
   ```

2. Open **Setup → Your Agent Wallet → Check Circle connection**. The panel discovers the supported global CLI installation; it does not install or update software automatically.
3. If Terms acceptance is required, read the current links and notice shown by Circle. Check the explicit consent box and choose **Accept Circle Terms** only if you agree. Terms are never accepted automatically.
4. If you have no valid testnet session, enter your email and choose **Send sign-in code**. Enter the OTP from your email and choose **Verify code**. The OTP is transient and never saved in SettlePilot history, browser storage, logs or `.env`. An existing valid testnet session is reused; it is not silently replaced with another account.
5. Choose the **Arc Testnet Agent Wallet** from the verified Circle list. If your connected account has no wallet, the panel offers **Create testnet Agent Wallet**.
6. Enter your **Arc Testnet RPC URL**. Use your unique Canteen RPC for the contest. The panel checks chain ID **5042002**, verifies that the wallet belongs to your Circle testnet session, and saves the connection. The tokenized RPC URL is write-only. A later save can leave it blank to retain the saved value.
7. Pause operations and allow submitted transactions to reconcile. Choose **Stop panel to apply setup**, then double-click **Open-SettlePilot.vbs**. The browser opens with the saved startup configuration; PowerShell and the backend remain hidden. The stop control refuses active evaluations or unresolved financial operations. Reopening a launcher without stopping a healthy server only reuses it.

A first connection creates a **separate, empty testnet workspace** with an empty recipient allowlist, disabled/expired authority, and `SEND_ENABLED=false` / `BRIDGE_ENABLED=false`. Simulation records, balances and the maintainer's wallets do not carry over. Saving a connection never grants spending authority. For an existing testnet installation, setup preserves its financial history, policy and execution flags and refuses to switch its wallet identity or provider. Configure the authority described below before permitting operations.

Saved model and Telegram keys are retained. The Circle Agent Wallet path does not request a wallet private key or the developer-controlled-wallet entity secret. Circle must run under the same OS account as SettlePilot.

### Alternative terminal connection

If you use a custom npm global directory that the panel cannot discover, complete the CLI session in your own terminal and set the validated CLI entrypoint in your ignored `.env`:

```powershell
circle wallet status --type agent --output json
circle terms show --init --output json
# Only if you agree to the displayed current Terms:
circle terms accept --output json
circle wallet login YOUR_EMAIL --type agent --testnet --init
circle wallet login --type agent --testnet --request REQUEST_ID --otp OTP_FROM_EMAIL
circle wallet list --chain ARC-TESTNET --type agent --output json
$circleModuleRoot = (npm root -g).Trim()
$circleEntry = Join-Path $circleModuleRoot '@circle-fin/cli/dist/index.js'
Test-Path -LiteralPath $circleEntry
```

Replace email, request ID and OTP locally; never commit or screenshot session material. Set `CIRCLE_CLI_ENTRYPOINT` to the verified path, reopen the panel, and return to Setup. See [Circle's CLI documentation](https://developers.circle.com/agent-stack/circle-cli) for the provider contract.

## 4. Grant spending permission in Setup

After connecting your own Circle Agent Wallet and restarting, open **Setup → What may the Agent pay?**. Pause operations before changing the scope. Wait for any submitted payments or CCTP transfers to finish reconciliation.

1. Add approved recipient addresses, one per line. If business records already contain counterparties, use **Add [name]** to select an existing address. Review each address yourself; importing records does not authorize recipients.
2. Enter the USDC reserve to retain on Arc, maximum payment gas allowance, maximum principal per whole obligation and total payout budget. These fields use decimal USDC amounts, with up to six decimal places. The total budget includes payouts already completed in this workspace; renewing authority never resets spent USDC.
3. Choose an expiry in your local time, within the next year. Expired authority prevents new financial execution.
4. If needed, enable crosschain funding and choose the approved source testnets, maximum amount per bridge and maximum fee. Funds become available on Arc only after the mint receipt is verified.
5. Choose **Review spending permission**. Review the exact wallet, recipients, amounts, routes and expiry, check the authorization box and choose **Grant permission**. The backend verifies the wallet and Arc Testnet chain ID **5042002** before saving. If wallet state or policy changed during review, refresh and review the latest scope.
6. Open **Enable payment sending**, choose the payout/CCTP switches you authorize, check the confirmation box and save. Use **Your Agent Wallet → Stop panel to apply setup**, then reopen **Open-SettlePilot.vbs**. Sending switches take effect after restart. Permission and model budget edits apply without restart.
7. Check **Overview** for remaining prerequisites. Connect business records and enable automatic evaluations when ready; resume operations if paused.

**Revoke permission & pause** disables new work immediately. Submitted operations and their evidence remain available for reconciliation. To renew or change scope, edit the fields and review a new grant. One-time exception approvals never replace disabled or expired general authority.

The initial `data/policy.json` seed stays disabled and expires in the past. After initialization, the versioned authority in SQLite is the source of truth. Editing the seed file cannot replace an existing scope. Sender/provider changes still require a reviewed migration preserving wallet identity and unresolved transaction history. Never delete a database to bypass that binding.

The historical startup variables `SEND_ENABLED` and `BRIDGE_ENABLED` remain supported; Setup saves those switches in the ignored `.env`. Connection secrets stay private. Simulation and testnet use separate databases, and sample balances never become testnet funds.

## 5. Connect business records

Open **Setup → Automatic operations**.

1. Create or select an existing local folder that your business system exports to.
2. Enter its absolute path in **Business export folder**.
3. Enable **Trust structured acceptance fields from this source** only if that exporter is authorized to declare work accepted or disputed.
4. Enable **automatic evaluations** and save.

Your upstream system supplies obligations, expected receivables, parties, deadlines, acceptance status and evidence. SettlePilot includes a folder connector for versioned JSON/CSV exports. The [JSON schema example](examples/source-export.example.json) is an integration reference; replace its labelled sample data in the upstream exporter.

A record uses a stable `externalId` and an increasing `revision` when facts change. Reusing a revision with different content is quarantined. Payees must be registered and allowlisted. Free-text evidence cannot grant acceptance or payment authority. CSV supplies records; party mappings must already exist. The connector scans only the configured folder, not its subfolders.

After saving, **Overview** shows the Agent status and unpaid queue. **Agent log → Agent plans & connection health** shows workers and evaluations. **Payments** shows imported obligations and incoming transfers. A clean testnet database has no business obligations until a source supplies them.

Daily users do not enter transaction hashes, CCTP routes or transfer amounts into forms. The Agent obtains technical facts from the connected sources and providers.

## 6. Use the Agent day to day

| Page | What to do |
| --- | --- |
| **Overview** | See customer receipts, remaining obligations and who needs payment first |
| **Your decisions** | Resolve exact requests through **Approve**, **Cancel** or **Comment** |
| **Agent log** | Read saved decisions, export a decision record, inspect plans and worker health |
| **Funds** | Read the Arc balance, liquidity forecast and current spending authority |
| **Payments** | Follow imported obligations, incoming USDC, payout/bridge status and receipt links |
| **Setup** | Configure the model, Circle Agent Wallet, business source and optional Telegram |

### Understand payment readiness

**Cash against upcoming obligations** compares open liabilities due now, within 24 hours, 7 days and 14 days. These periods are cumulative and include work awaiting acceptance.

**Additional Arc funding needed** includes the configured reserve and a gas ceiling for every payout. **Gap after conditional CCTP** uses fresh, funding-enabled source balances after conservative fees and route limits. Open the calculation details for its assumptions.

Expected customer payments never count as available cash. Source funds and a pending bridge become spendable Arc funds only after verified mint and a fresh Arc observation. Stale observations show unknown coverage. Financial coverage alone does not establish acceptance or spending authority.

The LLM selects priorities and funding routes. If it proposes several individually eligible payments that collectively exceed cash or budget, it receives structured feedback and must revise its selection. The backend does not silently choose which contractor gets paid.

### Respond to an exception

Open the request in **Your decisions** and inspect its exact scope.

- **Approve** grants the specific authority offered by that request, bound to the obligation, policy, financial state and expiry. It cannot manufacture funds or bypass recipient, network, idempotency or receipt checks.
- **Cancel** rejects that proposal. It does not invent a dispute.
- **Comment** supplies instructions for the Agent to reconsider. Comment alone is not financial approval.

Operational uncertainty may offer instructions instead of payment approval. Changed facts can invalidate an approval. Resolve the current request rather than approving an old screenshot or notification.

**Pause operations** stops new submissions while reconciliation continues. Resume within current authority when ready. Keep one spending process per operating wallet.

### Read transaction states and export history

A plan, provider acceptance, transaction hash and verified settlement are different stages. Only a verified successful receipt for the expected chain, sender, recipient and amount marks a testnet payment settled. Simulation never produces a real hash.

In **Agent log → Decision history**, select **Export decision**. It captures financial facts, document digests and final reviewed choices saved before execution, with execution outcomes labelled separately. New records survive restart; older runs have no reconstructed history.

To check an exported file's integrity locally:

```powershell
npm run verify:decision -- 'C:\path\to\settlepilot-decision.json'
```

The digest detects edits to the captured payload. It is not a signature or independent settlement proof; an editor can recompute a digest. Treat the export as private business data. The public showcase does not expose it.

## 7. Enable optional Telegram alerts

Open **Setup → Optional Telegram notifications**.

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
| Model request fails | Check the connection, model access, usage ledger and provider allowance. Fix a sticky provider failure before explicitly resetting blocks; incomplete responses stop without sending money |
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

The public [SettlePilot showcase](https://settlepilot-mu.vercel.app) has a separate Vercel frontend and continuous VPS backend. The current product update is deployed; a local build does not automatically deploy later changes. See [implementation status](docs/03-implementation-status.md) for verification and outstanding financial activation requirements.

- [Installation reference](docs/INSTALLATION.md)
- [Local workspace and Setup](docs/35-local-workspace-and-setup.md)
- [Product scope](docs/01-product-scope.md)
- [Adaptive Agent loop](docs/06-adaptive-agent-loop.md)
- [Runtime instructions and memory](docs/12-hermes-inspired-agent-runtime.md)
- [Telegram behaviour](docs/13-telegram-notifications.md)
- [Current product improvement record](docs/28-product-intelligence-review.md)

Licensed under [MIT](LICENSE).
