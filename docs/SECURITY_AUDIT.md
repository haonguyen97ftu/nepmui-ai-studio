# NM-AI-04.2 security audit

Audit date: 2026-11-20–21. Discovery baseline: `816b3e78baa2b435a3743a397ddd7e633014ab63`. This is an authorized local source, dependency and synthetic-test review. Remediation is in progress; it is not a certification or evidence of deployed controls. Final immutable commit review remains required.

## Surface inventory

Browser: React application, navigation and editing permissions, session refresh and workspace switching, product external resources, CSV/text imports, source links. API: Hono authentication middleware, account/bootstrap/password flows, workspace membership and switching, platform administration, knowledge/products/training CRUD and revision history, persona/model settings, agents/channels, playground, conversations/handover, analytics, audit and retention. Integrations: Workers AI, signed Messenger webhook ingress, Graph outbound, encrypted channel credentials, scheduler. Persistence: workspace-scoped D1 records/revisions, accounts/sessions/memberships, channels/outbox/deliveries, audit/usage/throttle/retention cursors. Operations: migrations, npm lockfile, Cloudflare CLI/build, CI, staging scripts and backup documentation.

## Framework coverage

OWASP API Top 10: reviewed object authorization and tenant predicates (API1), authentication/session lifecycle (API2), field exposure and role policy (API3), body/usage/resource bounds (API4), route-level roles (API5), sensitive operations and live-message gating (API6), remote image/integration destinations (API7), headers/errors/configuration (API8), route inventory and legacy bootstrap paths (API9), and signed webhook/AI response handling (API10). Coverage means inspected or locally exercised, not that every implementation satisfies the category.

ASVS-oriented review: authentication, session management, access control, input validation, output encoding, cryptography/secrets, data protection, communications, configuration and business logic. AI-specific review includes prompt injection, grounding, structured output validation, approval transitions and live outbound controls. No ASVS level certification or full requirement-by-requirement conformance claim is made.

## Browser/API observations

Unsafe API methods require same-origin Origin; session cookie is Secure, HttpOnly and SameSite Strict. API responses set no-store and nosniff. JSON input is bounded and schema validated; generic errors omit internal exception details. React rendering has no discovered raw-HTML sink. Workspace switching reloads and client workspace headers are checked against server-selected membership. Channel tokens are excluded from list responses. Conversation deletion removes revisions, outbox and deliveries. Retention is bounded per scheduler tick.

These observations do not prove browser BFCache clearing, cross-tab account transitions, hosted header policy or actual retention scheduling. Product remote image privacy and sensitive configuration reads are tracked in SECURITY_FINDINGS.md.

## Evidence and limitations

Discovery used read-only source inspection and local synthetic tests. No production requests, deployments, paid inference, live messaging, credential disclosure or hosted load testing were authorized. Review is distributed across frontend, authorization, infrastructure/bootstrap and AI/integration work. Findings and release status must be read with SECURITY_FINDINGS.md and RELEASE_READINESS.md. Test results from an earlier revision cannot close final-commit verification.

## Complete migration table inventory

Application-created tables through migration 0005 are listed below. SQLite FTS5 also manages internal `studio_search_data`, `studio_search_idx`, `studio_search_content`, `studio_search_docsize`, and `studio_search_config` shadow tables; these are not separate authorization surfaces and must not be queried as tenant-scoped public APIs.

| Migration | Table | Data and boundary |
| --- | --- | --- |
| 0001 | brands | Workspace identity and active state; server-resolved membership |
| 0001 | records | Workspace/kind/id scoped knowledge, products, persona, models, training, conversations |
| 0001 | revisions | Workspace-scoped historical record content; publication visibility differs from current content |
| 0001 | usage | Workspace/day inference counters and reservations |
| 0001 | deliveries | Workspace/channel external-event admission and thread references |
| 0002 | studio_search | Shared FTS5 index with explicit brand/kind predicates; ranking must not depend on foreign corpus |
| 0002 | messenger_outbox | Workspace/channel/thread outbound queue including message content and retry state |
| 0002 | login_attempts | Legacy workspace-scoped HMAC throttle buckets |
| 0002 | revoked_sessions | Legacy setup session revocation identifiers and expiry |
| 0002 | retention | Workspace conversation retention policy |
| 0003 | workspace_profiles | Workspace logo/color/language/archive/version |
| 0003 | accounts | Global account identity, salted password hash, active/founder/auth version |
| 0003 | memberships | Account/workspace role membership |
| 0003 | account_sessions | Hashed bearer session, selected workspace, expiry/auth version |
| 0003 | platform_login_attempts | Global login throttle buckets and expiry |
| 0003 | platform_audit | Attributed action/target metadata with optional workspace |
| 0003 | agents | Workspace-scoped model/persona configuration |
| 0003 | channels | Workspace connections, encrypted scoped credentials, ownership verification and overrides |
| 0003 | platform_limits | Global singleton inference limits |
| 0003 | platform_usage | Global daily inference counters |
| 0003 | channel_usage | Workspace/channel daily inference telemetry; not a separate channel quota |
| 0003 | inference_reservations | Atomic admission inputs; trigger checks and accounts usage |
| 0003 | scheduler_cursors | Global retention/delivery rotation positions |
| 0004 | founder_invariant_check | Transient validation table created and dropped during atomic migration; contains no application data |
| 0005 | event_tombstones | Workspace/channel SHA256 event digest and 48-hour expiry; independent of deleted customer content |

