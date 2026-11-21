import type { currentActor } from './accounts'
import { hex } from './security'

const day = 86_400_000
const loginWindow = 10 * 60 * 1000
const encoder = new TextEncoder()

export async function admitLogin(db: D1Database, brand: string, secret: string, address: string) {
  const now = Date.now()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bucket = hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(address))))
  const result = await db.prepare(`INSERT INTO login_attempts VALUES (?,?,?,1)
    ON CONFLICT (brand_id,bucket) DO UPDATE SET expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END,
      attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END
    WHERE expires<=? OR attempts<5 RETURNING attempts`)
    .bind(brand, bucket, now + loginWindow, now, now, now).first()
  return !!result
}

export function sessionParts(value: string | undefined) {
  const parts = /^(\d{10})\.([a-f0-9-]{36})\.[a-f0-9]{64}$/.exec(value ?? '')
  return parts ? { id: parts[2], expires: Number(parts[1]) * 1000 } : undefined
}
export async function revoked(db: D1Database, brand: string, value: string | undefined) {
  const session = sessionParts(value)
  if (!session) return true
  return !!await db.prepare('SELECT 1 FROM revoked_sessions WHERE brand_id=? AND session_id=? AND expires>?')
    .bind(brand, session.id, Date.now()).first()
}
export async function revoke(db: D1Database, brand: string, value: string | undefined) {
  const session = sessionParts(value)
  if (session) await db.prepare('INSERT INTO revoked_sessions VALUES (?,?,?) ON CONFLICT DO NOTHING')
    .bind(brand, session.id, session.expires).run()
}

export async function retentionDays(db: D1Database, brand: string) {
  return (await db.prepare('SELECT days FROM retention WHERE brand_id=?').bind(brand).first<{ days: number }>())?.days ?? 30
}
export async function deleteThread(db: D1Database, brand: string, id: string, version: number, authorization?: ReturnType<typeof currentActor>) {
  const guard=authorization?.sql??'1', bindings=authorization?.bindings??[]
  const removed = await db.batch([
    db.prepare(`DELETE FROM records WHERE brand_id=? AND kind='conversations' AND id=? AND version=? AND ${guard} RETURNING id`).bind(brand, id, version,...bindings),
    db.prepare(`DELETE FROM messenger_outbox WHERE brand_id=? AND thread_id=? AND NOT EXISTS(SELECT 1 FROM records WHERE brand_id=? AND kind='conversations' AND id=?) AND ${guard}`).bind(brand,id,brand,id,...bindings),
    db.prepare(`DELETE FROM deliveries WHERE brand_id=? AND thread_id=? AND NOT EXISTS(SELECT 1 FROM records WHERE brand_id=? AND kind='conversations' AND id=?) AND ${guard}`).bind(brand,id,brand,id,...bindings),
    db.prepare(`DELETE FROM revisions WHERE brand_id=? AND kind='conversations' AND record_id=? AND NOT EXISTS(SELECT 1 FROM records WHERE brand_id=? AND kind='conversations' AND id=?) AND ${guard}`).bind(brand,id,brand,id,...bindings),
  ])
  return removed[0].results.length === 1
}
export async function purge(db: D1Database, brand: string, authorization?: ReturnType<typeof currentActor>) {
  const guard=authorization?.sql??'1', bindings=authorization?.bindings??[]
  const now = Date.now()
  const cutoff = now - await retentionDays(db, brand) * day
  const eligible = "SELECT id FROM records WHERE brand_id=? AND kind='conversations' AND updated<? ORDER BY updated LIMIT 100"
  const results = await db.batch([
    db.prepare(`DELETE FROM messenger_outbox WHERE brand_id=? AND thread_id IN (${eligible}) AND ${guard}`).bind(brand,brand,cutoff,...bindings),
    db.prepare(`DELETE FROM deliveries WHERE brand_id=? AND thread_id IN (${eligible}) AND ${guard}`).bind(brand,brand,cutoff,...bindings),
    db.prepare(`DELETE FROM records WHERE brand_id=? AND kind='conversations' AND id IN (${eligible}) AND ${guard} RETURNING id`).bind(brand,brand,cutoff,...bindings),
    db.prepare(`DELETE FROM revisions WHERE brand_id=? AND kind='conversations' AND NOT EXISTS(SELECT 1 FROM records r WHERE r.brand_id=revisions.brand_id AND r.kind='conversations' AND r.id=revisions.record_id) AND ${guard}`).bind(brand,...bindings),
    db.prepare(`DELETE FROM deliveries WHERE brand_id=? AND at<? AND ${guard}`).bind(brand,cutoff,...bindings),
    db.prepare(`DELETE FROM login_attempts WHERE brand_id=? AND expires<=? AND ${guard}`).bind(brand,now,...bindings),
    db.prepare(`DELETE FROM revoked_sessions WHERE brand_id=? AND expires<=? AND ${guard}`).bind(brand,now,...bindings),
    db.prepare(`DELETE FROM event_tombstones WHERE brand_id=? AND expires<=? AND ${guard}`).bind(brand,now,...bindings),
  ])
  return results[2].results.length
}
