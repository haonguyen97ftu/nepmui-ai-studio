import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const output = new URL('../.cloudflare/output/v1/workers/default/', import.meta.url)
const migrations = new URL('../migrations/', import.meta.url)

export async function runtime(bindings = {}, port = 0, initialization = () => {}) {
  const config = JSON.parse(await readFile(new URL('worker.config.json', output), 'utf8'))
  const entrypoint = config.manifest.mainModule
  const contents = await readFile(new URL('bundle/' + entrypoint, output), 'utf8')
  const env = Object.fromEntries(Object.entries({ BRAND_ID: 'nepmui', ...bindings })
    .map(([name, value]) => [name, { type: 'text', value }]))
  const app = new Miniflare({
    host: '127.0.0.1', port, enableDevRegistry: false, logRequests: false, cf: false,
    workers: [{
      config: {
        name: 'studio', compatibilityDate: config.compatibilityDate,
        manifest: { mainModule: entrypoint, modules: { [entrypoint]: { type: 'esm', contents } } },
        assets: { ...config.assets, directory: fileURLToPath(new URL('assets/', output)), hasUserWorker: true },
        env: { ...env, DB: { type: 'd1', id: 'studio-test' } },
      },
    }],
  })
  try {
    const db = await app.getD1Database('DB')
    for (const filename of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(filename, migrations), 'utf8')
      await db.batch(sql.split(/^-- studio-statement$/m).filter(statement => statement.trim()).map(statement => db.prepare(statement)))
    }
    await initialization(db)
    return { app, db, url: await app.ready }
  } catch (error) {
    await app.dispose()
    throw error
  }
}
