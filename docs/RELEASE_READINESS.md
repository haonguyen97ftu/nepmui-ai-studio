# NM-AI-04.2 release readiness

Status: NOT YET VERIFIED FOR RELEASE. No deployment authorization is implied. Discovery baseline: `816b3e78baa2b435a3743a397ddd7e633014ab63`; final immutable candidate and review evidence are pending.

Required local checks under AGENTS.md: Node 24, npm ci, lint, typecheck, build:worker, test and test:e2e. Record candidate commit, command results and relevant limitations after the final change. Earlier revision results do not establish final-candidate correctness.

Release gates: complete findings register and machine endpoint matrix; verify Viewer published-only knowledge list/detail and denied revision history; verify confidential settings policy; verify bootstrap/session and tenant boundaries; verify no automatic external image request; review immutable final commit and confirm all required local checks pass. Unresolved high-risk findings must not be silently accepted.

Hosted boundaries remain unverified: Cloudflare CPU/D1 budgets and scheduler fairness under real workload; Time Travel and actual restore recoverability; external operations workflow environment and token scope; production bindings/secrets; live Meta ownership/routing; browser cross-tab/session/BFCache behavior beyond locally executed tests. Validate applicable hosted gates with founder approval before production deployment or customer messaging. Local success cannot establish these properties.

Infrastructure discovery reports zero production/full npm-audit advisories and registry-only lockfile with pinned CLI; these are point-in-time dependency evidence, not a supply-chain guarantee. CI uses read-only repository permissions, synthetic artifacts and bounded trace retention. Final pinned-Action validation is pending.


Local verification completed: 577 unit/integration tests; 15 browser scenarios with 3 existing intentional skips; lint/typecheck; both Worker builds; migration preservation report through 0005. The final candidate is the commit containing this document; its exact SHA and independent reviewer results must be published in PR #1, avoiding self-referential commit hashes. This document alone does not certify hosted readiness.

All discovered P0/P1 findings have code remediations and local regressions. Final independent immutable review is the remaining source release gate. Each P2/P3 remediation and residual limitation is recorded in SECURITY_FINDINGS.md; any later reviewer finding reopens the gate. The hosted boundaries above remain explicit release limitations.
