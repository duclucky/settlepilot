# Free hosting assessment — 2026-10-04

Scope: research only; no new cloud account, deployment, subscription, wallet login or transaction is authorized by this assessment. The previous Render Blueprint is prepared, not selected/provisioned irrevocably. Keep Vercel as the observer UI and the existing single-process SQLite backend.

## Findings

| Provider | Published offer | Fit for the current Agent |
| --- | --- | --- |
| Railway | Trial $5 for up to 30 days, then Free $1/month; Free allows one replica, 512 MB RAM and a 0.5 GB volume | Technically suitable with a persistent mount and sleeping disabled. Credit alone does not guarantee a whole month of continuous compute. Trial network verification must allow RPC/model/Circle/Telegram access. |
| Oracle Cloud Always Free | Two AMD micro VMs (1 GB each) or an Arm A1 allowance equivalent to 2 OCPU/12 GB, plus 200 GB combined boot/block storage in the home region | Closest long-term free VM fit without changing SQLite. Requires account/card verification, available capacity and owner-managed Linux service/backup/TLS. Idle instances can be reclaimed. Arm CLI compatibility must be tested; AMD is simpler for the first deployment. |
| Northflank Developer Sandbox | Two free services, one database, two jobs, always-on compute | Promising managed compute. The feature table includes volumes on Developer, but does not establish a free persistent-volume allowance; general disk pricing is $0.15/GB/month. Confirm actual volume entitlement and bill before claiming this stack is completely free. A free PostgreSQL addon is not a drop-in SQLite replacement. All users must add a payment method. |
| Google Compute Engine | One non-preemptible e2-micro in selected US regions and 30 GB standard persistent disk | Runs a daemon and preserves SQLite. Ordinary external IPv4 costs $0.005/hour after one free hour, about $3.60 in a 30-day month. Do not promise a $0 deployment using ordinary IPv4/NAT. Only 1 GB outbound monthly is included for eligible destinations. |
| Render Free | Free web compute with inactivity suspension; no persistent disk | Unsuitable for the unchanged continuous SQLite/session design. Paid Render remains the simple prepared option. |
| Koyeb Free | 512 MB, one free web instance, sleeps after one hour without traffic, no volumes/worker service | Unsuitable for unchanged persistence and continuous reconciliation. |
| Fly.io trial | Two total VM hours or seven days, whichever ends first | Short verification only, not ongoing free hosting. |
| ClawCloud Run | Search results still advertise old recurring $5 credit | Excluded: the official April 2026 notice ends free-tier service on May 11, 2026. Live website/DNS is inaccessible from this environment. Old indexed pricing must not be used as a recommendation. |

The Node runtime in a short isolated Windows simulation used about 99.4 MiB resident memory. This is not a Railway cgroup billing measurement or a peak for Circle CLI/LLM calls. For illustration only, Railway's published $10/GB/month RAM rate makes 0.25 GB average memory cost $2.50/month before CPU, storage and egress, exceeding the $1 Free allowance. Measure 24–72 hours on the actual target before estimating this Agent's bill.

## Recommendation and acceptance

Prioritize Oracle Always Free when the owner wants ongoing free infrastructure and can obtain a suitable VM. Treat capacity, reclamation and backup as real constraints. Keep Railway as the easier limited-credit evaluation or $5/month Hobby fallback. Northflank is a secondary candidate pending a concrete storage quote. Do not change the data store solely to chase a free database offer.

Any target needs one executor instance, durable DB/WAL plus Circle CLI directory, explicit hostname validation, private localhost administration, server-only observer token, Node 24.11+, a verified cloud wallet session, exact testnet identity, current finite spending authority, and restart/reconciliation/backup tests. The local settings file must survive redeployment. Model API costs remain separate from hosting credits. A free platform does not imply a free end-to-end LLM Agent.

No provider-specific implementation is started solely from this research. Choosing a provider is not authorization to accept account Terms, bind a card, publish or buy resources.

## Primary sources

- [Railway pricing](https://docs.railway.com/pricing), [plans and volume caps](https://docs.railway.com/pricing/plans), [trial/network/retention](https://docs.railway.com/pricing/free-trial), [volumes](https://docs.railway.com/volumes)
- [Oracle Always Free limits and reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [account verification](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Northflank pricing and free always-on tier](https://northflank.com/pricing), [payment-method requirement](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)
- [Google Compute free quota](https://docs.cloud.google.com/free/docs/free-cloud-features), [external IP pricing](https://cloud.google.com/vpc/network-pricing)
- [Render Free](https://render.com/docs/free), [Koyeb free limitations](https://www.koyeb.com/docs/reference/instances), [Fly.io trial](https://docs.fly.io/about/free-trial)
- [ClawCloud official discontinuation notice](https://question.run.claw.cloud/questions/10010000000003261)

Checked official documentation and the Northflank pricing page directly; cloud dashboard entitlements and actual Linux deployment remain unverified.
