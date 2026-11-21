import {expect,it} from 'vitest'
import {runtime} from '../scripts/runtime.mjs'
import {receiveBatch} from '../worker/channels'
import {deleteThread,purge} from '../worker/privacy'

it('keeps scoped non-content replay protection after deletion and retention',async()=>{
  const test=await runtime()
  try {
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
