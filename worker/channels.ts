import { z } from 'zod'
import type { Data } from './contracts'
import { digest } from './accounts'

export type Inbound = { id: string; sender: string; text: string; timestamp?: number }
export interface ChannelAdapter {
  channel: Data<'conversations'>['channel']
  decode(payload: unknown, pageId: string): Inbound[]
}

const eventSchema = z.object({
  timestamp: z.number().int().positive().optional(),
  sender: z.object({ id: z.string().regex(/^\d{1,32}$/) }),
  recipient: z.object({ id: z.string().regex(/^\d{1,32}$/) }),
  message: z.object({ mid: z.string().min(1).max(256), text: z.string().trim().min(1).max(1000), is_echo: z.boolean().optional() }),
})
const envelope = z.object({ object: z.literal('page'), entry: z.array(z.object({
  id: z.string(), messaging: z.array(z.unknown()).max(30).optional(),
})).max(10) })

export const messenger: ChannelAdapter = {
  channel: 'messenger',
  decode(payload, pageId) {
    const data = envelope.parse(payload)
    return data.entry.filter(entry => entry.id === pageId).flatMap(entry => (entry.messaging ?? []).flatMap(value => {
      const event = eventSchema.safeParse(value)
      if (!event.success || event.data.message.is_echo || event.data.recipient.id !== pageId) return []
      return [{ id: event.data.message.mid, sender: event.data.sender.id, text: event.data.message.text, timestamp: event.data.timestamp }]
    }))
  },
}

const normalizedInbound = z.object({
  id: z.string().min(1).max(256), sender: z.string().min(1).max(64), text: z.string().trim().min(1).max(1000),
})
function normalizedAdapter(channel: 'instagram' | 'website'): ChannelAdapter {
  return { channel, decode: payload => z.array(normalizedInbound).max(30).parse(payload) }
}
export const channelAdapters = { messenger, instagram: normalizedAdapter('instagram'), website: normalizedAdapter('website') }

export async function signPayload(secret: string, bytes: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))
}

export async function signatureValid(secret: string, bytes: Uint8Array<ArrayBuffer>, header: string) {
  const hex = /^sha256=([\da-f]{64})$/i.exec(header)?.[1]
  if (!hex) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const expected = Uint8Array.from(hex.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
  return crypto.subtle.verify('HMAC', key, expected, bytes)
}

export async function receiveBatch(db: D1Database, brand: string, channel: ChannelAdapter['channel'], events: Inbound[], queue: boolean, connectionId?: string) {
  if (!events.length) return 0
  const scope=connectionId ? channel+'/'+connectionId : channel
  const now = Date.now()
  const batch = crypto.randomUUID()
  const firstById = new Map<string, Inbound>()
  for (const event of events) {
    if (channel==='messenger' && (!event.timestamp || event.timestamp<now-86400000 || event.timestamp>now+300000)) continue
    if (!firstById.has(event.id)) firstById.set(event.id, event)
  }
  const input = JSON.stringify(await Promise.all([...firstById.values()].map(async ({ id, sender, text, timestamp }) => ({
    id, eventHash:await digest(id), sender, text, thread: scope + ':' + sender, received: timestamp===undefined ? (channel === 'messenger-mock' ? now : 0) : Math.min(timestamp,now),
  }))))
  const accepted = `SELECT CAST(event.key AS INTEGER) seq, event.value payload, d.thread_id
    FROM json_each(?) event JOIN deliveries d ON d.brand_id=? AND d.channel=?
      AND d.external_id=json_extract(event.value,'$.id') AND d.batch_key=?`
  const batchArgs = [input, brand, scope, batch]
  const work = [
    db.prepare(`INSERT INTO deliveries (brand_id,channel,external_id,at,thread_id,batch_key,event_hash)
      SELECT ?,?,json_extract(value,'$.id'),?,json_extract(value,'$.thread'),?,json_extract(value,'$.eventHash') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM brands WHERE id=? AND active=1)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM channels WHERE brand_id=? AND id=? AND state='connected' AND paused=0 AND mock=? AND (mock=1 OR verified=1)))
      ON CONFLICT DO NOTHING RETURNING external_id`).bind(brand, scope, now, batch, input,brand,connectionId??null,brand,connectionId??null,Number(channel==='messenger-mock')),
    db.prepare(`WITH accepted AS (${accepted}),
      ordered AS (
        SELECT *,row_number() OVER (PARTITION BY thread_id ORDER BY seq DESC) position FROM accepted
      ), grouped AS (
        SELECT thread_id,json_group_array(json_object('role','user','text',json_extract(payload,'$.text'),
          'outboundId',json_extract(payload,'$.id')) ORDER BY seq) messages FROM ordered WHERE position<=40 GROUP BY thread_id
      )
      INSERT INTO records (brand_id,kind,id,data,updated)
      SELECT ?, 'conversations', thread_id,
        json_patch(json_object('title',substr(json_extract(messages,'$[0].text'),1,160),'channel',?,'status','handover','messages',json(messages)),json(?)), ?
      FROM grouped WHERE 1
      ON CONFLICT (brand_id,kind,id) DO UPDATE SET updated=excluded.updated,version=version+1,
      data=json_set(records.data,'$.status','handover','$.messages',
        json((SELECT json_group_array(json(value) ORDER BY position) FROM (
          SELECT * FROM (
            SELECT CAST(key AS INTEGER) position,value FROM json_each(records.data,'$.messages')
            UNION ALL
            SELECT 40+CAST(key AS INTEGER),value FROM json_each(excluded.data,'$.messages')
          ) ORDER BY position DESC LIMIT 40
        ))))`).bind(...batchArgs, brand, channel, JSON.stringify(connectionId ? { channelId:connectionId } : {}), now),
  ]
  if (queue) work.push(db.prepare(`WITH accepted AS (${accepted})
    INSERT INTO messenger_outbox (brand_id,channel,external_id,thread_id,recipient,question,received,due,connection_id)
    SELECT ?,?,json_extract(payload,'$.id'),thread_id,json_extract(payload,'$.sender'),json_extract(payload,'$.text'),
      json_extract(payload,'$.received'),?,? FROM accepted a WHERE EXISTS (
        SELECT 1 FROM records r,json_each(r.data,'$.messages') message
        WHERE r.brand_id=? AND r.kind='conversations' AND r.id=a.thread_id
          AND json_extract(message.value,'$.outboundId')=json_extract(a.payload,'$.id')
      ) ON CONFLICT DO NOTHING`).bind(...batchArgs, brand, scope, now, connectionId??null, brand))
  return (await db.batch(work))[0].results.length
}
