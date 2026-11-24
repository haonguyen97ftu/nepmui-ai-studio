import { bindings, defineConfig, triggers } from 'cf/config'

export default defineConfig(({ mode }) => {
  const staging = mode === 'staging'
  const liveMessenger = !staging && process.env.STUDIO_MESSENGER_INGEST === 'true'
  const outbound = liveMessenger && process.env.STUDIO_MESSENGER_OUTBOUND === 'true'
  return {
    worker: {
      name: staging ? 'nepmui-ai-studio-staging' : 'nepmui-ai-studio',
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
      triggers: [triggers.scheduled({ schedule: '15 3 * * *' }), triggers.scheduled({ schedule: '*/2 * * * *' })],
      env: {
        DB: bindings.d1({ id: (staging ? process.env.STUDIO_STAGING_D1_ID : process.env.STUDIO_D1_ID) || '11111111-1111-4111-8111-111111111111' }),
        AI: bindings.ai(),
        WORKERS_AI_ENABLED: bindings.text(staging || process.env.STUDIO_WORKERS_AI_ENABLED === 'true' ? 'true' : 'false'),
        STUDIO_ENV: bindings.text(staging ? 'staging' : 'production'),
        MESSENGER_INGEST: bindings.text(String(liveMessenger)),
        MESSENGER_OUTBOUND: bindings.text(String(outbound)),
      },
    },
  }
})
