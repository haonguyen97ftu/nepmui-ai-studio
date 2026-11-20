# Founder actions

1. Review the NM-AI-03 changes and hosted evidence in draft PR #1 and [QA report](QA_REPORT.md). Staging D1, secrets and the Actions deployment environment already exist.
2. Use the existing staging workflow with a full pinned feature commit SHA for subsequent evaluations. Keep production and staging database IDs and keys separate. Meta credentials are unnecessary for staging.
3. Review Vietnamese tone and consultation relevance in the staging Playground. Select the retention period and verify the human takeover workflow before using customer data.

Any later production release or live Meta rollout needs separate founder approval. A later Meta test requires approved Page permissions, a Page token and app secret in Cloudflare secrets, a supported Graph API version and an isolated test Page. Keep staging on mock Messenger.
