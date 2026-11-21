# NM-AI-05B release readiness

Baseline: `7c6a42147e8e99cf8962d96bfcdf64ec96cc5062` (NM-AI-04.3). A new immutable QA pass and full candidate CI are required before release. Use the current PR #1 head for candidate-specific checks and independent review. Hosted staging remains on its last approved release.

Required checks on the candidate are Node.js 24, lockfile install, lint, typecheck, Worker and staging builds, full unit/integration suite, authorization suite, relevant authorization mutations, Playwright and disposable D1 migration preservation. Require passing evidence and disposition of all P0/P1 and staging-blocking P2 findings before independent staging review.

Conversation readiness includes Playground owner and administrator access, administrator-only ownerless records, tenant isolation, authorized customer-service workflows, filtered pagination/aggregates and guarded updates/training inserts. See [finding AUTH-08](SECURITY_FINDINGS.md#auth-08--p2--conversation-management-bypassed-playground-ownership) and the [RBAC matrix](RBAC_MATRIX.md).

The approved release sequence verifies `0003_platform.sql`, `0004_founder_invariant.sql` and `0005_webhook_replay.sql` in the staging ledger before setting `STUDIO_PLATFORM_MIGRATION_READY=0005_webhook_replay.sql`. Verify the protected operations workflow and use account login with an explicit workspace switch for management and benchmarks. See the [deployment runbook](DEPLOYMENT.md).

Hosted boundaries remain unverified: Cloudflare CPU/D1 budgets and scheduler fairness under real workload; Time Travel and actual restore recoverability; external operations workflow environment and token scope; production bindings/secrets; live Meta ownership/routing; browser cross-tab/session/BFCache behavior beyond locally executed tests. Validate applicable hosted gates with founder approval before production deployment or customer messaging. Local success cannot establish these properties.

Infrastructure discovery reports zero production/full npm-audit advisories and registry-only lockfile with pinned CLI; these are point-in-time dependency evidence, not a supply-chain guarantee. CI uses read-only repository permissions, synthetic artifacts and bounded trace retention. All three Action references are pinned to verified official immutable SHAs.


WEB-03/P3 remediation replaces remote logo rendering with workspace initials in both views. The same-origin image CSP provides an independent browser control. Synthetic browser coverage exercises both screens. Stored branding URLs are preserved.

Review the protected operations workflow separately. The application and operations commits must be paired in PR #1, and staging remains gated by the independent QA and operational approvals in the deployment runbook.
