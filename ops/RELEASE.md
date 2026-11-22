# NM-AI-06 Solo Founder staging

Default branch `main` needs this workflow before GitHub can dispatch it. The workflow PR contains operations files only. Application source is checked out from exact SHA `81a1cca134dd797820023d053a98c73e8d21c81d`, verified against Studio CI run 44860248725. This replaces the old release instructions in the application candidate and operations history.

## Configure once

1. Keep the repository private and maintain Founder-only write access for the solo model. Merge the operations-only workflow PR into `main`. This enables manual dispatch and does not start a deploy.
2. In **Settings → Secrets and variables → Actions → Variables**, set `STUDIO_PRODUCTION_D1_ID` to the real, distinct production UUID. It is compared for exclusion and is never queried. The existing Cloudflare staging account and database are pinned in source.
3. In **Settings → Environments → nepmui-staging**, add environment secrets `CLOUDFLARE_API_TOKEN`, `STAGING_ADMIN_SECRET`, `STAGING_AUTH_PEPPER`, and `STAGING_RECOVERY_KEY`. Keep these last three as distinct 32-byte hex values. Preserve setup and password-verification keys already in use. Keep the recovery key separately from the artifact. The token needs read access to staging Worker routes/schedules and staging account D1 metadata, plus Worker deployment and D1 migration permissions for the existing staging target within Cloudflare's available scope. Do not grant unrelated account or zone permissions. Confirm Free usage and headroom. Optional `STAGING_CHANNEL_ENCRYPTION_KEY` must also be distinct.
4. For benchmark, add environment secrets `STAGING_BENCHMARK_EMAIL` and `STAGING_BENCHMARK_PASSWORD` and environment variable `STAGING_BENCHMARK_WORKSPACE` for a dedicated Brand Admin in an isolated synthetic workspace.

The repository's actor check prevents accidental or unauthorized dispatch under the assumed solo access model. It cannot protect secrets from a person allowed to modify workflows that receive those secrets. Periodically confirm the repository has no other writers or active deployment workflows.

## Release

1. In Cloudflare, drain staging work and stop alternate routes, service/queue writers and direct staging D1 writes. On the staging Worker disable workers.dev and previews and remove Cron Triggers. Wait for in-flight requests and jobs to finish. The workflow checks the visible route, schedules, custom domains, pending mock work and unchanged Time Travel/snapshot evidence. The operator remains responsible for external writers.
2. In **GitHub → Actions → Deploy Studio staging → Run workflow**, choose branch **main**, phase **release**, and dispatch as `haonguyen97ftu`. Create a fresh dispatch following any failed attempt and review partial state first. Rerun is disabled.
3. The build job receives no deployment secrets. The second job verifies the prebuilt bundle and the staging D1 identity, uploads the AES-GCM encrypted recovery evidence for seven days, and verifies it before applying pending migrations. It requires the exact ordered 0001–0005 ledger and verifies preservation before use of the 0005 readiness marker. It deploys with provisioning disabled. Both Messenger flags remain disabled. Smoke requires the exact release marker, signed-out protections and disabled Messenger. The published settings restore the normal staging route and schedules. If smoke fails, inspect the release and route before continuing. A restore requires a separate decision.
4. If the app is uninitialized, complete Founder setup on staging first. Create or select the dedicated synthetic account and workspace, then dispatch **benchmark** from **main**. The benchmark phase checks the same deployed SHA and runs the original 13 scenarios and two multi-turn tests, restoring the prior model configuration afterwards. It does not migrate or deploy.

The operations CI uses a disposable D1 database. No deploy, hosted backup, migration, restore or benchmark occurs in that CI.
