import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidate } from './governance.mjs'

const origin = 'https://nepmui-ai-studio-staging.haonguyen-drew.workers.dev'
let cookie, scope

function check(ok, message) {
  if (!ok) throw new Error(message)
}

async function api(path, method = 'GET', body) {
  return fetch(origin + '/api/' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
      ...(scope ? { 'X-Workspace-ID': scope } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function json(path, method, body) {
  const response = await api(path, method, body)
  check(response.ok, 'Staging API operation failed (HTTP ' + response.status + ').')
  return response.json()
}

async function verifyBuild(env) {
  const output = join(env.APP_DIR, '.cloudflare/output/v1/workers/default')
  const config = JSON.parse(await readFile(join(output, 'worker.config.json'), 'utf8'))
  check(config.name === 'nepmui-ai-studio-staging' && config.previewUrls === false &&
    config.env?.DB?.id === env.STUDIO_STAGING_D1_ID && config.env?.AI?.type === 'ai' &&
    config.env?.STUDIO_ENV?.value === 'staging' && config.env?.WORKERS_AI_ENABLED?.value === 'true' &&
    config.env?.MESSENGER_INGEST?.value === 'false' && config.env?.MESSENGER_OUTBOUND?.value === 'false',
  'Staging bundle bindings failed verification.')
  check(JSON.parse(await readFile(join(output, 'assets/studio-release.json'), 'utf8')).sha === candidate,
    'Staging bundle is missing the exact candidate marker.')
}

export async function smoke() {
  let ready = false
  for (let i = 0; i < 12 && !ready; i++) {
    try {
      const release = await fetch(origin + '/studio-release.json?sha=' + candidate,
        { redirect: 'error', signal: AbortSignal.timeout(8000), cache: 'no-store' })
      const state = await json('session')
      ready = release.ok && (await release.json()).sha === candidate &&
        state.staging === true && state.authenticated === false && state.brand === undefined
    } catch {
      // Allow workers.dev routing and assets to propagate after deployment.
    }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 5000))
  }
  check(ready, 'The exact deployed staging candidate was not observed.')
  for (const path of ['overview', 'audit', 'knowledge', 'products', 'training', 'conversations', 'persona', 'models', 'privacy', 'integrations']) {
    check((await api(path)).status === 401, 'A signed-out staging management route was accessible.')
  }
  check((await api('webhooks/messenger')).status === 403 &&
    (await api('webhooks/messenger', 'POST', {})).status === 403, 'Staging webhook ingress was not blocked.')
  console.log('Exact candidate, signed-out gates and blocked Messenger webhook verified.')
}

export async function acceptance(env) {
  const email = env.STUDIO_BENCHMARK_EMAIL, password = env.STUDIO_BENCHMARK_PASSWORD
  const workspace = env.STUDIO_BENCHMARK_WORKSPACE
  check(email && password && /^[a-zA-Z0-9_-]{1,160}$/.test(workspace ?? ''), 'Scoped staging account configuration is missing.')
  const login = await api('session', 'POST', { email, password })
  check(login.ok, 'Scoped staging account login failed.')
  const header = login.headers.get('set-cookie') ?? ''
  cookie = header.split(';')[0]
  try {
    check(cookie.startsWith('__Host-studio=') && /; Secure(?:;|$)/i.test(header) &&
      /; HttpOnly(?:;|$)/i.test(header) && /; SameSite=Strict(?:;|$)/i.test(header), 'Staging session cookie attributes are invalid.')
    await json('workspaces/' + encodeURIComponent(workspace) + '/switch', 'POST')
    const session = await json('session')
    check(session.staging && session.authenticated && session.brand?.id === workspace && session.brand.active &&
      session.user?.role === 'brand-admin' && !session.user.superAdmin, 'Benchmark account or workspace scope mismatch.')
    scope = workspace
    const integrations = await json('integrations')
    check(integrations.messenger === false && integrations.outbound === false, 'Staging Messenger is enabled.')
    const { data: previous, version, aiEnabled } = await json('models')
    const desired = { ...previous, provider: 'workers-ai', dailyLimit: 40, dailyNeurons: 4000 }
    check(aiEnabled, 'Staging Workers AI binding is disabled.')
    const changed = Object.keys(desired).some(key => desired[key] !== previous[key])
    try {
      if (changed) await json('models', 'PUT', { version, data: desired })
      const result = await new Promise((resolve, reject) => {
        const child = spawn('npm', ['run', 'benchmark:staging'], { cwd: env.APP_DIR, stdio: 'inherit', env })
        child.once('error', reject)
        child.once('close', resolve)
      })
      check(result === 0, 'The staging 13+2 benchmark or synthetic cleanup failed.')
    } finally {
      if (changed) {
        const current = await json('models')
        if (current.version === version + 1 && Object.keys(desired).every(key => current.data[key] === desired[key])) {
          await json('models', 'PUT', { version: current.version, data: previous })
        } else {
          check(Object.keys(previous).every(key => current.data[key] === previous[key]),
            'Staging model configuration changed concurrently. Verify protected configuration before retrying.')
        }
        console.log('Staging model configuration restored. Usage counters preserved.')
      }
    }
  } finally {
    if (cookie) {
      check((await api('session', 'DELETE')).ok, 'Staging logout failed.')
      check((await api('knowledge')).status === 401, 'Staging logout did not revoke the session.')
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    check(process.argv[2] === 'build', 'Only an offline build verification is available here.')
    await verifyBuild(process.env)
  } catch (error) {
    console.error(error.name === 'Error' && !error.code ? error.message : 'Staging build verification failed.')
    process.exitCode = 1
  }
}
