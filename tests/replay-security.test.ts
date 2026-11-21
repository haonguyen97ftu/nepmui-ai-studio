import {expect,it} from 'vitest'
import {runtime} from '../scripts/runtime.mjs'
import {receiveBatch} from '../worker/channels'
import {deleteThread,purge} from '../worker/privacy'
import {readFile} from 'node:fs/promises'

it('rejects pre-upgrade provider events after their legacy receipt is deleted',async()=>{
  const test=await runtime({},0,()=>{},4)
  try {
    const db=test.db,event={id:'synthetic-legacy-replay',sender:'209',text:'Synthetic legacy private question',timestamp:Date.now()-1000}
    await db.batch([
      db.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES ('nepmui','conversations','messenger:209',?,1)").bind(JSON.stringify({title:'Synthetic legacy',channel:'messenger',status:'handover',messages:[{role:'user',text:event.text}]})),
      db.prepare("INSERT INTO deliveries(brand_id,channel,external_id,at,thread_id) VALUES ('nepmui','messenger',?,?,'messenger:209')").bind(event.id,event.timestamp),
    ])
    const migration=await readFile(new URL('../migrations/0005_webhook_replay.sql',import.meta.url),'utf8')
    await db.batch(migration.split(/^-- studio-statement$/m).filter(sql=>sql.trim()).map(sql=>db.prepare(sql)))
    expect(await db.prepare("SELECT id FROM records WHERE kind='conversations'").first()).toEqual({id:'messenger:209'})
    expect(await deleteThread(db,'nepmui','messenger:209',1)).toBe(true)
    expect(await receiveBatch(db,'nepmui','messenger',[event],true)).toBe(0)
    expect(await db.prepare("SELECT 1 FROM records WHERE kind='conversations'").first()).toBeNull()
    expect(await db.prepare('SELECT 1 FROM messenger_outbox').first()).toBeNull()
    expect(await db.prepare('SELECT 1 FROM deliveries').first()).toBeNull()
    expect(await receiveBatch(db,'nepmui','messenger',[{...event,id:'skewed-before-rollout',timestamp:Date.now()+299000}],true)).toBe(0)
    await db.prepare('UPDATE replay_policy SET live_not_before=? WHERE id=1').bind(Date.now()-1).run()
    expect(await receiveBatch(db,'nepmui','messenger',[event],true)).toBe(0)
    expect(await receiveBatch(db,'nepmui','messenger',[{...event,id:'synthetic-post-upgrade',timestamp:Date.now()}],true)).toBe(1)
  } finally {await test.app.dispose()}
})

it('keeps scoped non-content replay protection after deletion and retention',async()=>{
  const test=await runtime()
  try {
    // Simulate the completed five-minute rollout quarantine for steady-state checks.
    await test.db.prepare('UPDATE replay_policy SET live_not_before=0 WHERE id=1').run()
    const db=test.db,now=Date.now(),event={id:'synthetic-replay-id',sender:'209',text:'Synthetic private question',timestamp:now}
    await db.prepare("INSERT INTO brands VALUES ('other','Synthetic other',1)").run()
    expect(await receiveBatch(db,'nepmui','messenger-mock',[event],true)).toBe(1)
    expect(await deleteThread(db,'nepmui','messenger-mock:209',1)).toBe(true)
    expect(await receiveBatch(db,'nepmui','messenger-mock',[event],true)).toBe(0)
    expect(await db.prepare("SELECT 1 FROM records WHERE kind='conversations' AND brand_id='nepmui'").first()).toBeNull()
    expect(await db.prepare("SELECT 1 FROM messenger_outbox WHERE brand_id='nepmui'").first()).toBeNull()
    expect(await receiveBatch(db,'other','messenger-mock',[event],true)).toBe(1)
    expect(await receiveBatch(db,'nepmui','website',[event],false)).toBe(1)
    expect(await receiveBatch(db,'nepmui','messenger',[event],true)).toBe(1)
    expect(await deleteThread(db,'nepmui','messenger:209',1)).toBe(true)
    expect(await receiveBatch(db,'nepmui','messenger',[event],true)).toBe(0)
    const second={...event,id:'synthetic-retained-id',sender:'210'}
    expect(await receiveBatch(db,'nepmui','messenger-mock',[second],true)).toBe(1)
    await db.prepare("UPDATE records SET updated=1 WHERE brand_id='nepmui' AND id='messenger-mock:210'").run()
    await purge(db,'nepmui')
    expect(await receiveBatch(db,'nepmui','messenger-mock',[second],true)).toBe(0)
    const tombstones=(await db.prepare("SELECT * FROM event_tombstones WHERE brand_id='nepmui'").all()).results
    expect(tombstones.length).toBe(4)
    expect(JSON.stringify(tombstones)).not.toContain(event.text)
    expect(Object.keys(tombstones[0]).sort()).toEqual(['brand_id','channel','event_hash','expires'])
    expect(JSON.stringify(tombstones)).not.toContain(event.id)
    expect(await receiveBatch(db,'nepmui','messenger',[{...event,timestamp:now-86400001},{...event,id:'future',timestamp:now+600000},{...event,id:'missing',timestamp:undefined}],true)).toBe(0)
    expect(await db.prepare("SELECT 1 FROM deliveries WHERE channel='messenger'").first()).toBeNull()
  } finally {await test.app.dispose()}
})
