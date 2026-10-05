# Install SettlePilot locally

SettlePilot runs on your own computer. The public website is a read-only daily demonstration using the maintainer's separate wallet; installing this source never imports that wallet, API keys, balances or transaction history. The detailed current installation and usage guide is in [README](../README.md).

## First startup

Install Node.js 24.11+ and Git. Download/extract the installer repository ZIP or clone the published repository, then open PowerShell in its folder:

```powershell
npm ci
npm run build
```

Close PowerShell after this one-time setup and double-click **Open-SettlePilot.vbs**. PowerShell and the backend run hidden; only the browser opens.

The panel opens at `http://127.0.0.1:4317`. You can also run `npm start` and open the URL yourself. No `.env` is needed for the first simulation startup. Keep the server running while the Agent works. This is a localhost panel, not an internet-facing administration service.

## Models and notifications

Open **Setup → LLM connection**. Enter the primary model, Responses-compatible endpoint and API key; the default model is `gpt-5.4-mini`. Configure Jev under **Optional Jev review**. Saving applies the connection locally; keys remain write-only in the ignored `.env`. Do not put keys in issues, screenshots, Git commits or the public website.

Telegram is optional. In **Setup → Optional Telegram notifications**, configure the bot token and chat ID. Alerts are generic and graded by urgency. Telegram cannot issue commands or approvals; respond on the local panel.

## Agent Wallet and financial authority

Install Circle CLI 1.1.4 once, then open **Setup → Your Agent Wallet**. Check the connection, review Circle's current Terms if needed, and authenticate through email/OTP. Select your Arc Testnet wallet and supply your private Arc RPC. Saving verifies the wallet and network and keeps transfers disabled for a new workspace. Pause operations, stop the idle panel using its Setup control, then reopen **Open-SettlePilot.vbs**. Pending operations must reconcile first. See [README](../README.md) for the complete flow and alternative terminal setup.

For the one-time testnet startup configuration:

1. Create an ignored `.env` from `.env.example` only when you have the necessary connections. Keep `SEND_ENABLED=false` and `BRIDGE_ENABLED=false` during setup. Do not overwrite the `.env` already created by the settings panel.
2. Copy `policy.example.json` to ignored `data/policy.json`; set your sender, explicitly allowed recipients, reserve, gas allowance, per-obligation limit, cumulative budget and authority expiry. Policy amounts are **integer micro-USDC**, not decimal USDC. One USDC is `1000000` units.
3. Set `TAMEION_MODE=testnet`, `WALLET_PROVIDER=agent`, `CIRCLE_CLI_ENTRYPOINT`, `POLICY_FILE` and a separate `DATABASE_PATH=data/testnet.db`. Configure Arc RPC and permitted CCTP source-chain RPCs. Keep tokenized RPC URLs private.
4. Restart the server and verify the wallet address, chain, observed balances and active limits on the panel. A cumulative budget does not reset daily. Enable sending/bridging only for the scope you authorize.

Setup saves the wallet connection and creates a disabled initial policy when none exists. It does not edit arbitrary financial authority. The seed policy initializes a new database only; changing it does not replace the policy in an existing database. A wallet or authority change for an existing database requires a reviewed migration preserving its history. Do not reuse simulation history for a real testnet wallet.

## Business records

Open **Setup → Automatic operations**. Select the folder where your business exporter writes versioned records, then enable evaluations. Grant structured acceptance authority only to a source you trust. The schema is in [source-export.example.json](../examples/source-export.example.json); it is an integration reference, not a daily transaction form. Payees still require the policy allowlist.

The Agent observes balances and records, checks evidence, selects payment/funding/hold, and reconciles operations. Only verified Arc funds are spendable. Burned or pending crosschain money is not an Arc balance. Daily interaction is limited to scoped Approve, Cancel or Comment requests when the Agent cannot resolve a case in its current authority.

## Recovery

- Panel unreachable: run `npm start` in PowerShell and inspect its local startup status.
- Provider/RPC unavailable: check connection and worker status; restore the connection locally.
- Missing transaction response: reconcile the existing intent. Do not create a replacement payment or bridge because no hash has appeared.
- Insufficient funds: the Agent examines allowed source balances before requesting help. Expired authority or exhausted budget cannot be silently extended.

## Optional Canteen CLI

[Canteen's developer tooling](https://arc-canteen.dev/) supplies context and a personal Arc RPC after GitHub sign-in. `arc-canteen context sync` downloads Arc/Circle references. It supplements the Circle CLI wallet backend; the two tools have different roles. `arc-canteen wallet` can display sensitive wallet material, so use it privately in your own terminal.

Project maintainers can apply to [Arc Open Source Showcase](https://arc-canteen.dev/arc-oss/) with `arc-canteen submit-showcase` or the linked Google form after the live site and public source are ready. That submission is separate from installing or running Tameion.
