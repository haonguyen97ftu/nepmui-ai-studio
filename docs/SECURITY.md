# Security — NM-AI-04

## Accounts and founder bootstrap

The pre-platform administrator key remains a protected `ADMIN_SECRET` binding. It admits the old tenant-bound session only while the account table is empty. An authenticated founder claims the first Super Admin account with email, name and a password of at least 16 characters. The claim is an atomic conditional insert; competing claims cannot create another founder. Account creation closes the legacy key login immediately, including existing legacy cookies. If the response is interrupted after account creation, sign in with the new account instead of repeating bootstrap. The last active Super Admin is protected by a database trigger; administrators cannot disable/demote themselves through the lifecycle endpoint.

Passwords use native Web Crypto PBKDF2-SHA-256 (100,000 iterations, unique 128-bit random salt) after HMAC-SHA-256 with an independent 256-bit `AUTH_PEPPER` secret. This avoids an offline password oracle from a database-only compromise. The pepper must not equal the bootstrap key or Page encryption key. Account setup/login requires that binding; plaintext passwords, hashes and salts are never returned by account APIs. Minimum length does not replace strong generated passwords. Actual Workers Free CPU/latency and native Vietnamese editorial acceptance remain approval-gated hosted checks; local Miniflare is not proof of hosted resource limits.

Sessions are random 256-bit opaque cookies, with only their SHA-256 digests in D1. Cookies are eight-hour, Secure, HttpOnly, host-only and SameSite=Strict. Each request checks active account and current authentication generation. Login's session insert is conditional on the generation that verified the password, so a concurrent password reset/revoke cannot mint a fresh session from a stale credential snapshot. Password changes, administrator lifecycle actions and revoke-all increment the generation and remove existing sessions atomically. Logout revokes its current session. Membership is checked on every request; a role is never trusted from browser data.

Login throttles use atomic HMAC-keyed D1 buckets: five attempts per account/address, ten per account across addresses and twenty per address per ten-minute window. Missing Cloudflare address headers share the `direct` bucket. Password-change attempts are separately limited. Responses do not disclose account existence. There is no external email invitation/recovery service: Super Admin provisions accounts, transfers initial credentials through an approved private channel, and can reset another account. Each account can change its own password. Safeguard the founder credentials and preserve a separately authorized recovery operator.

### Authentication options evaluated

| Option | Decision |
| --- | --- |
| Cloudflare Access | Cloudflare documents a Free plan for teams under 50 users. Good future SSO front door, but requires a Zero Trust identity setup and verified Access JWT integration, and does not replace application workspace membership. No account/service was activated. [Plans](https://www.cloudflare.com/plans/zero-trust-services/) |
| Better Auth with SQLite/Drizzle | The documented Drizzle adapter supports SQLite and adds an adapter/auth dependency and its own schema/lifecycle surface. A dedicated D1/runtime compatibility and password-KDF review would be required before adopting it. No new dependency was installed. [Adapter](https://better-auth.com/docs/adapters/drizzle) |
| Native Web Crypto + D1 sessions | Selected for the bounded, operator-managed account lifecycle in this change. Uses the existing runtime and explicit application RBAC, requires a separate pepper and carries responsibility for ongoing authentication security review. No OAuth, MFA, public signup or self-service email recovery is claimed. [Runtime](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) |

## Authorization and tenant isolation

| Role | Server-enforced scope |
| --- | --- |
| Super Admin | Global workspaces, platform limits, accounts, live Page binding/verification and all authorized workspace operations |
| Brand Admin | Current workspace content, channels, agents, settings and memberships; cannot grant Super Admin, change other accounts globally, claim live Page ownership or restore archived workspaces |
| AI Trainer | Knowledge/training/persona/agent work and Playground; cannot configure quotas/channels/accounts or approve/publish knowledge |
| Customer Service | Current workspace conversations, human takeover, correction creation and Playground; cannot mutate catalog, models, accounts or channels |
| Viewer | Published/content views and aggregate dashboards; no writes, customer conversation bodies, audit or account directory |

API authorization precedes resource access. Every record/FTS query and mutation includes the selected tenant. Super Admin's global dashboard intentionally shows all workspaces; other workspace lists are membership-filtered. Guessing a record, channel, agent or conversation ID does not select a tenant. The browser's workspace header only detects stale context. Same-origin checks protect mutations, including login and switching; signed webhooks use raw-body HMAC instead. Bodies and model context remain bounded. No request-scoped mutable global state or shared retrieval cache was introduced. Platform audit stores actor/action/target/time, not submitted passwords, tokens or conversation text; existing version triggers retain status-only conversation revisions.

## Channel credentials and dispatch

Page tokens are encrypted with AES-256-GCM, a random 96-bit nonce and authenticated workspace/channel/external-ID scope. `CHANNEL_ENCRYPTION_KEY` is a separate protected 256-bit secret; it is never a browser or checked-in setting. API projection returns only token presence and verification status. Disconnect clears ciphertext and verification. Token replacement/reconnection resets verification and requires pause before re-verification. Rotate keys only with an approved decrypt/re-encrypt process or re-enter and verify each Page token; replacing a key blindly makes old ciphertext unusable.

Mock Pages cannot claim a live Page identity. Brand Admins cannot create or convert a live binding. Super Admin must provide a Page token whose bounded Graph `/me?fields=id` result matches the immutable external ID. Only verified, connected, unpaused live bindings accept signed events. Signature checks occur before registry routing. Unknown/unverified/disconnected/paused Pages are intentionally not admitted. Admission and outbox cancellation check current states atomically, avoiding archive/reopen races. Global ingress/outbound flags still require independent deployment approval. Staging blocks both live paths regardless of flags or verified rows. No real Page or customer data was used in these tests.

The durable outbox preserves standard 24-hour-window enforcement, source/version revalidation, per-thread operator pause, bounded retries for explicit rate rejection, and manual review for ambiguous delivery. A send already in flight can finish after pause; pause prevents new claims. Registry disconnection and workspace archival do not delete conversation history. Legacy live queues are retained for review, not replayed under newly connected Pages.

## Grounding, retention and deployment

The shared engine preserves strict source IDs, published-only knowledge, current structured price/stock and extractive fallback/handover. Arbitrary model prose never becomes a commercial claim. Pattern-based redaction has limited linguistic coverage; use synthetic data only for staging and review corrections before publishing. Diagnostics contain fixed codes, counters and known schema keywords, not prompts, raw responses, arbitrary provider errors or credentials.

Deletion and retention are tenant-scoped. The bounded rotating scheduler continues retention for archived workspaces and cleans expired sessions/login buckets. Customer deletion and backup lifecycle are separate: D1 Time Travel retains recovery history under Cloudflare's policy. Follow the [migration/recovery report](MIGRATION_REPORT.md) before any remote operation. No hosted schema change, paid plan, production release, main merge or live transport is authorized by this implementation alone.
