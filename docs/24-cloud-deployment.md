# Vercel observer + continuous Render Agent

Decision recorded 2026-10-04. This is deployment preparation, not a running cloud integration.

Subsequent owner decision: use their existing VPS instead of provisioning Render, and use a Vercel-provided public hostname. See [the actual SettlePilot VPS/Vercel deployment](26-vps-deployment.md) for verified state and limitations. The Render instructions below are an alternative, not the active deployment.

## Architecture

Visitors → Vercel static observer → restricted GET proxy → one Render Node service → SQLite/Circle CLI/Arc Testnet.

Vercel receives only `DEMO_BACKEND_URL`, a server-only `PUBLIC_OBSERVER_TOKEN`, and the published `INSTALLER_REPO_URL`. Never prefix the token or model/wallet secrets with `VITE_`. The proxy allows state, schedule, selected-case logs and liveness only. It drops visitor authorization/cookies and rejects a mistakenly connected administration service. The browser contains no transaction controls.

Render runs one process, not a cron invocation. Its public listener accepts its exact hostname; administration remains at `127.0.0.1:4319`. The disk contains `simulation.db` or `testnet.db` plus SQLite WAL/SHM, `operator.env`, `policy.json` and `circle-cli/`. Redeploying must retain the same disk. Never scale this SQLite service to multiple instances or run a second executor against the same wallet.

Render's free service sleeps after inactivity and does not support persistent disks. Use a paid plan plus disk. The prepared Blueprint selects `0.5c-512mb`, Singapore and 1 GB; confirm current compute/disk pricing and owner approval before provisioning. Disk attachment causes a short interruption on redeploy. Auto-deployment is disabled so financial restarts stay deliberate.

Neon now offers Node 24 Functions in addition to PostgreSQL. Its official description says functions are requested HTTP handlers, not background job runners. Moving this daemon to Neon would require a PostgreSQL storage migration, transaction/lock/idempotency validation and another durable execution mechanism. It provides no drop-in replacement for SQLite files and Circle CLI session files. Keep it as a future scaling option.

## Prepare and provision, after owner approval

1. Publish the clean MIT local source as the approved installer repo, and clean showcase source as the approved demo repo. Do not push either working directory wholesale: local `.env`, SQLite, historical operator documents and artifacts stay private.
2. Import the demo repo's `render.yaml` as a Render Blueprint. Review charges before creation. Provide the real published installer URL and a newly generated random observer token of at least 32 characters through Render's secret environment editor. No token is printed in logs or committed.
3. The native Node build uses the application lockfile and separately locked Circle CLI 1.1.4 in `deployment/circle`. Startup selects the mounted disk and persists owner settings. It starts in simulation, with model calls, Telegram, daily admission and financial sends disabled unless explicitly configured. Do not copy the testnet example wholesale to enable cloud execution.
4. Confirm `/healthz` returns `{service:"tameion",surface:"public",status:"ok"}`. It is liveness only, not proof of RPC, model, wallet session or financial readiness. Read-only API requests without the observer token must return 403; writes remain blocked even with it.
5. Create a Vercel Vite project from the demo repo. Its `vercel.json` builds `dist-public` and the isolated GET proxy. Configure the backend HTTPS origin, the same server-only token, and installer repo URL. Verify online, offline, selected log export and mobile behavior. Never point it at port 4319.
6. Restart/redeploy once in simulation. Verify the same schedule, jobs, intent history and wallet binding survive. Only then prepare testnet configuration and fresh finite authority.

## Wallet and live activation

Use Render's authenticated SSH/shell for host setup. Set `CIRCLE_CLI_HOME=/var/data/circle-cli` and use `node deployment/circle/node_modules/@circle-fin/cli/dist/index.js`. Check wallet status before login. Circle Terms require explicit owner consent; do not set an automatic acceptance variable. Authenticate a dedicated testnet demo session; never copy the PC's credential directory into a Git repo or image. Confirm CLI version, session expiry and exact testnet sender. A persisted session can still expire; disk durability does not make authentication permanent.

Store private model/endpoint/key and Telegram settings in `/var/data/operator.env` (mode 0600), and the reviewed policy in `/var/data/policy.json`. Avoid duplicating these settings in Render environment variables: process environment takes precedence over file values and can override settings after restart. Change `TAMEION_MODE=testnet` only with a compatible policy and dedicated testnet database. Verify chain 5042002, every permitted CCTP source, allowlist, reserve, fee caps, expiry and cumulative budget. Enable model/review and observe a planning run before separately authorizing sends, bridging and daily admission. Old expired authority is never renewed automatically.

The user's operational requirement is approval from localhost on their PC. The cloud administrator listener remains loopback-only, but PC-to-cloud owner access has **not** been verified. Do not expose it publicly to bypass this gap. Validate an authenticated local tunnel or implement an approved owner relay before live daily activation; if approval is needed meanwhile, the Agent must hold and emit generic outbound Telegram alerts. Telegram is never a command channel.

## Restart, backup and recovery

SIGTERM stops admission and waits for active work for up to 35 seconds; Render gives 45 seconds. A longer provider operation may still be interrupted. Durable intent is saved before submission and reconciled after restart; an interrupted or unknown transaction is never assumed failed and resent. Test an uncertain outcome with isolated adapters before claiming production recovery.

Use SQLite's online backup API or stop the single worker before taking a complete, consistent database backup. Copying only a live `.db` while WAL writes occur is unsafe. Protect backups as private financial data. Render disk snapshots are not a substitute for a verified SQLite backup/restore procedure. Restoring an old financial state requires reconciling all onchain/provider outcomes before execution; do not replay old intents.

## Verification limits

Local tests/builds and isolated startup/restart do not prove a Render Linux deployment, Vercel function routing, cloud wallet login/renewal, local approval tunnel, onchain continuity or a 24-hour soak. Those are deployment acceptance gates, not completed claims. CLI dependency audit reports inherited advisories; review upstream fixes and validate a patched CLI before asserting hardened production readiness. No automatic dependency override is applied to wallet cryptography.

## Primary sources

- [Render free service limitations](https://render.com/docs/free)
- [Persistent disks and single-instance limitations](https://render.com/docs/disks)
- [Blueprint fields and shutdown delay](https://render.com/docs/blueprint-spec)
- [Render external hostname and environment](https://render.com/docs/environment-variables)
- [Render pricing](https://render.com/pricing)
- [Neon Functions and background execution boundary](https://neon.com/blog/neon-functions-backend-logic-next-to-your-data)
- [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)

Installed Circle CLI 1.1.4 source confirms `CIRCLE_CLI_HOME` overrides its default credential directory. Cloud authentication remains to be verified against the installed CLI and official Circle setup instructions.
