# Security

## Administration

The shared administrator key remains a Worker secret. A successful login issues an eight-hour tenant-bound Secure, HttpOnly, SameSite=Strict session. Logout persists revocation in D1 until the cookie expires. Key rotation invalidates all sessions. A per-tenant D1 counter admits at most five login attempts per ten-minute fixed window per Cloudflare client address. Addresses are keyed with HMAC before storage. The rate limiter uses a common bucket when the Cloudflare header is absent. This MVP uses a single administrator principal, so audit entries cannot attribute actions to individuals.

The Worker validates write origins and bounds request bodies. D1 queries and FTS expressions use bound parameters or application-controlled SQL fragments. Retrieval joins the index to the tenant's own current rows and filters knowledge to published status. Candidate and source references are scoped to tenant, kind and record ID.

## Generation and personal data

Workers AI returns a strict plan for selecting and ordering sources, product options and Vietnamese conversational phrases. The application rejects extra fields and unknown or duplicate IDs. It renders names, prices, availability and fragrance facts from the current catalog. Policies use relevant published text, while sources with stale commercial claims or obvious injection markers are excluded. The application rechecks source versions before a Messenger send claim. Arbitrary provider prose never enters outbound text.

Obvious sensitive questions, personal details and injection requests route to human review. Email addresses, phone-like numbers, links, and some identified names, addresses and order IDs are redacted from model context. Pattern-based detection has limited language and format coverage. Do not use real customer data in staging. Administrators should redact corrections before publishing them.

Conversation deletion clears the selected thread, its outbox, linked delivery receipts and revision metadata from live tables. Retention defaults to 30 days after last update and can be configured from 1 to 365 days. The daily cron and manual purge process up to 100 threads per run. Legacy receipts without a mapped thread expire by age. Cloudflare backups and Meta messages follow their respective retention rules. A provider-side retry after live deletion may create a new inbound event. Application errors, CI and webhook responses omit request content, secrets and personal identifiers.

## Delivery

Live outbound requires the ingress and outbound flags, Page ID, Page token and Graph API version. Staging blocks live delivery in both configuration and runtime. Inbound events must have a valid raw-body HMAC and the expected Page and recipient. The outbox claims each inbound message once and only sends inside the documented 24-hour standard window. Events with missing or future timestamps are ineligible. The engine uses bounded retries for explicit 429 and temporary pre-send failures. Network timeouts, server errors and expired send leases have ambiguous outcomes and require operator review. Meta does not provide a verified idempotency key for these sends. A committed send can finish while an operator pauses the thread, but pause blocks new claims.

[Meta Send API](https://developers.facebook.com/docs/messenger-platform/send-messages/) · [Meta messaging policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/) · [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) · [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
