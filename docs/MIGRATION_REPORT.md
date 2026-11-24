# NM-AI-04.1 migration report and recovery procedure

## Readiness and scope

Candidate: `0003_platform.sql` plus forward security migration `0004_founder_invariant.sql`, tested only against disposable synthetic D1 in the cloud workspace and CI. Hosted staging remains on the approved NM-AI-03 release. Remote backup, migration, founder bootstrap, new secret provisioning and deployment are **not performed** and require founder approval after reviewing PR #1. Existing staging workflow infrastructure remains the deployment path; this change does not trigger its deployment request.

## Schema changes

The migration drops the single-active-brand unique index, not any user table or FTS data. It adds workspace profiles, accounts/memberships/opaque sessions, attributed audit, reusable agents, Page registry, global/channel quota counters, reservation triggers and scheduling cursors. It adds a nullable connection link to the existing outbox. Existing keys, record/version IDs, usage, delivery receipts and queued live messages remain intact. Historical workspace usage is copied into platform usage so rollout cannot reset quota consumption. Existing saved persona/model settings are untouched. Only an unsaved NẾP MÙI persona default is materialized with the old effective values.

Migration 0004 validates that an existing account set has an active Super Admin, rejects a normal/inactive first account and closes replacement/deletion invariant bypasses. Unsafe predecessor account sets are rejected without changing or promoting their rows; recovery requires a separate authorized decision. Database triggers protect the final active Super Admin and pause queued/working jobs inside the same transaction as archive, inactivity or Page pause/disconnect. They do not delete conversation history. Cancellation clears the duplicate queued question/recipient copies and does not replay on reopening. Already-sending jobs have ambiguous outcomes and retain existing review handling.

## Disposable-D1 preservation evidence

`npm run migration:report` builds an old-schema synthetic fixture, records snapshots, applies each forward migration in a D1 batch, compares all old rows/revisions/pending-job columns and verifies FTS plus foreign keys. The report contains counts and hashes only and is attached under `test-results/migration-report.json`; it contains no credentials or customer text. Current evidence:

| Check | Result |
| --- | --- |
| Existing records | 2/2 byte-for-byte preserved |
| Existing revision rows | 2/2 preserved |
| Pending delivery | 1/1 old columns preserved; new connection link is nullable |
| Before/after snapshot SHA-256 | Equal within each run |
| Existing FTS lookup | Preserved |
| Foreign key violations | 0 |
| Legacy usage 3 calls / 99 Neurons | Backfilled without reset |
| Multiple active workspaces | Accepted after index removal |
| Founder invariant insert/update/delete guards | All 3 installed and regression-tested |
| Unsafe predecessor with no active Super Admin | Rejected atomically, existing account unchanged |
| Remote database operations | None |

A separate integration fixture exercises three workspaces and six mock Pages with account, role, Page routing, takeover, encryption, archival, scheduling and concurrent quota checks. This is meaningful preservation evidence, not a claim that a production-sized migration or hosted Free-plan CPU behavior has been tested.

## Security review disposition

Review found and the implementation corrected: archived Brand Admin reactivation; unverified Page identity claims; archive/pause admission races; post-state-commit queue cancellation races; stale-login session minting after reset/revoke; benign Page edits causing webhook loss; and legacy mock queue starvation after account bootstrap. Regressions cover the server behavior. The final review found no previously reported backend blocker remaining by inspection. Documentation and hosted execution remain separate gates.

## Approved backup and release plan

Follow [DEPLOYMENT.md](DEPLOYMENT.md). Use the existing `nepmui-staging` environment and scoped Cloudflare credentials. The private `backup:staging` helper is approval-gated and reads only the staging Time Travel bookmark plus baseline table counts; it makes no schema changes. It requires an unchanged recovery point across verification and stores a protected recovery reference outside the repository. Cloudflare's Time Travel recovery window is finite: verify the actual account window and the recorded point immediately before migration. A bookmark is a provider-managed recovery point, not an independent portable export. Do not remove the FTS table for a SQL export.

