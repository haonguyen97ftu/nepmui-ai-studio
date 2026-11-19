# Founder actions

1. Review the Phase 2 changes and screenshots in draft PR #1. Authorize access to the intended Cloudflare Workers Free account for the staging deployer. The implementation workspace reported `authenticated: false`.
2. Have the authorized deployer create the separate staging D1 database, generate and store the staging administrator key in the password manager, and run the commands in [staging deployment](DEPLOYMENT.md). Keep production and staging database IDs and keys separate. Meta credentials are unnecessary for staging.
3. Run the synthetic Vietnamese benchmark with staging Workers AI enabled. Record a Vietnamese reviewer’s assessment of tone and consultation relevance. Select the retention period and verify the human takeover workflow before using customer data.

Any later production release or live Meta rollout needs separate founder approval. A later Meta test requires approved Page permissions, a Page token and app secret in Cloudflare secrets, a supported Graph API version and an isolated test Page. Keep staging on mock Messenger.
