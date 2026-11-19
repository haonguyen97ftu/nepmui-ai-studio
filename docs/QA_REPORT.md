# Phase 2 QA report

The cloud workspace and GitHub Actions exercise the built Worker and disposable D1. The browser suite uses Chromium on desktop and an emulated iPhone 15. All product, policy and conversation fixtures are synthetic.

## Evidence

- Vietnamese evaluation fixture covers consultation, fragrance matching, current prices, stock, published and draft policies, unknowns, accent-free questions, private data and prompt injection.
- The Workers AI contract is exercised with injected JSON and invalid response payloads. These tests verify the generation path, persona context, strict source selection, fallbacks and redaction. The staged benchmark requires the real model and measures reason, generation method, content assertions and latency.
- Integration checks cover immediate catalog changes in a follow-up, accent-insensitive knowledge search beyond 200 documents, rollback to draft, source IDs and versions, signed webhook ingestion, disabled staging live messaging, simulation, retries, ambiguous outcomes, takeover and expiry.
- Security checks cover cross-tenant rejection, persisted logout revocation, login rate limiting, privacy deletion and retention.
- Screenshots capture Playground, Knowledge Base, Training and Conversations in desktop and iPhone 15 profiles. GitHub Actions uploads the browser report and screenshots for seven days.

## Live acceptance

No authenticated Cloudflare account was available in the implementation workspace. The staging build and deploy guard can be checked offline. The live Workers AI Vietnamese benchmark, Cloudflare hosted smoke checks, and actual Meta Send API delivery remain pending. Meta delivery should be evaluated in an approved test Page separately from staging.

## Cloud workspace results

| Check | Result |
| --- | --- |
| Node.js 24 clean install, lint and type check | Passed |
| Default Worker and authenticated staging builds | Passed |
| Staging manifest with both live flags injected in the build shell | Correct Worker name, both live settings forced off, Workers AI binding enabled |
| Disposable D1 migrations 0001 and 0002 | Applied, no pending migrations |
| Vitest unit and bundled-Worker integration tests | 29 passed, including all 13 Vietnamese fixture cases |
| Playwright desktop and iPhone 15 emulation | 8 passed, with 2 intentionally profile-specific skips |

Screenshot filenames include `knowledge-*`, `training-*`, `playground-*` and `conversations-*` by browser profile under `test-results/screenshots/`. The hosted suite attaches them to the workflow artifact.
