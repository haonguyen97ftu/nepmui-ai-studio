# NM-AI-04.2 findings register

Severity: P0 critical; P1 high; P2 medium; P3 low. Baseline `816b3e78baa2b435a3743a397ddd7e633014ab63`. “Remediated in working tree” requires final immutable review and test evidence before closure.

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| WEB-01 | P3 | Automatic third-party product image requests disclose access timing/IP | Implemented; targeted lint pass, browser rerun pending |
| WEB-02 | P2 | Viewer/customer-service receive sensitive persona/agent/channel configuration | Implemented; targeted policy evidence, final SHA pending |
| INF-01 | P2 | CI references mutable upstream Actions tags | Implemented; targeted infrastructure tests pass |

## WEB-01

Baseline `worker/contracts.ts:20` accepts arbitrary HTTPS image hosts; `src/library.tsx:168` automatically renders an img. An administrator saves a controlled URL and another member opens Products: the browser contacts that host. no-referrer limits referrer leakage but not IP/user-agent/access timing. No server-side image fetch or backend SSRF was established. Root cause: remote resources were loaded without an explicit user action. Remediation replaces the image with an explicit external link, noopener/noreferrer and no-referrer. Regression in tests/studio.spec.ts intercepts a synthetic product and verifies no image element or automatic request. Residual: a user who explicitly opens the image contacts the external host.

## WEB-02

Baseline `worker/accounts.ts:86–104` grants every member GET persona/models/agents/channels; `worker/index.ts:209–214` and `worker/registry.ts:63,77–83` return configuration verbatim. Reproduce using Viewer GET `/api/persona`, `/api/agents`, `/api/channels`. Channel access tokens are excluded. Root cause: broad section read authorization did not distinguish confidential configuration. The agreed policy denies Viewer and Customer Service all these reads; AI Trainer may read persona/agents/models but not channels. Central machine policy and generated endpoint tests are implemented by the authorization owner. Final verification must establish server denial, safe UI navigation and role/endpoint coverage.

## INF-01

Baseline `.github/workflows/ci.yml:16,17,30` references mutable Actions tags. Root cause: upstream tag movement could change CI code without repository review. Infrastructure owner verified official refs and pinned checkout/setup-node/upload-artifact to full SHAs. Final validation must confirm exact provenance, all action references and required checks. No compromised upstream action or leaked secret was observed.

## AI/integration findings

The following anchors refer to the discovery baseline. All fixes are reported implemented in the working tree by the AI owner; regressions in `tests/ai-security.test.ts` are included in final validation; immutable review remains pending. No hosted inference was used.

| ID | Severity | Root cause and reproduction | Remediation |
| --- | --- | --- | --- |
| AI-01 | P1 | `worker/ai.ts:145,218–220`: sensitive question blocked initially but prior conversation text forwarded on a subsequent safe question | Filter sensitive/injection/human history and sanitize provider-bound fields |
| AI-02 | P2 | `worker/ai.ts:234–239`: provider exception with arbitrary 3–6 digit code reflected in diagnostic | Allow known Workers AI code 3006 only |
| AI-03 | P2 | `worker/ai.ts:111–121,186–215`: duplicate title products with contradictory prices or freeform notes create conflicting claims | Hand over ambiguous titles; remove suspicious/numeric/price notes and notes from direct price/stock answers |
| AI-04 | P2 | `worker/store.ts:96–99`: foreign workspace corpus changes global FTS BM25 ranking | Term MATCH, fixed title matching and stable ID ranking independent of foreign corpus |
| AI-05 | P2 | `worker/ai.ts:225`, `worker/store.ts:77–89`: stale higher workspace limit passed to reservation | Join current model configuration during atomic reservation and cap by minimum |
| AI-06 | P2 | `worker/index.ts:233–246`: sources changed while model runs but stale result saved | Atomic save checks active workspace, candidate versions and publication; return 409 on stale sources |
| AI-07 | P2 | `worker/index.ts:268–280`: correction-specific redaction misses credentials exposed to Trainer | Shared sanitizer masks correction title/body and filters source titles |

## Authentication and authorization findings

Anchors refer to baseline `816b3e78baa2b435a3743a397ddd7e633014ab63`. AUTH-01, AUTH-03, AUTH-04 and AUTH-05 have working-tree fixes and local regressions in `tests/auth-lifecycle.test.ts`. AUTH-02 and AUTH-06 are tracked by the central policy changes. The targeted authentication, bootstrap, and platform suites passed all 49 tests against disposable D1. Final immutable verification is pending.

