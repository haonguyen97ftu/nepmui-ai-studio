# Founder actions

## During this build

Review the draft pull request and browser artifacts. Meta configuration, paid services and external AI API credentials are unnecessary for the demo and CI.

## After approving an authenticated internal release

1. Confirm use of Cloudflare Workers Free and an existing `workers.dev` subdomain. Authorize access to the intended account for the deployer.
2. Approve the production release, provision D1, and create the high-entropy admin secret in the chosen password manager. Give it only to approved administrators. Follow [deployment](DEPLOYMENT.md).
3. Supply genuine product names, prices, availability, images, FAQs, shipping and return policies. Confirm who may approve and publish each source.
4. Decide the retention period and deletion process before ingesting customer data. Confirm who handles conversations in the handover queue.
5. Approve Workers AI separately if desired. Confirm account-level budget and set both daily app limits. Calibrate retrieval and fallback with representative Vietnamese queries.
6. Approve a Messenger test page and provide Meta secrets through Cloudflare only when ready. Separately approve any future live outbound release.