Database trigger inventory: record_created/updated/deleted create revision history; studio_search_insert/update/delete maintain FTS; reserve_inference enforces/account reservations; protect_last_superadmin and migration 0004 require_active_founder_on_insert/update plus protect_last_superadmin_delete preserve founder authority; pause_archived_workspace/pause_inactive_workspace/pause_channel_jobs stop queued live operations; admit_delivery_once atomically claims replay tombstones. Migration 0003 extends initial table structures; migration 0005 adds deliveries.event_hash. Replay tombstones intentionally survive conversation deletion and are purged only after expiry.

## Background jobs and external integrations

| Surface | Trigger and behavior | Review boundary |
| --- | --- | --- |
| Retention scheduler | Both configured cron invocations (`15 3 * * *`, `*/2 * * * *`) call scheduled handler; rotate one workspace, purge bounded old conversations, expired replay/throttle/revocation state | Local predicates reviewed; actual hosted frequency/backlog not proven |
| Delivery scheduler | Same handler rotates one eligible active Page and drains one outbound job; durable delivery cursor | Ownership, pause/archive and staging gates; hosted delivery not exercised |
| Outbound retry/state machine | messenger outbox queued/retry/working/sending/unknown/failed states and bounded drain | Unknown delivery outcomes require care; no live customer sends |
| Workers AI | Allowlisted structured-response inference, reservations and grounded answer composition | Local fake provider regressions; model quality/hosted budgets not established |
| Meta webhook | Public verification GET and signed raw-body POST; batch admission and replay checks | Local synthetic signatures/events only |
| Meta Graph | Page ownership verification and outbound message requests with scoped decrypted token | No live ownership verification or send |
| D1 | SQL batch/trigger consistency, workspace predicates, migrations and FTS | Disposable local database; remote restore and schema not inspected |
| Static assets/browser | SPA through Cloudflare assets; API runWorkerFirst, external images explicit links | External link navigation is user initiated |
| CI/operations | npm registry install, official Actions, cf build, staging deploy/benchmark/backup/migration scripts | SHA pins reviewed; operational account scopes and actual hosted backup recoverability pending |

## Frontend permission mapping

`src/main.tsx` navigation and denied-page guard mirror the server policy, while disabled fieldsets are usability controls, never authorization. Global Super Admin authority and per-workspace roles must be checked independently. The exact server route matrix is in RBAC_MATRIX.md and shared/endpoint-policy.json.

| Page/action | UI read access | UI editing/action access |
| --- | --- | --- |
| Dashboard/overview, usage | All workspace members | Dashboard read only |
| Knowledge | All workspace members; Viewer sees published only | Brand Admin/Super Admin; AI Trainer draft-only server checks |
| Products | All workspace members | Brand Admin/Super Admin |
| Training | Brand Admin/Super Admin/AI Trainer | Trainer drafts; publication requires administrator |
| Persona/agents | Brand Admin/Super Admin/AI Trainer | Same roles, subject to live server checks |
| Models | Brand Admin/Super Admin/AI Trainer | Brand Admin/Super Admin |
| Channels | Brand Admin/Super Admin | Brand Admin/Super Admin; live ownership verification Super Admin |
| Conversations | Brand Admin/Super Admin/Customer Service | Customer Service workflow excludes deletion; administrators can delete |
| Playground | All except Viewer | Same, subject to workspace/usage/grounding checks |
| Users/team | Brand Admin/Super Admin | Workspace membership administrator; global account provisioning Super Admin |
| Settings/integrations | Brand Admin/Super Admin | Same, subject to operation-specific server policy |
| Platform | Super Admin | Super Admin, rechecked at critical writes |
| Account/password/session | Authenticated account, including no workspace selection | Own account actions; revocation self or Super Admin |
| Workspace selector | Server-listed memberships; Super Admin global access | Server-authorized switch; reload clears mounted workspace UI |

Archived/inactive workspace UI is read-only. Bootstrap UI is isolated from workspace navigation. Direct URLs are denied by the same page guard; server policy remains authoritative. Published knowledge history is not safe merely because its current record is published; Viewer history is denied separately.