| ID | Severity | Root cause and reproduction | Remediation and regression |
| --- | --- | --- | --- |
| AUTH-01 | P1 | `worker/accounts.ts:47–53`, `worker/platform.ts:130–144`: the session principal could outlive its authority. When another admin demoted a Super Admin after request admission, an in-flight account creation could still persist a new Super Admin. | Critical account, workspace, quota, membership, agent and channel writes check live session, role and workspace state in the write itself. Regressions pause between admission and write for demoted Super Admin and removed Brand Admin actors. |
| AUTH-02 | P1 | `worker/index.ts:153–190`: AI Trainer edit authorization checked the submitted draft status only, and the delete and restore paths ignored current approval status. A Trainer could withdraw approved or published knowledge. | Require current draft state for Trainer edit, delete and restore. Exercise both published-record denial and successful draft edits. |
| AUTH-03 | P2 | `worker/accounts.ts:86–100`, `worker/platform.ts:176–181`: the middleware blocked lower roles before the handler could apply the self-revocation rule. | Global policy allows the exact revoke operation for persisted roles, with a self-or-Super-Admin condition at the handler. The regression covers self revocation without a selected workspace and denial for a foreign account. |
| AUTH-04 | P2 | `worker/platform.ts:130–144`: global email uniqueness and a distinct 409 let Brand Admins probe for accounts outside their workspaces during provisioning. | Restrict new-account provisioning to Super Admin. Confirm a Brand Admin receives 403 for both an existing and an unused email. Brand Admin membership management stays workspace-scoped. |
| AUTH-05 | P2 | `worker/platform.ts:24–34`, `worker/index.ts:104–107`: founder claim checked account-table emptiness at write time but setup logout was checked only at admission. An admitted claim could commit after its setup cookie was revoked. | Check the setup session expiration and revocation alongside the empty account table in the founder INSERT. The regression logs out between request admission and handler execution and checks that no account was persisted. |
| AUTH-06 | P1 | `worker/accounts.ts:86–100`, `worker/index.ts:132–146,181`: Viewer knowledge list/detail/history routes could expose draft or prepublication data. | Bind role-specific visibility to the list and object lookup, restrict revision history, and test draft, approved, and published records through the viewer routes. |

## TEN-01 — P2: webhook replay protection erased by customer deletion

Baseline delivery deduplication lived in deletable conversation delivery metadata (`worker/privacy.ts:41–53`, `worker/channels.ts` event admission). Reproduce locally by admitting a signed event, deleting its conversation, and replaying the same event: without independent replay state it could recreate processing. Root cause: replay admission lifetime was coupled to customer content lifetime. Migration `0005_webhook_replay.sql` adds workspace/channel-scoped SHA256 event tombstones with 48-hour expiry and trigger-based atomic admission; the digest contains no message body or sender. Live input admits timestamps within the 24-hour past/+5-minute future window before persistence and caps skewed receipt time to now. Conversation deletion preserves tombstones; retention removes only expired tombstones. Synthetic regression coverage includes deletion/replay, concurrent admission, isolation and stale/future live input in `tests/replay-security.test.ts`. Infrastructure owner reports 27/27 combined targeted tests passed. Remediated with targeted local evidence; final immutable verification pending. Actual hosted webhook replay behavior was not exercised.

## Current verification status

All findings above have working-tree remediations. AUTH-01/03/04/05 targeted authentication/bootstrap/platform tests passed 49/49; TEN-01/infrastructure combined targeted tests passed 27/27. Central policy now inventories 65 endpoints against seven principals (455 combinations plus constraint cases), with HTTP gate allow/deny coverage, real handler denial tests, state tests and mutation checks. Policy-gate allow success does not prove every allowed handler's complete business behavior; existing handler tests supply that additional evidence. WEB-01 targeted ESLint passed; its initial browser attempt could not launch due to missing Chromium and requires the root's prepared browser rerun. AI regressions and full final checks are being consolidated by the root. No finding is declared immutable-commit verified until that review records the final SHA and results.

## AUTH-07 — P2 — Foreign account membership import

`worker/platform.ts` membership mutation originally let a Brand Admin attach any known non-Super account ID to the selected workspace, then read its directory fields. Root cause: target account existence was checked without requiring an existing tenant membership. The write now requires existing selected-workspace membership for Brand Admin; only Super Admin may attach accounts across workspaces. `tests/authorization-matrix.test.ts` creates a foreign-only account and confirms 403 and no new membership. Locally remediated; immutable review pending.

## Consolidated verification status

All listed findings have local remediations and regression evidence. Full suite: 577 passed. Browser: 15 passed / 3 existing intentional skips. The role matrix covers all 65 registered route/method pairs and defaults to deny for unknown paths/methods. Mutation evidence is stored in security-results; independent immutable review is recorded in PR #1 against its exact SHA. Until those reviews conclude, findings are locally verified, not independently closed.

Residual P2/P3 disposition: hosted runtime budgets, external deployment infrastructure and restore recoverability remain unverified operational gates, rather than accepted authorization bypasses. Pattern-based sensitive-text recognition is bounded and cannot identify arbitrary unlabeled secrets; provider context omits human and classified-sensitive turns. Remote images require explicit navigation. Channel quota counters are telemetry, with enforced global/workspace caps; no independent per-channel ceiling is promised. No unresolved discovered P0/P1 is accepted.