The deployment readiness marker now requires `0005_webhook_replay.sql`, rejecting the previous 0003/0004 markers. Before release, preserve the actual D1 recovery reference privately, review old record/version/count checks, provision `AUTH_PEPPER` without rotating the founder key, apply the forward migration and pin the full reviewed feature SHA. The new deploy helper refuses an unprepared platform deployment. New account-based benchmark credentials and explicit workspace scope must replace the operations workflow's old shared-key login after founder claim. Run the same 13 original scenarios plus two multi-turn checks only after approval and sufficient UTC budget; never reset usage to create a passing score.

## Recovery and rollback

1. Stop new staging writes, keep both live flags false, and record any ambiguous send states. Do not retry them automatically.
2. Prefer a forward schema/code correction. Additive tables can remain while an incident is investigated; do not delete other workspaces or recreate the single-active-brand index.
3. Do not roll back blindly to the single-brand shared-key runtime after founder claim: it has different authorization semantics. A runtime rollback requires a reviewed access plan, invalidation of sessions, disabled live transports, and protection of all post-migration workspace data. Preserve `AUTH_PEPPER` and Page keys for any encrypted/password data that will be retained.
4. If a pre-migration Time Travel restore is necessary, obtain explicit recovery approval because it discards later writes. Preserve later synthetic records and the migration ledger privately first, verify the exact staging database and recovery bookmark, then use the pinned CLI's reviewed `cf d1 time-travel restore` operation. A restore may also roll back the migration ledger; inspect it before applying any subsequent forward correction.
5. Restore the matching approved code/configuration and credentials. Recheck signed-out access, founder access, preserved NẾP MÙI data/settings/versions, FTS, foreign keys, live-disabled flags and quota state. Never restore quota counters independently from the corresponding recovery point.

Legacy live outbox rows are preserved but intentionally not scheduled after account claim. Review them privately: expire/cancel old events or explicitly map eligible ones to a verified Page under separate transport approval. Do not replay them merely because a registry connection was added. Legacy mock queues continue through the bounded scheduler.

## NM-AI-04.2 replay migration and local verification

Migration 0005 (`0005_webhook_replay.sql`) is forward-only: adds deliveries.event_hash, creates workspace/channel scoped event_tombstones and expiry index, and adds atomic admit_delivery_once trigger. Digests are SHA256 event identifiers with 48-hour expiry and contain no sender/message content. Customer deletion preserves replay tombstones; retention deletes only elapsed tombstones. The replay suite uses disposable local D1; no remote schema was mutated.

Migration 0005 also records a database-clock ingress cutoff five minutes after migration in `replay_policy`. Live webhook ingestion is quarantined until that cutoff; provider events timestamped before the cutoff are ignored permanently, including buffered pre-upgrade events and tolerated future clock skew. This protects legacy receipts that have no digest after customer deletion. Existing conversations and pending outbox rows are preserved; the cutoff applies to new webhook admission, not the preserved outbox. Operators must account for the five-minute ingress quarantine and deliberate buffered-event exclusion before enabling live transport.

Infrastructure owner reports equal snapshot comparisons for migrations 0003–0005 using the local migration report and 27/27 combined replay/infrastructure checks. Exact final-candidate verification, immutable SHA, full suite and deployment-marker review are pending root consolidation. Production application, Time Travel availability and actual restore recoverability remain unverified. Migration 0004's founder_invariant_check is deliberately transient and dropped during atomic migration; migration 0005 does not relax founder invariants.

Final NM-AI-04.2 local report: migrations 0003–0005 passed; preserved 2 records, 2 revisions and 1 pending delivery; before/after SHA256 `8b09b2730392c681c330763986d96d1e9246a7b2ef961645cf846ed84bbd1f67`; zero foreign-key violations; existing search, usage backfill and all 3 founder guards verified. Remote migration applied: false.

Independent review found that old pre-0005 receipts need replay protection at upgrade. Migration 0005 therefore also creates `replay_policy.live_not_before`: live ingestion quarantines the initial five minutes and ignores provider events older than the cutoff. This closes legacy deletion/replay, including tolerated future timestamp skew, without retaining sender/message identifiers. Existing conversations and queued outbox remain preserved. Mock ingress is unaffected. Normal delivery tests explicitly model a completed quarantine; upgrade tests verify the quarantine itself. This has not been applied remotely.
