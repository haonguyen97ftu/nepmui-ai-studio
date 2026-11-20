import { connection, decryptToken, engineStore, tokenScope } from './registry'
import { answer } from './ai'
import type { Env } from './index'
import { studio } from './store'

const windowMs = 24 * 60 * 60 * 1000
const leaseMs = 2 * 60 * 1000
type Channel = 'messenger' | 'messenger-mock'
type Outcome = 'sent' | 'retry' | 'failed' | 'unknown'
type Job = { external_id: string; thread_id: string; recipient: string; question: string; received: number; attempts: number }

export function canSend(env: Env) {
  return env.STUDIO_ENV !== 'staging' && env.MESSENGER_INGEST === 'true' &&
    env.MESSENGER_OUTBOUND === 'true' && !!env.META_PAGE_ID && /^\d{1,32}$/.test(env.META_PAGE_ID) && !!env.META_PAGE_TOKEN && !!env.META_GRAPH_VERSION &&
    /^v\d{1,2}\.0$/.test(env.META_GRAPH_VERSION)
}
export function withinWindow(received: number, now = Date.now()) {
  return received > 0 && received <= now && now - received < windowMs
}
export async function sendMessenger(env: Env, recipient: string, text: string, fetcher = fetch): Promise<Outcome> {
  if (!canSend(env)) return 'failed'
  try {
    const response = await fetcher(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PAGE_ID}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + env.META_PAGE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_type: 'RESPONSE', recipient: { id: recipient }, message: { text } }),
    })
    await response.body?.cancel()
    if (response.ok) return 'sent'
    if (response.status === 429) return 'retry'
    return response.status >= 500 ? 'unknown' : 'failed'
  } catch {
    return 'unknown'
  }
}

