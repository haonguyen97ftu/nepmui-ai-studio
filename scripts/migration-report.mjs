import assert from 'node:assert/strict'
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {runtime} from './runtime.mjs'

const instance=await runtime({},0,()=>{},2)
const migrationFiles=(await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort().slice(2)
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
try {
  const db=instance.db
  const data=JSON.stringify({title:'Synthetic preservation fixture',body:'Synthetic migration evidence only',category:'Fixture',status:'published'})
  await db.batch([
    db.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES ('nepmui','knowledge','migration-fixture',?,1)").bind(data),
    db.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES ('nepmui','persona','config',?,1)").bind(JSON.stringify({prompt:'Preserve this synthetic persona',voice:'Warm',rules:'Escalate unknowns',language:'vi'})),
    db.prepare("INSERT INTO usage VALUES ('nepmui','2055-01-01',3,99)"),
    db.prepare("INSERT INTO messenger_outbox(brand_id,channel,external_id,thread_id,recipient,question,received,due) VALUES ('nepmui','messenger','synthetic-mid','messenger:209','209','Synthetic pending only',1,1)"),
  ])
  const before={records:(await db.prepare('SELECT * FROM records ORDER BY brand_id,kind,id').all()).results,
    revisions:(await db.prepare('SELECT * FROM revisions ORDER BY brand_id,id').all()).results,
    pending:(await db.prepare('SELECT brand_id,channel,external_id,thread_id,recipient,question,received,due,state,attempts FROM messenger_outbox ORDER BY external_id').all()).results}
  for (const filename of migrationFiles) {
    const sql=await readFile(new URL('../migrations/'+filename,import.meta.url),'utf8')
    await db.batch(sql.split(/^-- studio-statement$/m).filter(part=>part.trim()).map(part=>db.prepare(part)))
  }
  const after={records:(await db.prepare('SELECT * FROM records ORDER BY brand_id,kind,id').all()).results,
    revisions:(await db.prepare('SELECT * FROM revisions ORDER BY brand_id,id').all()).results,
    pending:(await db.prepare('SELECT brand_id,channel,external_id,thread_id,recipient,question,received,due,state,attempts FROM messenger_outbox ORDER BY external_id').all()).results}
  assert.deepEqual(after,before)
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[])
  assert.deepEqual(await db.prepare("SELECT calls,neurons FROM platform_usage WHERE day='2055-01-01'").first(),{calls:3,neurons:99})
  await db.prepare("INSERT INTO brands VALUES ('synthetic-second','Synthetic second',1)").run()
  assert.equal((await db.prepare("SELECT record_id FROM studio_search WHERE studio_search MATCH 'preservation' AND brand_id='nepmui'").all()).results.length,1)
  const guards=(await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('require_active_founder_on_insert','require_active_founder_on_update','protect_last_superadmin_delete')").all()).results
  assert.equal(guards.length,3)
  const report={founderInvariantGuards:guards.length,migrations:migrationFiles,scope:'disposable synthetic D1 only',passed:true,
    preserved:{records:before.records.length,revisions:before.revisions.length,pendingDeliveries:before.pending.length},
    beforeSha256:digest(before),afterSha256:digest(after),foreignKeyViolations:0,existingSearchPreserved:true,
    legacyUsageBackfilled:true,multipleActiveWorkspaces:true,remoteMigrationApplied:false}
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true})
  await writeFile(new URL('../test-results/migration-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally { await instance.app.dispose() }
