import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { candidate, requireGate } from './governance.mjs'

export { candidate }
export const migrations = [
  '0001_studio.sql', '0002_conversation_engine.sql', '0003_platform.sql',
  '0004_founder_invariant.sql', '0005_webhook_replay.sql',
]
export const readiness = migrations.at(-1)
const account = '3bdb3fba2669802b6102e0f1953294fe'
const database = '71103118-e36b-4b55-a64d-a8f1d7974903'
const tables = ['brands', 'records', 'revisions', 'usage', 'deliveries', 'messenger_outbox', 'retention', 'studio_search']
const expanded = ['workspace_profiles', 'accounts', 'memberships', 'agents', 'channels', 'platform_usage', 'channel_usage', 'platform_limits', 'platform_audit']

export function verifyStagingTarget(env) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  requireGate(env.STUDIO_STAGING_D1_ID === database && env.CLOUDFLARE_ACCOUNT_ID === account &&
    uuid.test(env.STUDIO_PRODUCTION_D1_ID ?? '') && env.STUDIO_PRODUCTION_D1_ID.toLowerCase() !== database &&
    env.STUDIO_PRODUCTION_D1_ID !== '11111111-1111-4111-8111-111111111111' &&
    (!env.STUDIO_D1_ID || env.STUDIO_D1_ID.toLowerCase() === env.STUDIO_PRODUCTION_D1_ID.toLowerCase()),
  'Exact staging account and a distinct valid production database ID are required.')
  requireGate(env.STAGING_APPROVED_CANDIDATE_SHA === candidate, 'The trusted candidate setting does not match.')
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

// Release is intentionally unavailable until an independently controlled cloud executor exists.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.error('Staging release BLOCKED: see ops/RELEASE.md for the cloud-only governance decision.')
  process.exitCode = 1
}
