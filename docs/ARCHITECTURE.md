# Architecture

```mermaid
flowchart LR
    Admin[Admin browser] --> Assets[Workers Static Assets]
    Admin -->|Same-origin API| API[Hono Worker]
    Meta -->|Verified ingress after approval| API
    API --> DB[(Cloudflare D1)]
    API --> Mock[Mock provider]
    API -->|Opt-in| AI[Workers AI]
    GitHub[GitHub Actions] --> Build[Build and browser artifacts]
```

React 19, TypeScript and Vite build the client. Tailwind CSS and a shadcn-style Button built on Radix Slot and CVA provide UI primitives. Navigation copy is keyed with Vietnamese and English equivalents. The interface and forms currently ship in Vietnamese. All fonts and UI assets are served by the Worker.

Hono handles session, CRUD, inference, audit and webhook routes. D1 is accessed through Drizzle for typed scoped CRUD and parameterized D1 statements for atomic SQL operations. The schema uses a typed JSON record per tenant and entity type. Zod validates writes. Composite keys include `brand_id`. One active brand is enforced in the migration. The Worker selects it through `BRAND_ID`, authenticated cookies are bound to it, and the frontend has no brand override.

Knowledge and review updates use compare-and-swap versions. A correction becomes a published knowledge entry in the same D1 batch that advances the correction. Audit SQL triggers record entity versions alongside writes. Conversation audit entries retain status only. Messenger delivery admission and conversation append are atomic. D1 FTS5 indexes knowledge and catalog titles and text across the full corpus. Retrieval fetches up to eight ranked results of each kind and forwards up to four qualified candidates of each kind to Workers AI. The model composes a strict response plan using conversation context and the administrator persona. The application validates IDs, renders published knowledge and current structured product facts, and records selected source IDs and versions. Unknown, sensitive, unavailable and budget-limited cases enter handover.

The mock and Workers AI paths share fact validation and rendering. Gemini and OpenAI can implement it in the future. The channel adapter contract normalizes inputs, while Messenger uses signed ingress and a D1 outbox to schedule replies. The Graph Send API adapter is disabled by default and hard-blocked in staging. Instagram and Website adapter contracts accept normalized events for future transport integration.

Cloudflare configuration follows the current programmatic CLI approach. The package lock reproducibly pins the matching Cloudflare CLI and Vite plugin release candidates. The cloud workspace and CI run Miniflare with a disposable D1 instance for tests. The Cloudflare deployment requires a separately provisioned D1 database.

[Cloudflare programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/) · [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) · [D1 Worker API and batch](https://developers.cloudflare.com/d1/worker-api/d1-database/) · [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