export async function drainMessenger(env: Env, channel: Channel, limit = 2, fetcher = fetch, connectionId?: string) {
  const mock = channel === 'messenger-mock'
  const { DB:db }=env,brand=env.BRAND_ID??'nepmui'
  if (!await db.prepare('SELECT 1 FROM brands WHERE id=? AND active=1').bind(brand).first()) return 0
  const registered=connectionId ? await connection(db,brand,connectionId) : undefined
  if (connectionId && (!registered || registered.state!=='connected' || registered.paused || !!registered.mock!==mock)) return 0
  if (registered && !mock) {
    if (!registered.verified) return 0
    if (env.STUDIO_ENV==='staging' || env.MESSENGER_INGEST!=='true' || env.MESSENGER_OUTBOUND!=='true' || !registered.token_cipher) return 0
    let token:string
    try { token=await decryptToken(env.CHANNEL_ENCRYPTION_KEY,registered.token_cipher,tokenScope(registered)) } catch { return 0 }
    env={ ...env,META_PAGE_ID:registered.external_id,META_PAGE_TOKEN:token }
  }
  if (!mock && !canSend(env)) return 0
  const scope=connectionId ? channel+'/'+connectionId : channel
  const store=registered ? await engineStore(db,brand,registered.id) : studio(db,brand)
  const current = Date.now()
  const jobs = (await db.batch([
    db.prepare(`UPDATE messenger_outbox SET state=CASE WHEN state='sending' THEN 'unknown' ELSE 'failed' END,
      question='', recipient='' WHERE brand_id=? AND channel=? AND due<=? AND
      (state='sending' OR (state='working' AND attempts>=4))`).bind(brand, scope, current),
    db.prepare(`SELECT external_id,thread_id,recipient,question,received,attempts FROM messenger_outbox AS j
      WHERE brand_id=? AND channel=? AND state IN ('queued','retry','working') AND due<=?
      AND NOT EXISTS (SELECT 1 FROM messenger_outbox older WHERE older.brand_id=j.brand_id AND older.channel=j.channel
        AND older.thread_id=j.thread_id AND older.state IN ('queued','retry','working','sending')
        AND (older.received,older.external_id)<(j.received,j.external_id))
      ORDER BY received,external_id LIMIT ?`).bind(brand, scope, current, limit),
  ]))[1].results as Job[]
  let sent = 0
  for (const job of jobs) {
    const key = [brand, scope, job.external_id]
    const claim = await db.prepare(`UPDATE messenger_outbox SET state='working',due=?,attempts=attempts+1
      WHERE brand_id=? AND channel=? AND external_id=? AND due<=? AND state IN ('queued','retry','working') RETURNING attempts`)
      .bind(current + leaseMs, ...key, current).first<{ attempts: number }>()
    if (!claim) continue
    const transition = async (state: string, from = 'working') => {
      const retry = state === 'retry' && claim.attempts < 4
      const next = state === 'retry' && !retry ? 'failed' : state
      return db.prepare(`UPDATE messenger_outbox SET state=?,due=?,question=CASE WHEN ? THEN question ELSE '' END,
        recipient=CASE WHEN ? THEN recipient ELSE '' END WHERE brand_id=? AND channel=? AND external_id=? AND state=? AND attempts=?`)
        .bind(next, Date.now() + 60000 * 2 ** (claim.attempts - 1), Number(retry), Number(retry), ...key, from, claim.attempts).run()
    }
    if (!withinWindow(job.received)) { await transition('expired'); continue }
    const thread = await store.get('conversations', job.thread_id)
    if (!thread || thread.data.paused) { await transition('paused'); continue }
    const index = thread.data.messages.findIndex(message => message.role === 'user' && message.outboundId === job.external_id)
    if (index < 0) { await transition('failed'); continue }
    const earlier = thread.data.messages.slice(0, index)
    const paired = new Map(thread.data.messages.filter(message => message.role === 'assistant' && message.outboundId)
      .map(message => [message.outboundId, message]))
    const history = earlier.flatMap(message => {
      if (message.role === 'assistant' && message.outboundId) return []
      const previousReply = message.role === 'user' && message.outboundId ? paired.get(message.outboundId) : undefined
      return previousReply ? [message, previousReply] : [message]
    })
    const result = await answer(store, env.WORKERS_AI_ENABLED === 'true' ? env.AI : undefined, job.question, history)
    if (result.reason !== 'grounded' || result.text.length > 1900) {
      const retry = ['provider_error', 'provider_unavailable'].includes(result.reason)
      await transition(retry ? 'retry' : 'handover')
      if (!retry) await store.update('conversations', thread.id, { ...thread.data, status: 'handover', paused: true }, thread.version)
      continue
    }
    // Claim delivery only if no operator or concurrent message changed the thread during generation.
    const locked = await db.prepare(`UPDATE messenger_outbox SET state='sending',due=?
      WHERE brand_id=? AND channel=? AND external_id=? AND state='working' AND attempts=?
        AND EXISTS (SELECT 1 FROM records WHERE brand_id=? AND kind='conversations' AND id=? AND version=?
          AND coalesce(json_extract(data,'$.paused'),0)=0)
        AND EXISTS(SELECT 1 FROM brands WHERE id=? AND active=1)
        AND (? IS NULL OR EXISTS(SELECT 1 FROM channels WHERE brand_id=? AND id=? AND state='connected' AND paused=0 AND version=? AND (mock=1 OR verified=1)))
        AND NOT EXISTS (SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS
          (SELECT 1 FROM records r WHERE r.brand_id=? AND r.kind=json_extract(ref.value,'$.kind')
            AND r.id=json_extract(ref.value,'$.id') AND r.version=json_extract(ref.value,'$.version')))
        RETURNING external_id`)
      .bind(Date.now() + leaseMs, ...key, claim.attempts, brand, thread.id, thread.version, brand,connectionId??null,brand,connectionId??null,registered?.version??0, JSON.stringify(result.references), brand).first()
    if (!locked) { await transition('retry'); continue }
    const reply = result.text
    const outcome = !withinWindow(job.received) ? 'expired' : mock ? 'sent' : await sendMessenger(env, job.recipient, reply, fetcher)
    if (outcome !== 'sent') { await transition(outcome, 'sending'); continue }
    const message = JSON.stringify({ role: 'assistant', text: reply, reason: 'grounded', provider: result.provider,
      latency: result.latency, sources: result.references, outboundId: job.external_id })
    await db.batch([
      db.prepare(`UPDATE messenger_outbox SET state='sent',question='',recipient=''
        WHERE brand_id=? AND channel=? AND external_id=? AND state='sending' AND attempts=?`).bind(...key, claim.attempts),
      db.prepare(`UPDATE records SET updated=?,version=version+1,
        data=json_set(data,'$.status',CASE WHEN version=? AND coalesce(json_extract(data,'$.paused'),0)=0 THEN 'answered'
          ELSE json_extract(data,'$.status') END,'$.messages',
          json_insert(CASE WHEN json_array_length(data,'$.messages')>=40 THEN json_remove(json_extract(data,'$.messages'),'$[0]')
            ELSE json_extract(data,'$.messages') END,'$[#]',json(?)))
        WHERE brand_id=? AND kind='conversations' AND id=? AND changes()=1`).bind(Date.now(), thread.version, message, brand, thread.id),
    ])
    sent++
  }
  return sent
}
