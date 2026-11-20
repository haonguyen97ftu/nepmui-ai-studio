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

Diagnostics expose only fixed codes, response type, byte counts, known field-name presence, maximum output tokens, reserved Neurons, numeric provider codes and known schema-keyword names. They contain no question, history, prompt, response text, arbitrary keys, IDs, credentials or exception messages. The authenticated Playground returns them and the synthetic benchmark writes them as JSON to Actions logs. They are not persisted into customer messages. Existing logs/traces configuration is unchanged.

The unchanged original 13 assertions remain the release gate. Two additional hosted checks cover preference continuation and a price/stock follow-up after a synthetic catalog update, including current source version. The [first explicit-schema attempt](https://github.com/haonguyen97ftu/nepmui-ai-studio/actions/runs/44753635674) scored 6/13: all inference requests threw before returning a response (`inference_error`), while the six pre-inference handovers remained correct. Both extra checks failed. Staging limit restoration succeeded. The next revision removes provider-side `uniqueItems` (local duplicate rejection remains mandatory), adds fixed provider-error categories/numeric codes/known schema keywords, and passed hosted evaluation below. Vietnamese editorial review and actual Meta delivery remain separate; Meta needs an approved isolated test Page.

## Optimized hosted acceptance

[Successful staging run 44754252759](https://github.com/haonguyen97ftu/nepmui-ai-studio/actions/runs/44754252759) deployed **`8af07112fb383ea08dddc010d80dbf09196cc6a0`** through the existing staging workflow. Both the deployment job and [release CI](https://github.com/haonguyen97ftu/nepmui-ai-studio/actions/runs/44754242569) completed successfully. This release differs from the rejected provider request by omitting `uniqueItems`; uniqueness is still enforced locally. The hosted provider accepted the simplified schema. No raw provider exception message was collected, so this identifies the incompatible request constraint by the controlled request change rather than a quoted provider error.

| Hosted check | Result |
| --- | --- |
| Original benchmark, unchanged assertions | **13/13 passed** |
| Consultation, fragrance-preference, current-price, stock-check, accent-free | All `generated`, `grounded`, `valid_plan` |
| Policy and care | Both generated with published facts |
| Unknowns, sensitive requests, injection and private data | All required handovers preserved |
| Preference continuation | Passed; uses matching fragrance and does not repeat the answered preference question |
| Price/stock follow-up after catalog mutation | Passed; 265.000 ₫, hết hàng, current source revision, no stale 245.000 price |
| Generated-case latency in original suite | 1,864–4,925 ms; median 3,170 ms (seven cases, one run) |
| Synthetic fixture/conversation cleanup | Succeeded |
| Restore normal staging limits | Succeeded: 20 calls / 4,000 reserved Neurons; cumulative counters unchanged |
| Hosted auth, admin API, Workers AI binding, disabled Messenger ingress/outbound | Passed |

This is one actual hosted evaluation, not a reliability guarantee across repeated runs or a substitute for native Vietnamese editorial review. The model selected tone, closing and current source IDs; application rendering supplied the factual Vietnamese sentences. No paid services, production deployment, main merge or live Messenger activation occurred. Final evidence-only documentation commits do not change the deployed runtime.

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
