# NM-AI-03 QA report

The cloud workspace and GitHub Actions exercise the built Worker and disposable D1. The browser suite uses Chromium on desktop and an emulated iPhone 15. All product, policy and conversation fixtures are synthetic.

## Evidence

- Vietnamese evaluation fixture covers consultation, fragrance matching, current prices, stock, published and draft policies, unknowns, accent-free questions, private data and prompt injection.
- The Workers AI contract is exercised with injected JSON and invalid response payloads. These tests verify the generation path, persona context, strict source selection, fallbacks and redaction. The staged benchmark requires the real model and measures reason, generation method, content assertions and latency.
- Integration checks cover immediate catalog changes in a follow-up, accent-insensitive knowledge search beyond 200 documents, rollback to draft, source IDs and versions, signed webhook ingestion, disabled staging live messaging, simulation, retries, ambiguous outcomes, takeover and expiry.
- Security checks cover cross-tenant rejection, persisted logout revocation, login rate limiting, privacy deletion and retention.
- Screenshots capture Playground, Knowledge Base, Training and Conversations in desktop and iPhone 15 profiles. GitHub Actions uploads the browser report and screenshots for seven days.

## Live acceptance

Staging is deployed at https://nepmui-ai-studio-staging.haonguyen-drew.workers.dev through the existing `ops/nm-ai-deploy-01` GitHub Actions workflow and `nepmui-staging` environment. Local Cloudflare credentials are unnecessary. Production and live Messenger remain disabled and outside this change.

The [initial hosted run](https://github.com/haonguyen97ftu/nepmui-ai-studio/actions/runs/44750344500) scored **8/13**. The [diagnostic reproduction](https://github.com/haonguyen97ftu/nepmui-ai-studio/actions/runs/44752489151), deploying `9bc0668776aea9e1c27d4cbedf1d7aefc802fc61`, also scored **8/13**. Consultation, fragrance-preference, current-price, stock-check and accent-free all reached inference and returned an object with the five expected field names, but failed local plan-schema validation (`invalid_schema`). Policy and care returned valid plans. Retrieval found facts and quota reservation succeeded for each failed case. These observations rule out retrieval misses, quota rejection, transport errors and JSON-string parsing as the cause of this reproduction. No raw model output was collected, so the exact invalid field/value in the old response is deliberately unknown; token truncation was not demonstrated.

The optimization requests Cloudflare `json_schema` with required typed fields, supported tone/closing values, current candidate ID enums and bounded unique arrays. A 512-token ceiling replaces 256, and the complete request including the schema is included in the conservative UTF-8-byte input reservation. Local strict validation, source membership checks, deterministic factual rendering, fallback and human handover remain mandatory. There is no unreserved retry. Prices and stock always come from the current catalog revision; knowledge remains published-only. “Generated” means a valid model-composed reply plan rendered with trusted facts, not unrestricted model prose.

Diagnostics expose only fixed codes, response type, byte counts, known field-name presence, maximum output tokens and reserved Neurons. They contain no question, history, prompt, response text, arbitrary keys, IDs, credentials or exception messages. The authenticated Playground returns them and the synthetic benchmark writes them as JSON to Actions logs. They are not persisted into customer messages. Existing logs/traces configuration is unchanged.

The unchanged original 13 assertions remain the release gate. Two additional hosted checks cover preference continuation and a price/stock follow-up after a synthetic catalog update, including current source version. The optimized hosted result is pending below. Vietnamese editorial review and actual Meta delivery remain separate; Meta needs an approved isolated test Page.

## Cloud workspace results

| Check | Result |
| --- | --- |
| Node.js 24 clean install, lint and type check | Passed |
| Default Worker and authenticated staging builds | Passed |
| Staging manifest with both live flags injected in the build shell | Correct Worker name, both live settings forced off, Workers AI binding enabled |
| Disposable D1 migrations 0001 and 0002 | Applied, no pending migrations |
| Vitest unit and bundled-Worker integration tests | 51 passed, including all 13 Vietnamese fixture cases and 22 inference regressions |
| Playwright desktop and iPhone 15 emulation | 8 passed, with 2 intentionally profile-specific skips |

Screenshot filenames include `knowledge-*`, `training-*`, `playground-*` and `conversations-*` by browser profile under `test-results/screenshots/`. The hosted suite attaches them to the workflow artifact.

## Model evaluation (20 November 2026)

Cloudflare's [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) states a shared 10,000-Neuron daily free allocation, reset at 00:00 UTC. A listed rate alone does not prove current availability or Vietnamese quality. These are documentation-based evaluations; no alternative-model quality score is claimed.

| Candidate | Neurons per million input / output tokens | Assessment |
| --- | --- | --- |
| [Llama 3.3 70B FP8 fast](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) | 26,668 / 204,805 | Retained: current 24k context and documented JSON Mode support; fix the observed contract failure before switching models. |
| [Mistral Small 3.1 24B](https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/) | 31,876 / 50,488 | Available 128k-context candidate; cheaper output, slightly dearer input. JSON-schema behavior and Vietnamese benchmark still need verification before allowlisting. |
| [Gemma SEA-LION v4 27B](https://developers.cloudflare.com/workers-ai/models/gemma-sea-lion-v4-27b-it/) | 31,876 / 50,488 | Available 128k-context candidate trained for Southeast Asian languages; promising for Vietnamese evaluation. No demonstrated compatibility with this schema contract. |
| [Qwen3 30B A3B FP8](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/) | 4,625 / 30,475 | Current page marks deprecated on 20 November 2026; completion envelope uses `choices`, so it is not a drop-in replacement for `response`. Not enabled. |
| [Llama 3.1 8B FP8](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/) | 13,778 / 26,128 | Current page marks deprecated on 20 November 2026. The unquantized 8B page redirects to unavailable despite the older JSON Mode list. Not enabled. |
| [DeepSeek R1 Distill Qwen 32B](https://developers.cloudflare.com/workers-ai/models/deepseek-r1-distill-qwen-32b/) | 45,170 / 443,756 | Deprecated on 20 November 2026, reasoning adds latency and output cost. Not enabled. |

The [JSON Mode documentation](https://developers.cloudflare.com/workers-ai/features/json-mode/) accepts a raw schema under `response_format.json_schema` and documents object-valued `response` as well as JSON-mode errors. The parser supports object and string JSON, rejects malformed/unsupported output and never coerces fabricated facts. Keep the single-model allowlist until a candidate passes the same hosted assertions, context/security checks and Vietnamese review with its own conservative cost reservation.
