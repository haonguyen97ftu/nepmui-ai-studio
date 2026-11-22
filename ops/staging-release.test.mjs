import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { candidate, checkLedger, migrations, openRecovery, personaSeedBoundary, readiness, verifyStagingTarget, requireQuiescence, sealRecovery,
  snapshot, validateRecovery, verifyMigratedSnapshot, verifyPreservation } from './staging-release.mjs'

const account = '3bdb3fba2669802b6102e0f1953294fe'
const database = '71103118-e36b-4b55-a64d-a8f1d7974903'
const env = {
  STUDIO_STAGING_D1_ID: database,
  STUDIO_PRODUCTION_D1_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  CLOUDFLARE_ACCOUNT_ID: account,
  STAGING_APPROVED_CANDIDATE_SHA: candidate,
}

test('requires the candidate and explicit staging/production separation', () => {
  assert.match(candidate, /^[a-f0-9]{40}$/)
  verifyStagingTarget(env)
  for (const patch of [{ STUDIO_STAGING_D1_ID: 'wrong' }, { STUDIO_PRODUCTION_D1_ID: database.toUpperCase() },
    { STUDIO_PRODUCTION_D1_ID: '' }, { STUDIO_PRODUCTION_D1_ID: '11111111-1111-4111-8111-111111111111' },
    { STUDIO_PRODUCTION_D1_ID: 'invalid' }, { STUDIO_D1_ID: database }, { CLOUDFLARE_ACCOUNT_ID: 'wrong' },
    { STAGING_APPROVED_CANDIDATE_SHA: '' }]) {
    assert.throws(() => verifyStagingTarget({ ...env, ...patch }))
  }
})

test('rejects active staging ingress and scheduled work in maintenance evidence', () => {
  const subdomain = { enabled: false, previews_enabled: false }, schedules = { schedules: [] }
  requireQuiescence(subdomain, schedules, [], 0)
  for (const args of [[{ ...subdomain, enabled: true }, schedules, [], 0],
    [{ enabled: false }, schedules, [], 0], [subdomain, { schedules: [{ cron: '* * * * *' }] }, [], 0],
    [subdomain, schedules, [{}], 0], [subdomain, schedules, [], 1], [subdomain, schedules, [], undefined]]) {
    assert.throws(() => requireQuiescence(...args), /quiesced/)
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

test('release workflow has no push, environment, token or hosted release execution', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions: {}/)
  assert.match(workflow, /exit 1/)
  assert.doesNotMatch(workflow, /push:|workflow_run:|environment:|secrets\.|checkout|CLOUDFLARE_API_TOKEN|deploy:staging/)

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

test('all release and legacy entrypoints fail closed regardless of runner or approval variables', async () => {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const release = fileURLToPath(new URL('./staging-release.mjs', import.meta.url))
  const hosted = fileURLToPath(new URL('./staging-hosted.mjs', import.meta.url))
  for (const event of ['', 'push', 'workflow_dispatch', 'workflow_run']) {
    for (const args of [[], ['backup'], ['migrate'], ['deploy'], ['acceptance']]) {
      const result = spawnSync(process.execPath, [release, ...args], {
        encoding: 'utf8', env: { ...env, GITHUB_EVENT_NAME: event, GITHUB_RUN_ATTEMPT: '2',
          STUDIO_PLATFORM_MIGRATION_READY: readiness, STAGING_APPROVAL_TAG: 'staging-approval-fixture',
          STAGING_RELEASE_STATE: '/unused-local-ledger', CLOUDFLARE_API_TOKEN: 'synthetic-only' },
      })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Staging release BLOCKED/)
    }
  }
  for (const command of ['smoke', 'acceptance']) {
    const result = spawnSync(process.execPath, [hosted, command], { encoding: 'utf8', env })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Only offline/)
  }
})
