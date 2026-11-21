import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { candidate, checkLedger, migrations, openRecovery, personaSeedBoundary, readiness, releaseGate, sealRecovery,
  snapshot, validateRecovery, verifyMigratedSnapshot, verifyPreservation } from './staging-release.mjs'

const account = '3bdb3fba2669802b6102e0f1953294fe'
const database = '71103118-e36b-4b55-a64d-a8f1d7974903'
const env = {
  GITHUB_REPOSITORY: 'haonguyen97ftu/nepmui-ai-studio',
  GITHUB_REF: 'refs/heads/ops/nm-ai-deploy-01',
  STUDIO_STAGING_D1_ID: database,
  CLOUDFLARE_ACCOUNT_ID: account,
  STAGING_APPROVED_CANDIDATE_SHA: candidate,
}
const request = { candidate, phase: 'release', quiesced: true }

test('requires approved immutable candidate, exact staging target and quiescence', () => {
  assert.match(candidate, /^[a-f0-9]{40}$/)
  assert.equal(releaseGate(env, request), 'release')
  assert.equal(releaseGate(env, { ...request, phase: 'acceptance', quiesced: false }), 'acceptance')
  for (const patch of [{ GITHUB_REF: 'refs/heads/main' }, { GITHUB_REPOSITORY: 'other/repo' },
    { STUDIO_STAGING_D1_ID: 'wrong' }, { STUDIO_D1_ID: database }, { CLOUDFLARE_ACCOUNT_ID: 'wrong' },
    { STAGING_APPROVED_CANDIDATE_SHA: '' }]) {
    assert.throws(() => releaseGate({ ...env, ...patch }, request))
  }
  for (const patch of [{ candidate: '8af07112' }, { phase: 'restore' }, { quiesced: 'true' }]) {
    assert.throws(() => releaseGate(env, { ...request, ...patch }))
  }
})

test('requires a known ledger prefix and rejects missing, duplicate and reordered migrations', () => {
  for (let n = 2; n <= migrations.length; n++) assert.equal(checkLedger(migrations.slice(0, n)), n)
  for (const names of [[], migrations.slice(1), migrations.toReversed(),
    [...migrations, '0006_unreviewed.sql'], [migrations[0], migrations[0]]]) {
    assert.throws(() => checkLedger(names), /ledger/)
  }
  assert.equal(readiness, '0005_webhook_replay.sql')
})

test('requires fresh, target-bound recovery evidence and authenticates the encrypted envelope', () => {
  const now = Date.now()
  const record = { account, database, candidate, created: new Date(now).toISOString(), bookmark: 'synthetic-only' }
  const key = '11'.repeat(32)
  const blob = sealRecovery(record, key)
  assert.ok(!blob.includes(Buffer.from(record.bookmark)))
  assert.deepEqual(openRecovery(blob, key), record)
  assert.throws(() => openRecovery(blob, '22'.repeat(32)), /authentication/)
  blob[blob.length - 1] ^= 1
  assert.throws(() => openRecovery(blob, key), /authentication/)
  validateRecovery(record, record.bookmark, record.bookmark, now)
  assert.throws(() => validateRecovery(record, 'changed', record.bookmark, now), /bookmark/)
  assert.throws(() => validateRecovery(record, record.bookmark, 'unresolved', now), /bookmark/)
  assert.throws(() => validateRecovery(record, record.bookmark, record.bookmark, now + 16 * 60 * 1000), /expired/)
  assert.throws(() => validateRecovery({ ...record, database: 'other' }, record.bookmark, record.bookmark, now), /target/)
})

test('checks candidate migrations and detects changed rows without a count change', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    const apply = async name => db.exec(await readFile(join(process.env.APP_DIR, 'migrations', name), 'utf8'))
    for (const name of migrations.slice(0, 2)) await apply(name)
    const query = async sql => db.prepare(sql).all()
    const insert = db.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES ('nepmui','knowledge',?,?,1)")
    for (let index = 0; index < 51; index++) insert.run('synthetic-' + index,
      JSON.stringify({ title: 'Synthetic', body: 'Synthetic fixture', status: 'published' }))
    db.exec("INSERT INTO usage VALUES ('nepmui','2055-01-01',3,99)")
    db.exec("INSERT INTO messenger_outbox(brand_id,channel,external_id,thread_id,recipient,question,received,due) VALUES ('nepmui','messenger','synthetic','thread','recipient','Synthetic',1,1)")
    const before = await snapshot(query)
    const ceilings = await personaSeedBoundary(query, 2)
    assert.equal(before.fingerprints.records.count, 51)
    assert.equal(before.fts, 51)
    for (const name of migrations.slice(2)) await apply(name)
    await verifyMigratedSnapshot(query, before, ceilings)
    assert.deepEqual(await query('PRAGMA foreign_key_check'), [])
    const after = await snapshot(query)
    assert.ok(after.projections.accounts.includes('auth_version'))
    assert.ok(after.projections.messenger_outbox.includes('connection_id'))
    db.exec("UPDATE records SET updated=2 WHERE id='synthetic-50'")
    const changed = await snapshot(query, before.projections, ceilings)
    assert.throws(() => verifyPreservation(before, changed), /preservation/)
  } finally {
    db.close()
  }
})

test('release workflow only admits staging and gates migrations on uploaded recovery evidence', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8')
  assert.match(workflow, /paths: \['\.github\/staging-deploy\.request'\]/)
  assert.match(workflow, /name: nepmui-staging/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /STUDIO_MESSENGER_INGEST: 'false'\s+STUDIO_MESSENGER_OUTBOUND: 'false'/)
  assert.match(workflow, /RECOVERY_ARTIFACT_ID: \$\{\{ steps.recovery.outputs.artifact-id \}\}/)
  assert.match(workflow, /STUDIO_PLATFORM_MIGRATION_READY: \$\{\{ steps.migration.outputs.readiness \}\}/)
  assert.match(workflow, /test "\$STUDIO_PLATFORM_MIGRATION_READY" = 0005_webhook_replay\.sql/)
  assert.doesNotMatch(workflow, /STUDIO_BENCHMARK_ADMIN_SECRET|time_travel\/restore/)
})


test('candidate benchmark keeps the 13+2 cases and requires scoped account credentials', async () => {
  const script = await readFile(join(process.env.APP_DIR, 'scripts/benchmark-staging.mjs'), 'utf8')
  const fixture = JSON.parse(await readFile(join(process.env.APP_DIR, 'tests/fixtures/evaluation.json'), 'utf8'))
  assert.equal(fixture.cases.length, 13)
  assert.match(script, /multi-turn-preference/)
  assert.match(script, /multi-turn-current-catalog/)
  assert.match(script, /STUDIO_BENCHMARK_PASSWORD/)
  assert.match(script, /workspaces\/.*\/switch/)
  assert.doesNotMatch(script, /STUDIO_BENCHMARK_ADMIN_SECRET/)
})
