import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { candidate, consumeApproval, privatePath, requireGate, verifyGitHub } from './governance.mjs'

export { candidate }
import { expireRecovery } from './expire-recovery.mjs'
import { acceptance, smoke } from './staging-hosted.mjs'
export const migrations = [
  '0001_studio.sql', '0002_conversation_engine.sql', '0003_platform.sql',
  '0004_founder_invariant.sql', '0005_webhook_replay.sql',
]
export const readiness = migrations.at(-1)
const account = '3bdb3fba2669802b6102e0f1953294fe'
const database = '71103118-e36b-4b55-a64d-a8f1d7974903'
const target = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`
const tables = ['brands', 'records', 'revisions', 'usage', 'deliveries', 'messenger_outbox', 'retention', 'studio_search']
const expanded = ['workspace_profiles', 'accounts', 'memberships', 'agents', 'channels', 'platform_usage', 'channel_usage', 'platform_limits', 'platform_audit']

export function releaseGate(env) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  requireGate(!env.GITHUB_ACTIONS && !env.GITHUB_EVENT_NAME, 'GitHub Actions cannot release staging.')
  requireGate(env.STUDIO_STAGING_D1_ID === database && env.CLOUDFLARE_ACCOUNT_ID === account &&
    uuid.test(env.STUDIO_PRODUCTION_D1_ID ?? '') && env.STUDIO_PRODUCTION_D1_ID.toLowerCase() !== database &&
    env.STUDIO_PRODUCTION_D1_ID !== '11111111-1111-4111-8111-111111111111' &&
    (!env.STUDIO_D1_ID || env.STUDIO_D1_ID.toLowerCase() === env.STUDIO_PRODUCTION_D1_ID.toLowerCase()),
  'Exact staging account and a distinct valid production database ID are required.')
  requireGate(env.STAGING_APPROVED_CANDIDATE_SHA === candidate, 'The trusted candidate setting does not match.')
}

export function runtimeKeys(env) {
  const secrets = { ADMIN_SECRET: env.STAGING_ADMIN_SECRET, AUTH_PEPPER: env.STAGING_AUTH_PEPPER }
  if (env.STAGING_CHANNEL_ENCRYPTION_KEY) secrets.CHANNEL_ENCRYPTION_KEY = env.STAGING_CHANNEL_ENCRYPTION_KEY
  const values = [...Object.values(secrets), env.STAGING_RECOVERY_KEY]
  requireGate(env.CLOUDFLARE_API_TOKEN && values.every(value => /^[a-f0-9]{64}$/i.test(value ?? '')) &&
    new Set(values.map(value => value.toLowerCase())).size === values.length,
  'Required staging credentials are missing, invalid or reused.')
  return secrets
}

export function requireQuiescence(subdomain, schedules, domains, pending) {
  requireGate(subdomain?.enabled === false && subdomain.previews_enabled === false &&
    Array.isArray(schedules?.schedules) && schedules.schedules.length === 0 &&
    Array.isArray(domains) && domains.length === 0 && pending === 0, 'Staging is not quiesced.')
}

export function checkLedger(names) {
  requireGate(names.length >= 2 && names.length <= migrations.length &&
    names.every((name, index) => name === migrations[index]), 'Unexpected D1 migration ledger.')
  return names.length
}

export async function snapshot(query, projections, ceilings = {}) {
  if (!projections) {
    const present = new Set((await query("SELECT name FROM sqlite_master WHERE type IN ('table','view')")).map(row => row.name))
    projections = {}
    for (const table of [...tables, ...expanded.filter(name => present.has(name))]) {
      const columns = (await query(`PRAGMA table_info(${table})`)).map(row => row.name)
      requireGate(columns.length && columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column)),
        'Unexpected staging table projection.')
      projections[table] = columns
    }
  }
  const fingerprints = {}
  for (const [table, columns] of Object.entries(projections)) {
    requireGate([...tables, ...expanded].includes(table) && columns.length &&
      columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column)), 'Invalid saved staging projection.')
    const ceiling = ceilings[table]
    requireGate(ceiling === undefined || Number.isSafeInteger(ceiling), 'Invalid staging preservation boundary.')
    const filter = ceiling === undefined ? '' : ` WHERE rowid <= ${ceiling}`
    const hash = createHash('sha256')
    let count = 0
    for (;;) {
      const rows = await query(`SELECT ${columns.map(column => '"' + column + '"').join(',')} FROM ${table}${filter} ORDER BY rowid LIMIT 25 OFFSET ${count}`)
      for (const row of rows) hash.update(JSON.stringify(columns.map(column => row[column])) + '\n')
      count += rows.length
      if (rows.length < 25) break
    }
    const totals = await query(`SELECT count(*) AS total FROM ${table}${filter}`)
    requireGate(totals[0]?.total === count, 'Staging preservation snapshot was incomplete.')
    fingerprints[table] = { count, sha256: hash.digest('hex') }
  }
  const fts = await query("SELECT count(*) AS matches FROM studio_search WHERE studio_search MATCH 'nep* OR studio OR synthetic'")
  requireGate(Number.isInteger(fts[0]?.matches), 'Staging FTS check returned an invalid result.')
  return { projections, fingerprints, fts: fts[0].matches }
}

export function verifyPreservation(before, after) {
  requireGate(JSON.stringify(before) === JSON.stringify(after), 'Staging preservation check failed.')
}

// Migration 0003 seeds one missing persona and its create revision. Every existing row still has to match.
export async function personaSeedBoundary(query, ledgerLength) {
  if (ledgerLength !== 2) return undefined
  const missing = await query("SELECT 1 FROM brands WHERE id='nepmui' AND NOT EXISTS(SELECT 1 FROM records WHERE brand_id='nepmui' AND kind='persona' AND id='config')")
  if (!missing.length) return undefined
  const ceilings = {}
  for (const table of ['records', 'revisions']) {
    ceilings[table] = (await query(`SELECT coalesce(max(rowid),0) AS last FROM ${table}`))[0]?.last
    requireGate(Number.isSafeInteger(ceilings[table]), 'Staging persona preservation boundary is invalid.')
  }
  return ceilings
}

export async function verifyMigratedSnapshot(query, before, ceilings) {
  if (ceilings) {
    requireGate(Number.isSafeInteger(ceilings.records) && Number.isSafeInteger(ceilings.revisions),
      'Invalid saved persona preservation boundary.')
    const added = await query(`SELECT brand_id,kind,id,data,version,updated FROM records WHERE rowid > ${ceilings.records}`)
    const revisions = await query(`SELECT brand_id,kind,record_id,action,data,at FROM revisions WHERE rowid > ${ceilings.revisions}`)
    const row = added[0], revision = revisions[0]
    const expected = '{"prompt":"Bạn là trợ lý chăm sóc khách hàng của NẾP MÙI.","voice":"Ấm áp, tinh tế","rules":"Chuyển câu hỏi chưa có căn cứ cho nhân viên.","language":"vi"}'
    requireGate(added.length === 1 && row.brand_id === 'nepmui' && row.kind === 'persona' &&
      row.id === 'config' && row.version === 1 && row.data === expected &&
      revisions.length === 1 && revision.brand_id === row.brand_id && revision.kind === row.kind &&
      revision.record_id === row.id && revision.action === 'create' && revision.data === expected && revision.at === row.updated,
    'The expected missing-persona backfill was not preserved exactly.')
  }
  verifyPreservation(before, await snapshot(query, before.projections, ceilings))
}

export function validateRecovery(record, current, historical, now = Date.now()) {
  requireGate(record.account === account && record.database === database && record.candidate === candidate,
    'Recovery point does not match the release target.')
  const age = now - Date.parse(record.created)
  requireGate(Number.isFinite(age) && age >= 0 && age <= 15 * 60 * 1000,
    'Recovery point verification expired.')
  requireGate(typeof record.bookmark === 'string' && record.bookmark.length &&
    record.bookmark === current && record.bookmark === historical,
    'Staging bookmark changed or could not be resolved by timestamp.')
}

export function sealRecovery(record, key) {
  requireGate(/^[a-f0-9]{64}$/i.test(key ?? ''), 'Missing or invalid protected recovery encryption key.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
}

export function openRecovery(blob, key) {
  requireGate(/^[a-f0-9]{64}$/i.test(key ?? '') && blob.length > 28, 'Invalid recovery envelope.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), blob.subarray(0, 12))
    decipher.setAuthTag(blob.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString())
  } catch {
    throw new Error('Recovery envelope authentication failed.')
  }
}

async function cloudflare(base, path, token, body) {
  requireGate(token, 'Missing protected staging Cloudflare token.')
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  requireGate(response.ok, 'Staging D1 request failed (HTTP ' + response.status + ').')
  const data = await response.json()
  requireGate(data.success === true, 'Staging D1 rejected the request.')
  return data.result
}

function child(command, args, env, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'pipe', timeout: 15 * 60 * 1000 })
  requireGate(result.status === 0, 'A release subprocess failed. Inspect staging before seeking a new approval.')
}

async function runRelease(env, attempt, evidence, secrets) {
  const key = env.STAGING_RECOVERY_KEY, token = env.CLOUDFLARE_API_TOKEN
  const recovery = env.STAGING_RECOVERY_DIR
  requireGate((await privatePath(recovery, env.APP_DIR, env.OPS_DIR)).isDirectory() &&
    recovery !== env.STAGING_RELEASE_STATE, 'Separate private recovery storage is required.')
  await expireRecovery(recovery)
  const file = join(recovery, evidence.approval.nonce + '.aes256gcm')
  const query = async sql => {
    const result = await cloudflare(target, '/query', token, { sql, params: [] })
    requireGate(Array.isArray(result) && result.length === 1 && result[0].success === true &&
      Array.isArray(result[0].results), 'Incomplete D1 verification query.')
    return result[0].results
  }
  const bookmark = async (timestamp) => (await cloudflare(target, '/time_travel/bookmark' +
    (timestamp ? '?timestamp=' + encodeURIComponent(timestamp) : ''), token)).bookmark
  const ledger = async () => (await query('SELECT name FROM d1_migrations ORDER BY id')).map(row => row.name)
  const validate = async record => validateRecovery(record, await bookmark(), await bookmark(record.created))

  const edge = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`
  const worker = '/scripts/nepmui-ai-studio-staging'
  const quiesced = async () => requireQuiescence(
    await cloudflare(edge, worker + '/subdomain', token),
    await cloudflare(edge, worker + '/schedules', token),
    await cloudflare(edge, '/domains?service=nepmui-ai-studio-staging', token),
    (await query("SELECT count(*) AS total FROM messenger_outbox WHERE channel='messenger-mock' AND state IN ('queued','retry','working','sending')"))[0]?.total)
  const metadata = await cloudflare(target, '', token)
  requireGate(metadata?.uuid === database && metadata.name === 'nepmui-ai-studio-staging', 'Cloudflare staging D1 metadata mismatch.')
  await quiesced()
  const point = await bookmark(), created = new Date().toISOString()
  const names = await ledger(), start = checkLedger(names)
  const recoveryRecord = { account, database, candidate, bookmark: point, created, ledger: names,
    operations: evidence.approval.operations, approval: evidence.tagObject,
    ceilings: await personaSeedBoundary(query, start), snapshot: await snapshot(query) }
  await validate(recoveryRecord)
  await writeFile(file, sealRecovery(recoveryRecord, key), { mode: 0o600, flag: 'wx', flush: true })
  const record = openRecovery(await readFile(file), key)
  verifyPreservation(recoveryRecord, record)
  await writeFile(join(attempt, 'recovery.json'), JSON.stringify({
    sha256: createHash('sha256').update(await readFile(file)).digest('hex'),
    expiresAt: new Date(Date.parse(created) + 6 * 86400000).toISOString(),
  }), { mode: 0o600, flag: 'wx', flush: true })
  console.log('Verified encrypted staging recovery evidence persisted.')
  const before = await ledger()
  verifyPreservation(record.ledger, before)
  checkLedger(before)
  verifyPreservation(record.snapshot, await snapshot(query, record.snapshot.projections))
  await quiesced()
  await validate(record)
  requireFresh(evidence)
  if (start < migrations.length) {
    const result = spawnSync('npm', ['exec', '--', 'cf', 'd1', 'migrations', 'apply', database,
      '--mode', 'staging', '--dir', 'migrations', '--pattern', 'migrations/000[345]_*.sql'], { cwd: env.APP_DIR, env: { ...env, CI: 'true' }, stdio: 'pipe', timeout: 10 * 60 * 1000 })
    requireGate(result.status === 0, 'Staging migrations failed. Inspect the protected ledger before retrying.')
  }
  requireGate(checkLedger(await ledger()) === migrations.length, 'The staging migration ledger is incomplete.')
  await verifyMigratedSnapshot(query, record.snapshot, record.ceilings)
  requireGate((await query('PRAGMA foreign_key_check')).length === 0, 'Staging foreign key verification failed.')
  const profiles = await query('SELECT count(*) AS missing FROM brands b LEFT JOIN workspace_profiles p ON p.brand_id=b.id WHERE p.brand_id IS NULL')
  requireGate(profiles[0]?.missing === 0, 'Workspace profile backfill failed.')
  const usage = await query('SELECT count(*) AS missing FROM (SELECT day,sum(calls) AS calls,sum(reserved_neurons) AS neurons FROM usage GROUP BY day) u LEFT JOIN platform_usage p ON p.day=u.day WHERE p.day IS NULL OR p.calls<>u.calls OR p.neurons<>u.neurons')
  requireGate(usage[0]?.missing === 0, 'Usage backfill does not match staging history.')
  const guards = await query("SELECT count(*) AS total FROM sqlite_master WHERE type='trigger' AND name IN ('require_active_founder_on_insert','require_active_founder_on_update','protect_last_superadmin_delete')")
  requireGate(guards[0]?.total === 3, 'Founder safeguards are incomplete.')
  await quiesced()
  requireFresh(evidence)
  const temp = await mkdtemp(join(tmpdir(), 'studio-runtime-'))
  try {
    const secretFile = join(temp, 'secrets.json')
    await writeFile(secretFile, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' })
    child('npm', ['run', 'deploy:staging'], {
      ...env, CLOUDFLARE_API_TOKEN: token, STUDIO_PLATFORM_MIGRATION_READY: readiness, STUDIO_STAGING_SECRETS_FILE: secretFile,
    }, env.APP_DIR)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
  console.log('Staging migration ledger, data preservation, foreign keys, usage and founder guards verified.')
}

function requireFresh(evidence) {
  const now = Date.now()
  requireGate(now < Date.parse(evidence.approval.expiresAt), 'Approval expired before the next hosted operation.')
  if (evidence.phase === 'release') requireGate(now - Date.parse(evidence.approval.quiescence.checkedAt) <= 30 * 60 * 1000,
    'The signed maintenance evidence expired.')
}

async function main() {
  requireGate(process.argv.length === 2, 'Use a fresh signed approval for a full manual release or acceptance.')
  const env = process.env
  releaseGate(env)
  const evidence = await verifyGitHub(env, candidate)
  const state = env.STAGING_RELEASE_STATE
  requireGate((await privatePath(state, env.APP_DIR, env.OPS_DIR)).isDirectory(), 'A durable private release state directory is required.')
  const secrets = evidence.phase === 'release' ? runtimeKeys(env) : undefined
  if (evidence.phase === 'acceptance') requireGate(env.STAGING_BENCHMARK_EMAIL && env.STAGING_BENCHMARK_PASSWORD &&
    env.STAGING_BENCHMARK_WORKSPACE, 'Acceptance credentials or workspace are missing.')
  const publicEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !/TOKEN|SECRET|PEPPER|PASSWORD|RECOVERY_KEY|ENCRYPTION_KEY/.test(name)))
  const staging = { ...publicEnv, STUDIO_D1_ID: env.STUDIO_PRODUCTION_D1_ID, STUDIO_MESSENGER_INGEST: 'false',
    STUDIO_MESSENGER_OUTBOUND: 'false', STUDIO_BENCHMARK_URL: 'https://nepmui-ai-studio-staging.haonguyen-drew.workers.dev' }
  const lock = join(state, 'active.lock')
  await mkdir(lock, { mode: 0o700 })
  try {
    const attempt = await consumeApproval(state, evidence)
    const hosted = join(env.OPS_DIR, 'ops/staging-hosted.mjs')
    const asset = join(env.APP_DIR, 'public/studio-release.json')
    try {
      child('npm', ['ci'], staging, env.APP_DIR)
      if (evidence.phase === 'release') {
        await writeFile(asset, JSON.stringify({ sha: candidate }), { flag: 'wx' })
        try {
          child('npm', ['run', 'build:staging'], staging, env.APP_DIR)
          child('node', [hosted, 'build'], staging, env.APP_DIR)
          await runRelease({ ...staging, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, STAGING_RECOVERY_KEY: env.STAGING_RECOVERY_KEY },
            attempt, evidence, secrets)
        } finally {
          await rm(asset)
        }
      }
      requireFresh(evidence)
      await smoke()
      if (evidence.phase === 'acceptance') {
        await acceptance({ ...staging, STUDIO_BENCHMARK_EMAIL: env.STAGING_BENCHMARK_EMAIL,
          STUDIO_BENCHMARK_PASSWORD: env.STAGING_BENCHMARK_PASSWORD, STUDIO_BENCHMARK_WORKSPACE: env.STAGING_BENCHMARK_WORKSPACE })
      }
      await writeFile(join(attempt, 'success'), new Date().toISOString(), { mode: 0o600, flag: 'wx', flush: true })
      console.log('Approved staging operation completed.')
    } catch (error) {
      await writeFile(join(attempt, 'failed'), new Date().toISOString(), { mode: 0o600, flag: 'wx', flush: true })
      throw error
    }
  } finally {
    await rm(lock, { recursive: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof SyntaxError ? 'Invalid release evidence.' :
      error.code || error.name !== 'Error' ? 'Staging verification could not complete.' : error.message)
    process.exitCode = 1
  })
}
