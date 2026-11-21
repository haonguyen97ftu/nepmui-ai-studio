# Staging deployment — NM-AI-04.3 approval gate

The existing hosted staging URL is https://nepmui-ai-studio-staging.haonguyen-drew.workers.dev. Its last approved runtime is NM-AI-03. **NM-AI-04 schema and code have not been deployed there.** Continue using the existing Workers Free/D1 resources, `ops/nm-ai-deploy-01` GitHub Actions workflow and `nepmui-staging` protected environment. Do not create a paid service or production release.

The user requires migration/security review to pass and deployment approval before any hosted schema operation. See [migration evidence and recovery](MIGRATION_REPORT.md). The current `deploy:staging` helper requires `STUDIO_PLATFORM_MIGRATION_READY=0005_webhook_replay.sql`; that operational flag is not approval by itself and must only be set after the approved backup, migration and checks below.

## Before requesting deployment approval

Run Node.js 24 `npm ci`, lint, typecheck, `build:worker`, all unit/integration tests, `test:authorization`, `test:mutation`, `build:staging`, Playwright and `migration:report` against disposable D1. Review security regressions, the migration report and screenshots in PR #1. The checked-in Studio CI workflow runs these checks with disposable D1. The operations workflow and protected environment are separate release dependencies. Confirm their ref, approval controls and supported inputs before an approved hosted run.

Prepare the new private runtime secret file outside the repository. Preserve the existing staging `ADMIN_SECRET` until founder bootstrap completes. Add an independent random 32-byte `AUTH_PEPPER` encoded as 64 hex characters. Add a third independent random 32-byte `CHANNEL_ENCRYPTION_KEY` only when encrypted token storage is needed; mock Pages work without it. All keys must be distinct. Store them in the approved secret manager, never a PR, command transcript or browser API.

Do not rotate `AUTH_PEPPER` blindly: account password verification depends on it. Page-key replacement likewise requires re-encryption or token re-entry/verification. The deploy helper accepts only those three secret names, validates their format/distinctness and removes inherited overrides before invoking the pinned `cf` CLI.

## Approved staging sequence

1. Pin the reviewed full 40-character feature SHA in the existing operations workflow. Keep the environment approval/concurrency controls and both real Messenger flags false. Add the independent auth pepper and optional Page key from protected Actions secrets to its private temporary JSON secret file; do not print them.
2. Quiesce staging writes and pending mock jobs for the backup window. Set `STUDIO_STAGING_BACKUP_APPROVED=NM-AI-04` only after founder approval, then run `npm run backup:staging` with the existing scoped Cloudflare API token, account ID and separate staging D1 ID. The helper records a current D1 Time Travel bookmark and baseline counts, checks that the recovery point did not move during verification, and writes a mode-0600 recovery file in a private directory outside the repository. Transfer it to approved private storage. Never publish it with test screenshots. No backup helper has been run against hosted D1 during implementation.
3. Confirm the backup is within the account's Time Travel recovery window and that the database ID is the separate staging database, not production. The pinned CLI has no `cf d1 export`; Cloudflare also documents export restrictions for databases containing FTS virtual tables. **Do not drop the FTS index to make an export work.** The approved recovery mechanism here is a verified Time Travel point, not a portable SQL dump.
4. List and apply only pending migrations with the existing CLI:
   ```bash
   npx cf d1 migrations list "$STUDIO_STAGING_D1_ID" --mode staging
   npx cf d1 migrations apply "$STUDIO_STAGING_D1_ID" --mode staging
   ```
   Confirm `0003_platform.sql`, `0004_founder_invariant.sql` and `0005_webhook_replay.sql` are in the applied ledger, alongside existing NẾP MÙI records/settings/versions, legacy usage and pending outbox counts, FTS retrieval and `PRAGMA foreign_key_check`. Migration 0004 refuses an existing account set without an active Super Admin; stop and obtain a separate recovery decision rather than promoting an arbitrary account. Record the actual migration ledger and protected backup reference. Allow for migration 0005’s five-minute live-ingress quarantine and cutoff for pre-migration events. Keep Messenger disabled. Migration is forward-only; do not edit already-applied migration files.
5. After those checks, set `STUDIO_PLATFORM_MIGRATION_READY=0005_webhook_replay.sql` in that approved job and run `npm run deploy:staging` with `STUDIO_STAGING_SECRETS_FILE` pointing to the private file. The helper pins staging mode, rejects the production/placeholder database, disables provisioning and never applies migrations implicitly. Clear temporary files after the job.
6. Check signed-out admin routes return 401 and live Messenger ingress returns 403. If the account table is empty, use the existing founder setup key once; it grants setup/session operations only, never management access. Complete the founder-account form using a strong password. If the response is lost after account commit, sign in using those account credentials; do not try normal account creation with the legacy key. For an already initialized workspace, start with account login. Verify that the setup key and setup cookies are denied after founder claim and confirm switching, roles, archival and mock Page isolation on synthetic workspaces. Create a dedicated Brand Admin benchmark account assigned only to the intended synthetic staging workspace. Do not use customer data.
7. Configure bounded Workers AI limits and account-wide headroom. Preserve cumulative usage; do not reset counters to pass a run. A workspace is capped at half the configured shared platform allowance as well as its own daily limits, so repeated evaluations may need to wait for the next 00:00 UTC reset. The platform ceiling is at most 8,000 reserved Neurons/day; Cloudflare's Free allocation includes other account workloads.
8. Run the unchanged benchmark using private Actions environment values:
   ```text
   STUDIO_BENCHMARK_URL=<existing staging URL>
   STUDIO_BENCHMARK_EMAIL=<dedicated scoped account>
   STUDIO_BENCHMARK_PASSWORD=<protected account password>
   STUDIO_BENCHMARK_WORKSPACE=<authorized target workspace ID>
   ```
   `npm run benchmark:staging` authenticates the account, authorizes an explicit switch, checks the resulting workspace and sends its expected scope on fixture requests. The original 13 scenario assertions and two multi-turn checks remain intact. `STUDIO_BENCHMARK_ADMIN_SECRET` is retained in the script only for the already-hosted NM-AI-03 runtime. It cannot run management/Playground checks against NM-AI-04.3, even before founder claim. The platform candidate requires successful founder claim and scoped account credentials for every benchmark run. Update the operations workflow's hosted API/model configuration/limit-restoration login steps to use the same account credentials and selected workspace. Do not leave those steps using the old key.
9. Confirm synthetic cleanup, logout, restored normal staging limits and unchanged usage counters. Record actual auth CPU/latency on Workers Free, AI results and Vietnamese tone review. Leave production, paid plans, gateway billing and live Messenger disabled.

## Recovery

Follow [MIGRATION_REPORT.md](MIGRATION_REPORT.md). Prefer a forward correction with the expanded schema intact. A Time Travel restore discards writes after its bookmark and requires a separate explicit recovery approval. Never apply an old single-brand runtime to a claimed multi-account database without a reviewed access/credential plan. Legacy live queued work stays inert pending an explicitly approved Page mapping or disposition; connecting a new Page does not replay it.
