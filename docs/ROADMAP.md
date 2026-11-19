# Roadmap

## Phase 2 staging acceptance

- Provision authenticated staging on Workers Free and run the Vietnamese benchmark with real Workers AI.
- Review tone, multi-turn recommendations, privacy redaction and difficult policy questions with a Vietnamese reviewer.
- Verify retention and human takeover with staged synthetic data. Keep live Messenger off.

## Import evaluation

| Format | Phase 2 outcome |
| --- | --- |
| CSV, TXT and Markdown | Existing draft import remains supported and browser tested |
| Text PDF | Evaluate Mozilla PDF.js for isolated client-side text extraction. It needs page and byte limits, a Worker bundle, meaningful text-order handling, and browser performance checks. Image-only PDFs would need separate OCR |
| DOCX | Evaluate Mammoth raw-text extraction in an isolated client worker. Add ZIP expansion, entry-count, file-size and time limits. Use text output only and keep review-before-publication |
| Scanned PDF and legacy DOC | Keep manual conversion until an affordable, privacy-reviewed option is validated |

Neither candidate library requires paid API calls. Phase 2 ships the evaluation and leaves extraction of unsupported formats to a separate change. [PDF.js](https://mozilla.github.io/pdf.js/) · [Mammoth](https://github.com/mwilliamson/mammoth.js)

## Later milestones

- Add individual accounts, reviewer roles and auditable operator ownership.
- Test Meta App Review, delivery telemetry and manual reconciliation on an approved test Page before seeking outbound production approval.
- Improve multilingual retrieval relevance, product intent, and the Vietnamese benchmark with founder-approved examples.
- Add explicit privacy-request suppression and verification for external-channel replays and backup lifecycle.
- Complete English UI and assess transport adapters for Instagram and the website.
