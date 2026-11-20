# Roadmap

## Implemented candidate: NM-AI-04

- Neutral AI Studio platform with NẾP MÙI preserved as the first workspace.
- Multiple active/inactive/archived workspaces, scoped profiles, account membership and five server-enforced roles.
- Workspace selector, Super Admin dashboard, onboarding, channel registry, team manager, reusable agents and usage views on desktop/mobile.
- Multi-Page mock routing, encrypted Page tokens, separately verified live route ownership, per-Page takeover, shared factual AI engine and atomic fair quotas.
- Non-destructive disposable-D1 migration tests and gated staging backup/recovery procedure.

## Next approval gate

1. Review PR #1, migration preservation evidence, security findings and screenshots.
2. Approve the staging recovery point, additive migration and pinned release through the existing GitHub Actions/environment infrastructure.
3. Provision protected `AUTH_PEPPER` and optional Page encryption key, migrate and claim the founder account. Keep both live Messenger flags false.
4. Re-run the unchanged 13 original hosted scenarios and two multi-turn checks with a scoped benchmark account after sufficient UTC quota headroom exists. Record actual Free-plan authentication CPU/latency and a Vietnamese reviewer's tone assessment.

The last approved hosted runtime remains NM-AI-03 until that gate completes. New hosted acceptance is not implied by local tests.

## Later work, separate scope

- Optional Access/OIDC or another reviewed authentication provider, MFA, public invitation/recovery and verified identity onboarding.
- Approved Meta test-Page transport rollout, OAuth permissions, delivery reconciliation and migration/disposition of legacy live jobs. Production and live activation each need separate approval.
- Public Instagram and website-widget transports, English operator UI and richer multilingual retrieval. Registry/adapter interfaces already exist.
- Evaluate PDF.js and Mammoth in bounded client workers for text PDF/DOCX import; preserve review-before-publication. Scanned formats need a separately reviewed OCR choice.
- Privacy-request replay suppression, export and backup lifecycle controls.

No SaaS billing, subscription system, domain purchase or paid infrastructure is planned in this change.
