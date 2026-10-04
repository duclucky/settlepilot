# Dedicated VPS profile

Owner selected their existing VPS on 2026-10-04. The async-agent-arena connection identifies Ubuntu x86_64 at the existing `robinhood-vps` SSH alias. SettlePilot is a separate application; do not run Arena's restricted release wrapper or change its workloads.

## Approved scope and acceptance

- Create a locked Linux service user `settlepilot`, separate application releases, Node runtime, SQLite, settings and Circle CLI directory.
- Upload clean source over SSH without local credentials, database, operator history or personal Circle sessions. No GitHub publication is required for this deployment.
- Run one systemd service with restart on failure, graceful stop, bounded resources and private logs.
- Keep both listeners on loopback: observer backend 4337, owner panel 4339. Access the owner panel through an SSH tunnel bound to localhost on the owner's PC. Owner subsequently authorized the public Vercel domain; route only the observer through a separate HTTPS tunnel.
- Start in clearly labelled simulation with model calls, Telegram, daily scenarios, testnet transfers and bridging disabled. Existing financial authority has expired; deployment does not renew it.
- Verify Linux dependencies/build/tests, service identity, protected read-only observer API, blocked public writes, localhost tunnel, persistent database/settings after restart and unchanged Arena health.

## Paths and operations

`deployment/vps/install.sh` runs as root after upload through the existing administrator. It refuses a pre-existing unmanaged `settlepilot` profile, verifies the pinned Node download checksum and installs only inside `/opt/settlepilot` and `/home/settlepilot`. Configuration is `/home/settlepilot/state/operator.env` (0600); Circle credentials, when separately configured, use `/home/settlepilot/state/circle-cli` (0700). SQLite is mode-specific. Application releases are root-owned and read-only to the worker.

Service: `settlepilot-agent.service`. Restart with `sudo systemctl restart settlepilot-agent`; inspect bounded private logs with `sudo journalctl -u settlepilot-agent -n 50 --no-pager`. Never print populated settings or credentials. Observer token is generated on the VPS and never included in a source artifact or browser bundle.

The dedicated SSH key permits localhost forwarding only to ports 4337 and 4339, with no interactive shell or arbitrary remote command. The administrator retains deployment control. Tunnel command: `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4339:127.0.0.1:4339 settlepilot-vps`. The owner opens `http://127.0.0.1:4339`; no Telegram command channel is added.

## Activation limits

Install is not evidence of live AI, authenticated Circle wallet or real onchain settlement. Configure a dedicated session and private provider settings, verify the exact sender/chain, and obtain current finite testnet authority before enabling sends, bridging and daily admission. Backups must use SQLite online backup or stop the single worker before copying its complete state. Reconcile financial outcomes before restoring/replaying an older database.

## Deployment evidence

Completed on 2026-10-04:

- New Linux user `settlepilot`, uid 1002. Agent release `/home/settlepilot/releases/20261004T024341Z`; service enabled and active. Node 24.11.1 download SHA256 verified. Source and installed packages are root-owned; worker state alone is writable. Service limits: 1 GiB RAM, 100% of one CPU.
- Linux clean dependency installation, both application/public builds, and 217 tests passed. Local operator 191 tests and build passed after display renaming. Machine-facing `tameion` health identity and legacy environment names remain compatible; the displayed product/profile is SettlePilot.
- Owner settings and SQLite pause/obligation/intent identity survived an actual service restart. Verification settings restored to GPT-5.4 with model calls disabled. This does not prove wallet-session renewal, reboot survival, unknown live-transaction recovery or a 24-hour soak.
- Owner PC tunnel is running at `http://127.0.0.1:4339`, SSH alias `settlepilot-vps`, restricted dedicated key. Reopen with `Open-SettlePilotVPS.ps1`; no administration listener is public.
- Public Vercel project `duckys-projects-bc83c6a0/settlepilot`, deployment `dpl_S8WAPAEsaFvsb1pzrGx4kmUFAyAj`, site [settlepilot-mu.vercel.app](https://settlepilot-mu.vercel.app). Production HTML, health, state and schedule returned 200; private settings returned 404; POST operations returned 405; invalid log selection returned 400. Browser verified overview and installation. Public JS/CSS contained no observer token; private state arrays were empty.
- Vercel's primary TypeScript/Vite build passed. Its secondary function transpilation emitted TS2688 for missing Node type definitions while still publishing READY; function health/state/demo were subsequently verified live. This diagnostic remains to be resolved before claiming a completely clean provider build.
- Arena ISS still reported commit `fabc826`, API/web healthy, tunnel unchanged and the same localhost port 8080. No existing workload, domain, firewall rule or Docker stack was modified. Local server 4317 pid 18228 was preserved.

## Public connection limitation

The VPS has a private LAN address. A separate `settlepilot-observer-tunnel.service` currently runs Cloudflare Quick Tunnel 2026.9.3 (official binary SHA256 `77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2`), limited to observer port 4337; metrics stay on localhost 20241. It has a separate process, no Arena credentials/configuration, 256 MiB memory and 25% CPU limit. The observer requires its server-only token and rejects writes even with it.

Quick Tunnels are for testing, have no uptime guarantee and receive a new hostname when recreated. Vercel's `DEMO_BACKEND_URL` will need updating and a redeploy after that happens. The public Vercel hostname remains stable. Use a dedicated named tunnel/stable HTTPS origin before claiming unattended long-term service; no workaround exposes the owner port. [Official Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Initial deployment contained no provider credentials or Circle session. The owner subsequently requested full connections: primary GPT-5.4 and Jev planning-only requests and a generic Telegram test are now verified; see `docs/27-live-connections.md`. Circle's new-machine Terms consent, wallet session connection, send/bridge/daily activation and fresh finite financial authority remain outstanding. The public site still labels simulation and waiting for activation. GitHub installer publication remains outstanding.
