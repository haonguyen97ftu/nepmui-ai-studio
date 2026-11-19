import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'nepmui-ai-studio',
    entrypoint: './worker/index.ts',
    compatibilityDate: '2026-11-19',
    workersDev: true,
    previewUrls: false,
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*'] },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: false },
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
    env: {
      BRAND_ID: bindings.text('nepmui'),
      DB: bindings.d1({ id: process.env.STUDIO_D1_ID || '11111111-1111-4111-8111-111111111111' }),
      AI: bindings.ai(),
      WORKERS_AI_ENABLED: bindings.text(process.env.STUDIO_WORKERS_AI_ENABLED === 'true' ? 'true' : 'false'),
      MESSENGER_INGEST: bindings.text(process.env.STUDIO_MESSENGER_INGEST === 'true' ? 'true' : 'false'),
    },
  },
})
