# NM-AI-05B staging release

Staging uses the existing Workers Free Worker and D1 database. The application comes from the exact candidate SHA in PR #1. The release workflow lives on `ops/nm-ai-deploy-01` and uses the protected `nepmui-staging` environment. The remediation phase leaves the hosted release and database untouched.

## Before requesting release approval

1. Require full Studio CI and new independent QA for the exact app SHA, plus review of the exact operations SHA and its offline CI. Record both SHAs and the review in PR #1. A previous QA decision applies only to the commit reviewed.
2. Confirm the environment restricts deployment to the operations branch and requires founder approval. Set `STAGING_APPROVED_CANDIDATE_SHA` in that environment only after independent QA accepts the pinned candidate. Confirm Workers Free and validate the Cloudflare token scope against the existing staging account, Worker and D1 database.
3. Provision protected `CLOUDFLARE_API_TOKEN`, `STAGING_ADMIN_SECRET`, `STAGING_AUTH_PEPPER` and `STAGING_RECOVERY_KEY`. The three latter values are distinct 32-byte hex values. Preserve the existing bootstrap secret and any already-used auth pepper. Keep the recovery key available in approved private storage and confirm that a seven-day encrypted GitHub Actions recovery artifact meets the approved storage requirement. An optional `STAGING_CHANNEL_ENCRYPTION_KEY` must be independent of the other keys.
4. Quiesce staging writes for the release window, including user activity and pending mock processing. The workflow checks that the Time Travel bookmark and protected-data fingerprints remain stable before migration. Keep both live Messenger flags disabled.

## Release phase

Request phase `release` for the exact approved candidate and confirm the staging write window is quiesced. Use workflow dispatch if available. If GitHub requires the workflow to exist on the default branch, update only the existing `.github/staging-deploy.request` on the operations branch after approval. The file is JSON with `candidate` (full SHA), `phase` (`release`), and `quiesced` (true). This marker commit starts a protected run. Review the environment approval request against the recorded SHAs.

The job verifies candidate CI and the pinned checkout, resolves the current Time Travel bookmark and the same point by timestamp, and uploads an authenticated encrypted recovery artifact. It requires the upload to succeed before attempting migrations. It requires the ledger to start with `0001_studio.sql` and `0002_conversation_engine.sql` and allows only the ordered suffix `0003_platform.sql`, `0004_founder_invariant.sql`, and `0005_webhook_replay.sql`. It checks the final ledger, row counts and digests, FTS, foreign keys, workspace profiles, usage backfill and founder guards. Only then does the deploy job receive `STUDIO_PLATFORM_MIGRATION_READY=0005_webhook_replay.sql`.

The deploy helper disables provisioning and uses the staging database. Signed-out smoke verifies the exact deployed asset marker, protected API denial and disabled Messenger endpoints. Migration 0005 adds a five-minute live-ingress quarantine and rejects pre-cutoff events. Existing pending deliveries remain preserved. Keep live Messenger disabled.

## Acceptance phase

1. Verify the release run and encrypted recovery artifact. If the account table is empty, the founder claims the first account through setup. The setup key grants setup only. If founder claim already succeeded, use account login. Verify the legacy setup key and old cookies are denied after claim.
2. Create an isolated synthetic workspace and a dedicated Brand Admin account scoped to it. Set protected `STAGING_BENCHMARK_EMAIL`, `STAGING_BENCHMARK_PASSWORD` and the environment variable `STAGING_BENCHMARK_WORKSPACE`. Confirm global and workspace Workers AI headroom for 13 benchmark scenarios and two multi-turn checks. Preserve usage counters.
3. Request phase `acceptance` for the same SHA. For marker-based invocation, set `phase` to `acceptance`. The protected acceptance run checks the deployed SHA, authenticates the account, selects the explicit workspace, checks Messenger is disabled, runs the 13+2 benchmark and restores the previous model configuration limits. Check the job result, logout, cleanup and usage. Complete hosted role/isolation and synthetic mock verification, Free-plan latency and Vietnamese editorial review before reporting acceptance.

## Failure and recovery

Stop if a gate fails. Preserve the encrypted recovery artifact and inspect the protected ledger, staging state and job results before retrying. A partial migration requires review against the original recovery point. Keep the original recovery reference within the D1 Time Travel window. See [migration evidence and recovery](MIGRATION_REPORT.md). A Time Travel restore discards writes after its bookmark and requires separate recovery approval.
