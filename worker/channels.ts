import { z } from 'zod'
import type { Data } from './contracts'

export type Inbound = { id: string; sender: string; text: string }
export interface ChannelAdapter {
  channel: Data<'conversations'>['channel']
  decode(payload: unknown, pageId: string): Inbound[]
}

const eventSchema = z.object({
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
      return [{ id: event.data.message.mid, sender: event.data.sender.id, text: event.data.message.text }]
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

export async function receive(db: D1Database, brand: string, channel: ChannelAdapter['channel'], item: Inbound) {
  const at = Date.now()
  const thread = `${channel}:${item.sender}`
  const message = JSON.stringify({ role: 'user', text: item.text })
  const results = await db.batch([
    db.prepare('INSERT INTO deliveries VALUES (?,?,?,?) ON CONFLICT DO NOTHING').bind(brand, channel, item.id, at),
    db.prepare(`INSERT INTO records (brand_id,kind,id,data,updated)
      SELECT ?, 'conversations', ?, json_object('title',?,'channel',?,'status','handover','messages',json_array(json(?))), ?
      WHERE changes()=1
      ON CONFLICT (brand_id,kind,id) DO UPDATE SET
      updated=excluded.updated, version=version+1,
      data=json_set(records.data,'$.status','handover','$.messages',
        json_insert(CASE WHEN json_array_length(records.data,'$.messages')>=40
          THEN json_remove(json_extract(records.data,'$.messages'),'$[0]')
          ELSE json_extract(records.data,'$.messages') END,'$[#]',json(?)))`)
      .bind(brand, thread, item.text.slice(0, 160), channel, message, at, message),
  ])
  return results[0].meta.changes === 1
}
