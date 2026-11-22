import { spawn, spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { candidate, releaseGate, readiness } from './staging-release.mjs'

const env = process.env
const origin = 'https://nepmui-ai-studio-staging.haonguyen-drew.workers.dev'
const command = process.argv[2]
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

async function verifyBuild() {
  const output = join(env.APP_DIR, '.cloudflare/output/v1/workers/default')
  const config = JSON.parse(await readFile(join(output, 'worker.config.json'), 'utf8'))
  check(config.name === 'nepmui-ai-studio-staging' && config.workersDev === true && config.previewUrls === false &&
    config.env?.DB?.id === env.STUDIO_STAGING_D1_ID && config.env?.AI?.type === 'ai' &&
    config.env?.STUDIO_ENV?.value === 'staging' && config.env?.WORKERS_AI_ENABLED?.value === 'true' &&
    config.env?.MESSENGER_INGEST?.value === 'false' && config.env?.MESSENGER_OUTBOUND?.value === 'false',
  'Staging bundle bindings failed verification.')
  check(JSON.parse(await readFile(join(output, 'assets/studio-release.json'), 'utf8')).sha === candidate,
    'Staging bundle is missing the exact candidate marker.')
}

async function prepareSecrets() {
  const secrets = { ADMIN_SECRET: env.ADMIN_SECRET, AUTH_PEPPER: env.AUTH_PEPPER }
  if (env.CHANNEL_ENCRYPTION_KEY) secrets.CHANNEL_ENCRYPTION_KEY = env.CHANNEL_ENCRYPTION_KEY
  const values = [...Object.values(secrets), env.STAGING_RECOVERY_KEY]
  check(values.every(value => /^[a-f0-9]{64}$/i.test(value ?? '')) &&
    new Set(values.map(value => value.toLowerCase())).size === values.length,
  'Required protected staging keys must be distinct 32-byte hex values.')
  await writeFile(join(env.RUNNER_TEMP, 'studio-runtime-secrets.json'), JSON.stringify(secrets), { mode: 0o600, flag: 'wx' })
}

async function deploy() {
  check(releaseGate(env) === 'release' && env.STUDIO_PLATFORM_MIGRATION_READY === readiness &&
    env.CLOUDFLARE_API_TOKEN && env.STUDIO_STAGING_SECRETS_FILE, 'Verified staging migration and deploy credentials are required.')
  await verifyBuild()
  const { ADMIN_SECRET, AUTH_PEPPER, CHANNEL_ENCRYPTION_KEY, ...clean } = env
  const result = spawnSync(join(env.APP_DIR, 'node_modules/.bin/cf'),
    ['deploy', '--prebuilt', '--mode', 'staging', '--no-provision', '--secrets-file', env.STUDIO_STAGING_SECRETS_FILE],
    { cwd: env.APP_DIR, env: clean, stdio: 'inherit' })
  check(result.status === 0, 'Staging Worker deployment failed.')
}

async function smoke() {
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

async function acceptance() {
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
        const child = spawn('npm', ['run', 'benchmark:staging'], { cwd: env.APP_DIR, stdio: 'inherit' })
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

try {
  check(env.STUDIO_BENCHMARK_URL === origin, 'Unexpected staging Worker URL.')
  const commands = { build: verifyBuild, secrets: prepareSecrets, smoke, acceptance, deploy }
  if (command !== 'build') releaseGate(env)
  check(Object.hasOwn(commands, command), 'Unknown staging operation.')
  await commands[command]()
} catch (error) {
  console.error(error.name === 'Error' && !error.code ? error.message : 'Staging operation failed.')
  process.exitCode = 1
}
