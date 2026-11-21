# Endpoint authorization matrix

Generated from `shared/endpoint-policy.json`. The JSON is the machine-readable policy source; this table is a review snapshot and must be regenerated after policy changes. Roles list the admitted principals before object, tenant, active-workspace and other constraints. Bootstrap and unauthenticated access are explicit. A route absent from policy must fail closed.

| ID | Method | Path | Roles | Scope | States | Constraints |
| --- | --- | --- | --- | --- | --- | --- |
| get.session | GET | /api/session | super-admin, brand-admin, ai-trainer, customer-service, viewer, unauthenticated, bootstrap | global | all; absent, current |  |
| post.session | POST | /api/session | super-admin, brand-admin, ai-trainer, customer-service, viewer, unauthenticated, bootstrap | global | all; absent, current |  |
| delete.session | DELETE | /api/session | super-admin, brand-admin, ai-trainer, customer-service, viewer, bootstrap | global | all; absent, current |  |
| post.bootstrap | POST | /api/bootstrap | bootstrap, super-admin | global | all; absent, current | empty-account-table; active-super-admin-first; legacy-session-current |
| get.workspaces | GET | /api/workspaces | super-admin, brand-admin, ai-trainer, customer-service, viewer | global | all; absent, active, archived |  |
| post.workspaces | POST | /api/workspaces | super-admin | global | all; absent, active, archived |  |
| put.workspaces.id | PUT | /api/workspaces/:id | super-admin, brand-admin | global | all; absent, active, archived | authorized-workspace |
| post.workspaces.id.switch | POST | /api/workspaces/:id/switch | super-admin, brand-admin, ai-trainer, customer-service, viewer | global | all; absent, active, archived | current-membership |
| get.platform | GET | /api/platform | super-admin | global | all; absent, current |  |
| put.platform.limits | PUT | /api/platform/limits | super-admin | global | all; absent, current |  |
| get.accounts | GET | /api/accounts | super-admin, brand-admin | global | all; absent, current | scoped-directory |
| post.accounts | POST | /api/accounts | super-admin | global | all; absent, current | founder-ready; current-authority |
| put.accounts.id | PUT | /api/accounts/:id | super-admin | global | all; absent, current | current-authority; no-escalation |
| post.accounts.id.revoke | POST | /api/accounts/:id/revoke | super-admin, brand-admin, ai-trainer, customer-service, viewer | global | all; absent, current | self-or-super-admin; current-authority |
| put.memberships.id | PUT | /api/memberships/:id | super-admin, brand-admin | workspace | all; absent, current | current-authority; scoped-membership |
| post.account.password | POST | /api/account/password | super-admin, brand-admin, ai-trainer, customer-service, viewer | global | all; absent, current | self; current-password |
| get.overview | GET | /api/overview | super-admin, brand-admin, ai-trainer, customer-service, viewer | workspace | all; absent, current |  |
| get.analytics | GET | /api/analytics | super-admin, brand-admin, ai-trainer, customer-service, viewer | workspace | all; absent, current |  |
| get.audit | GET | /api/audit | super-admin, brand-admin | workspace | all; absent, current |  |
| patch.brand | PATCH | /api/brand | super-admin, brand-admin | workspace | all; absent, current |  |
| get.knowledge | GET | /api/knowledge | super-admin, brand-admin, ai-trainer, customer-service, viewer | workspace | published-only-for-viewer-and-customer-service; absent, deleted, draft, approved, published |  |
| get.knowledge.id | GET | /api/knowledge/:id | super-admin, brand-admin, ai-trainer, customer-service, viewer | workspace | published-only-for-viewer-and-customer-service; absent, deleted, draft, approved, published |  |
| post.knowledge | POST | /api/knowledge | super-admin, brand-admin, ai-trainer | workspace | trainer-current-and-next-draft-only; absent, deleted, draft, approved, published |  |
| put.knowledge.id | PUT | /api/knowledge/:id | super-admin, brand-admin, ai-trainer | workspace | trainer-current-and-next-draft-only; absent, deleted, draft, approved, published |  |
| delete.knowledge.id | DELETE | /api/knowledge/:id | super-admin, brand-admin, ai-trainer | workspace | trainer-current-and-next-draft-only; absent, deleted, draft, approved, published |  |
| get.products | GET | /api/products | super-admin, brand-admin, ai-trainer, customer-service, viewer | workspace | all; absent, current |  |
| get.products.id | GET | /api/products/:id | super-admin, brand-admin, ai-trainer, customer-service, viewer | workspace | all; absent, current |  |
| post.products | POST | /api/products | super-admin, brand-admin | workspace | all; absent, current |  |
| put.products.id | PUT | /api/products/:id | super-admin, brand-admin | workspace | all; absent, current |  |
| delete.products.id | DELETE | /api/products/:id | super-admin, brand-admin | workspace | all; absent, current |  |
| get.training | GET | /api/training | super-admin, brand-admin, ai-trainer | workspace | all; absent, deleted, draft, approved, published |  |
| get.training.id | GET | /api/training/:id | super-admin, brand-admin, ai-trainer | workspace | all; absent, deleted, draft, approved, published |  |
| post.training | POST | /api/training | super-admin, brand-admin, ai-trainer | workspace | trainer-current-and-next-draft-only; absent, deleted, draft, approved, published |  |
| put.training.id | PUT | /api/training/:id | super-admin, brand-admin, ai-trainer | workspace | trainer-current-and-next-draft-only; absent, deleted, draft, approved, published |  |
| delete.training.id | DELETE | /api/training/:id | super-admin, brand-admin, ai-trainer | workspace | trainer-current-and-next-draft-only; absent, deleted, draft, approved, published |  |
| get.knowledge.id.history | GET | /api/knowledge/:id/history | super-admin, brand-admin, ai-trainer | workspace | existing-resource; absent, deleted, draft, approved, published |  |
| post.knowledge.id.restore | POST | /api/knowledge/:id/restore | super-admin, brand-admin, ai-trainer | workspace | trainer-current-draft-only; absent, deleted, draft, approved, published |  |
| post.knowledge.import | POST | /api/knowledge/import | super-admin, brand-admin, ai-trainer | workspace | draft-only; absent, deleted, draft, approved, published |  |
| post.training.id.publish | POST | /api/training/:id/publish | super-admin, brand-admin | workspace | approved-only; absent, deleted, draft, approved, published |  |
| get.persona | GET | /api/persona | super-admin, brand-admin, ai-trainer | workspace | all; absent, current |  |
| put.persona | PUT | /api/persona | super-admin, brand-admin, ai-trainer | workspace | all; absent, current |  |
| get.models | GET | /api/models | super-admin, brand-admin, ai-trainer | workspace | all; absent, current |  |
| put.models | PUT | /api/models | super-admin, brand-admin | workspace | all; absent, current |  |
| post.playground | POST | /api/playground | super-admin, brand-admin, ai-trainer, customer-service | workspace | all; absent, current |  |
| get.conversations | GET | /api/conversations | super-admin, brand-admin, customer-service | workspace | all; absent, current |  |
| get.conversations.detail-empty | GET | /api/conversations/detail-empty | super-admin, brand-admin, customer-service | workspace | all; absent, current |  |
| get.conversations.id | GET | /api/conversations/:id | super-admin, brand-admin, customer-service | workspace | all; absent, current |  |
| patch.conversations.id | PATCH | /api/conversations/:id | super-admin, brand-admin, customer-service | workspace | all; absent, current |  |
| delete.conversations.id | DELETE | /api/conversations/:id | super-admin, brand-admin | workspace | all; absent, current |  |
| post.conversations.id.training | POST | /api/conversations/:id/training | super-admin, brand-admin, customer-service | workspace | all; absent, current |  |
| get.privacy | GET | /api/privacy | super-admin, brand-admin | workspace | all; absent, current |  |
| put.privacy | PUT | /api/privacy | super-admin, brand-admin | workspace | all; absent, current |  |
| post.privacy.purge | POST | /api/privacy/purge | super-admin, brand-admin | workspace | all; absent, current |  |
| get.integrations | GET | /api/integrations | super-admin, brand-admin | workspace | all; absent, current |  |
| post.integrations.messenger.mock | POST | /api/integrations/messenger/mock | super-admin, brand-admin | workspace | all; absent, current |  |
| get.agents | GET | /api/agents | super-admin, brand-admin, ai-trainer | workspace | all; absent, current |  |
| post.agents | POST | /api/agents | super-admin, brand-admin, ai-trainer | workspace | all; absent, current |  |
| put.agents.id | PUT | /api/agents/:id | super-admin, brand-admin, ai-trainer | workspace | all; absent, current |  |
| get.channels | GET | /api/channels | super-admin, brand-admin | workspace | all; absent, current |  |
| post.channels | POST | /api/channels | super-admin, brand-admin | workspace | all; absent, current |  |
| put.channels.id | PUT | /api/channels/:id | super-admin, brand-admin | workspace | all; absent, current |  |
| post.channels.id.verify | POST | /api/channels/:id/verify | super-admin | workspace | all; absent, current |  |
| post.channels.id.mock | POST | /api/channels/:id/mock | super-admin, brand-admin | workspace | all; absent, current |  |
| get.webhooks.messenger | GET | /api/webhooks/messenger | unauthenticated | integration | all; absent, current | staging-disabled; verify-token; current-page-binding |
| post.webhooks.messenger | POST | /api/webhooks/messenger | unauthenticated | integration | all; absent, current | staging-disabled; raw-body-signature; current-page-binding |

Viewer knowledge access is published-only and revision history is denied. Viewer and Customer Service cannot read persona/models/agents/channels; AI Trainer may read persona/models/agents and cannot read channels. Server enforcement and generated regression results must be checked on the final immutable candidate.

Verification includes 65 routes × seven principals (455 baseline combinations) plus state and object constraints. Gate allow tests demonstrate policy admission, while real denial tests prove rejected requests do not reach protected handlers. They do not establish exhaustive allowed-handler behavior. Final immutable SHA and final command evidence remain pending.
