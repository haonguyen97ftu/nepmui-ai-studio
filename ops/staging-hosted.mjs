import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { candidate, requireGate } from './governance.mjs'

async function verifyBuild(env) {
  const output = join(env.APP_DIR, '.cloudflare/output/v1/workers/default')
  const config = JSON.parse(await readFile(join(output, 'worker.config.json'), 'utf8'))
  requireGate(config.name === 'nepmui-ai-studio-staging' && config.workersDev === true && config.previewUrls === false &&
    config.env?.DB?.id === env.STUDIO_STAGING_D1_ID && config.env?.AI?.type === 'ai' &&
    config.env?.STUDIO_ENV?.value === 'staging' && config.env?.WORKERS_AI_ENABLED?.value === 'true' &&
    config.env?.MESSENGER_INGEST?.value === 'false' && config.env?.MESSENGER_OUTBOUND?.value === 'false',
  'Staging bundle bindings failed verification.')
  requireGate(Array.isArray(config.triggers) && config.triggers.length === 2 &&
    config.triggers.every(trigger => trigger.type === 'scheduled') &&
    config.triggers.map(trigger => trigger.schedule).sort().join('|') === '*/2 * * * *|15 3 * * *',
  'The staging build does not match the reviewed scheduler restoration state.')
  requireGate(JSON.parse(await readFile(join(output, 'assets/studio-release.json'), 'utf8')).sha === candidate,
    'Staging bundle is missing the exact candidate marker.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    requireGate(process.argv.length === 3 && process.argv[2] === 'build', 'Only offline staging build verification is available.')
    await verifyBuild(process.env)
  } catch (error) {
    console.error(error.code ? 'Staging build verification failed.' : error.message)
    process.exitCode = 1
  }
}
