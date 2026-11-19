# Security

## Access and data

The MVP uses one high-entropy administrator key stored as a Worker secret. Successful login issues an eight-hour HMAC-signed, Secure, HttpOnly, SameSite=Strict cookie. Rotating the secret invalidates every session. Logout clears the current browser cookie. The application validates write origins, bounds body sizes, validates external data and uses parameterized SQL. Authenticated admins share a principal. The audit trail records changes and snapshots but cannot attribute changes to separate people.

The demo bypass requires a binding only set in the isolated loopback runner. Its D1 is disposable and seeded from synthetic fixtures. The deployment configuration never supplies the bypass. Audit snapshots omit conversation content. Messenger sender IDs and messages are still stored in conversation records. Establish a retention and deletion policy before listening to a customer page. Administrator-entered image URLs load directly in the browser with a no-referrer policy.

## AI and integrations

The provider cannot execute tools or write content. It receives data and returns one of the IDs already selected from tenant-owned published knowledge. Output is validated against the eligible sources. The gateway uses exact published text, applies a sensitive-language check and escalates failures. The sensitive check and retrieval heuristics have limited language coverage. Keep the outbound gate closed until human evaluation covers ambiguity, sensitive phrasing and brand policies.

D1 atomically reserves UTC calls and estimated Neurons before inference. A failed provider call retains its reservation. Cloudflare account-level quotas apply independently. The estimate uses published model rates, UTF-8 byte count with a framing allowance, and output cap. It is not an invoice estimate.

Live Messenger ingress is off by default. Verification checks the challenge and token. Delivery checks raw-body HMAC and matches the configured page and recipient before storing an event. Dedupe is scoped to tenant and channel. Outbound messaging is hard-disabled. Query-string redaction is configured for observability, invocation logs are disabled, and the application does not log request contents or secrets.

[Workers security and runtime practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) · [D1 consistency and batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
