import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const candidate = '81a1cca134dd797820023d053a98c73e8d21c81d'
export const migrations = [
  '0001_studio.sql', '0002_conversation_engine.sql', '0003_platform.sql',
  '0004_founder_invariant.sql', '0005_webhook_replay.sql',
]
export const readiness = migrations.at(-1)
const repo = 'haonguyen97ftu/nepmui-ai-studio'
const branch = 'refs/heads/main'
const founder = 'haonguyen97ftu'
const account = '3bdb3fba2669802b6102e0f1953294fe'
const database = '71103118-e36b-4b55-a64d-a8f1d7974903'
const target = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`
const tables = ['brands', 'records', 'revisions', 'usage', 'deliveries', 'messenger_outbox', 'retention', 'studio_search']
const expanded = ['workspace_profiles', 'accounts', 'memberships', 'agents', 'channels', 'platform_usage', 'channel_usage', 'platform_limits', 'platform_audit']

function requireGate(ok, message) {
  if (!ok) throw new Error(message)
}

export function releaseGate(env) {
  requireGate(env.GITHUB_REPOSITORY === repo && env.GITHUB_REF === branch &&
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_ACTOR === founder &&
    env.TRIGGERING_ACTOR === founder && env.GITHUB_RUN_ATTEMPT === '1', 'Founder dispatch from the default branch is required.')
  const production = env.STUDIO_PRODUCTION_D1_ID?.toLowerCase()
  requireGate(env.STUDIO_STAGING_D1_ID === database && env.CLOUDFLARE_ACCOUNT_ID === account &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(production ?? '') &&
    production !== database && production !== '11111111-1111-4111-8111-111111111111',
  'Explicit, distinct staging and production D1 targets are required.')
  requireGate(['release', 'benchmark'].includes(env.REQUESTED_PHASE), 'Invalid staging phase.')
  return env.REQUESTED_PHASE
}

export function verifyCI(run) {
  requireGate(run.id === 44860248725 && run.head_sha === candidate && run.head_branch === 'feat/nepmui-studio-mvp' &&
    run.repository?.full_name === repo && run.head_repository?.full_name === repo && run.event === 'pull_request' &&
    run.path === '.github/workflows/ci.yml' && run.status === 'completed' && run.conclusion === 'success',
  'The pinned application CI run is not successful.')
}

export function verifyQuiescence(subdomain, schedules, domains, pending) {
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

async function cloudflare(path, token, body, base = target) {
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

async function main(command) {
  const env = process.env
  const phase = releaseGate(env)
  if (command === 'check') {
    requireGate(env.GITHUB_TOKEN, 'GitHub CI read access is missing.')
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/44860248725`, {
      redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN },
    })
    requireGate(response.ok, 'Cannot verify exact candidate CI.')
    verifyCI(await response.json())
    return
  }
  requireGate(phase === 'release' && ['backup', 'migrate'].includes(command), 'Invalid staging operation for requested phase.')
  const key = env.STAGING_RECOVERY_KEY
  const token = env.CLOUDFLARE_API_TOKEN
  const file = join(env.RUNNER_TEMP, 'studio-recovery', 'recovery.aes256gcm')
  const query = async sql => {
    const result = await cloudflare('/query', token, { sql, params: [] })
    requireGate(Array.isArray(result) && result.length === 1 && result[0].success === true &&
      Array.isArray(result[0].results), 'Incomplete D1 verification query.')
    return result[0].results
  }
  const bookmark = async (timestamp) => (await cloudflare('/time_travel/bookmark' +
    (timestamp ? '?timestamp=' + encodeURIComponent(timestamp) : ''), token)).bookmark
  const ledger = async () => (await query('SELECT name FROM d1_migrations ORDER BY id')).map(row => row.name)
  const validate = async record => validateRecovery(record, await bookmark(), await bookmark(record.created))

  const metadata = await cloudflare('', token)
  requireGate(metadata?.uuid === database && metadata.name === 'nepmui-ai-studio-staging', 'Cloudflare staging D1 metadata mismatch.')
  const edge = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`
  const worker = '/scripts/nepmui-ai-studio-staging'
  const quiesced = async () => verifyQuiescence(
    await cloudflare(worker + '/subdomain', token, undefined, edge),
    await cloudflare(worker + '/schedules', token, undefined, edge),
    await cloudflare('/domains?service=nepmui-ai-studio-staging', token, undefined, edge),
    (await query("SELECT count(*) AS total FROM messenger_outbox WHERE channel='messenger-mock' AND state IN ('queued','retry','working','sending')"))[0]?.total)
  await quiesced()

  if (command === 'backup') {
    requireGate(/^[a-f0-9]{64}$/i.test(key ?? ''), 'Missing protected recovery encryption key.')
    const point = await bookmark()
    const created = new Date().toISOString()
    const names = await ledger()
    const start = checkLedger(names)
    const record = { account, database, candidate, bookmark: point, created, ledger: names,
      ceilings: await personaSeedBoundary(query, start), snapshot: await snapshot(query) }
    await validate(record)
    await mkdir(join(env.RUNNER_TEMP, 'studio-recovery'), { mode: 0o700 })
    const sealed = sealRecovery(record, key)
    verifyPreservation(record, openRecovery(sealed, key))
    await writeFile(file, sealed, { mode: 0o600, flag: 'wx' })
    console.log('Verified staging Time Travel reference and built an authenticated encrypted recovery artifact.')
    return
  }

  requireGate(env.RECOVERY_ARTIFACT_ID && /^\d+$/.test(env.RECOVERY_ARTIFACT_ID), 'Protected recovery artifact upload was not confirmed.')
  const record = openRecovery(await readFile(file), key)
  const before = await ledger()
  verifyPreservation(record.ledger, before)
  const start = checkLedger(before)
  verifyPreservation(record.snapshot, await snapshot(query, record.snapshot.projections))
  await quiesced()
  await validate(record)
  if (start < migrations.length) {
    const result = spawnSync('npm', ['exec', '--', 'cf', 'd1', 'migrations', 'apply', database,
      '--mode', 'staging', '--dir', 'migrations', '--pattern', 'migrations/000[345]_*.sql'], { cwd: env.APP_DIR, stdio: 'pipe' })
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
  await writeFile(env.GITHUB_OUTPUT, `readiness=${readiness}\n`, { flag: 'a' })
  console.log('Staging migration ledger, data preservation, foreign keys, usage and founder guards verified.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv[2]).catch(error => {
    // Only emit fixed operational errors. Provider bodies, SQL data and credentials remain private.
    console.error(error instanceof SyntaxError ? 'Invalid staging configuration or response.' :
      error.code || error.name !== 'Error' ? 'Staging verification could not complete.' : error.message)
    process.exitCode = 1
  })
}
