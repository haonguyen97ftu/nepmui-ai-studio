import { afterAll, beforeAll, expect, it } from 'vitest'
import { runtime } from '../scripts/runtime.mjs'
import { contracts, type Entry } from '../worker/contracts'
import { canSend, drainMessenger, sendMessenger, withinWindow } from '../worker/messenger'
import { studio } from '../worker/store'
import evaluation from './fixtures/evaluation.json'

const origin = 'https://staging.example.test'
const key = 'fixture-key-only-for-test-never-deploy'
let instance: Awaited<ReturnType<typeof runtime>>
let cookie = ''

const api = (path: string, method = 'GET', payload?: unknown, auth = cookie) => instance.app.dispatchFetch(origin + '/api/' + path, {
  method, headers: { Origin: origin, Cookie: auth, 'Content-Type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload),
})
async function postChat(question: string, conversationId?: string) {
  const response = await api('playground', 'POST', { question, conversationId })
  expect(response.status).toBe(200)
  return response.json() as Promise<{ result: { reason: string; text: string; references: { id: string; version: number }[] }; conversation: Entry<'conversations'> }>
}
function event(mid: string, text: string, timestamp = Date.now()) {
  return { object: 'page', entry: [{ id: '100', messaging: [{
    timestamp, sender: { id: '209' }, recipient: { id: '100' }, message: { mid, text },
  }] }] }
}

beforeAll(async () => {
  instance = await runtime({ ADMIN_SECRET: key, STUDIO_ENV: 'staging', MESSENGER_INGEST: 'true', MESSENGER_OUTBOUND: 'true', META_VERIFY_TOKEN: 'fixture-token' })
  const login = await api('session', 'POST', { token: key })
  expect(login.status).toBe(200)
  cookie = login.headers.get('Set-Cookie')!.split(';')[0]
  const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
  const store = studio(DB, 'nepmui')
  for (const item of evaluation.knowledge) await store.create('knowledge', contracts.knowledge.parse(item))
  for (const item of evaluation.products) await store.create('products', contracts.products.parse(item))
})
afterAll(async () => { await instance?.app.dispose() })

it.each(evaluation.cases)('Vietnamese evaluation: $id', async entry => {
  const { result } = await postChat(entry.question)
  expect(result.reason).toBe(entry.reason)
  for (const text of entry.includes ?? []) expect(result.text).toContain(text)
  for (const text of entry.excludes ?? []) expect(result.text).not.toContain(text)
})

it('sees catalog updates in a follow-up immediately and links the current catalog revision', async () => {
  const first = await postChat('Mẫu Thử Tuyết Tùng giá bao nhiêu?')
  const id = first.result.references[0].id
  const record = await (await api('products/' + id)).json() as Entry<'products'>
  expect((await api('products/' + id, 'PUT', {
    version: record.version, data: { ...record.data, price: 265000, availability: 'unavailable' },
  })).status).toBe(200)
  const changed = await postChat('Còn giá và tồn kho?', first.conversation.id)
  expect(changed.result.text).toContain('265.000 ₫')
  expect(changed.result.text).toContain('hết hàng')
  expect(changed.result.references).toMatchObject([{ id, version: record.version + 1 }])
  expect((await api('products/' + id, 'PUT', { version: record.version + 1, data: record.data })).status).toBe(200)
})

it('searches the entire knowledge corpus, then restores an older revision to draft', async () => {
  const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
  const store = studio(DB, 'nepmui')
  const doc = await store.create('knowledge', { title: 'Đèn thử cũ', category: 'Mẫu', body: 'Chi tiết dưỡng hộ đặc biệt cho đèn thử cũ.', status: 'published' })
  await instance.db.prepare("UPDATE records SET updated=0 WHERE brand_id='nepmui' AND kind='knowledge' AND id=?").bind(doc.id).run()
  for (let chunk = 0; chunk < 7; chunk++) {
    await store.importDrafts(Array.from({ length: 30 }, (_, index) => ({ title: 'Mẫu mới ' + (chunk * 30 + index), category: 'Mẫu', body: 'Thông tin mẫu.', status: 'published' })))
  }
  const found = await (await api('knowledge?q=duong+ho+dac+biet')).json()
  expect(found).toMatchObject({ items: [{ id: doc.id }] })
  const reply = await postChat('Chi tiết dưỡng hộ đặc biệt')
  expect(reply.result.references).toMatchObject([{ id: doc.id }])
  const list = await (await api('knowledge/' + doc.id + '/history')).json() as { id: string }[]
  const restored = await api('knowledge/' + doc.id + '/restore', 'POST', { revision: list[0].id, version: doc.version })
  expect(await restored.json()).toMatchObject({ data: { status: 'draft' } })
  expect((await postChat('Chi tiết dưỡng hộ đặc biệt')).result.reason).toBe('no_source')
})

it('simulates delivery once, honors pause and the messaging window, and deletes customer data', async () => {
  expect(await (await api('integrations')).json()).toMatchObject({ messenger: false, outbound: false })
  expect((await api('webhooks/messenger?hub.mode=subscribe&hub.verify_token=fixture-token&hub.challenge=4')).status).toBe(403)
  const payload = event('phase-two-unique', 'Mẫu Thử Tuyết Tùng giá bao nhiêu?')
  const responses = await Promise.all([api('integrations/messenger/mock','POST',payload), api('integrations/messenger/mock','POST',payload)])
  const duplicate = await Promise.all(responses.map(result => result.json())) as { accepted: number; sent: number }[]
  expect(duplicate.reduce((total, item) => total + item.accepted, 0)).toBe(1)
  expect(duplicate.reduce((total, item) => total + item.sent, 0)).toBe(1)
  const thread = 'conversations/' + encodeURIComponent('messenger-mock:209')
  const audited = await (await api(thread)).json() as { item: Entry<'conversations'>; delivery: { state: string }[] }
  expect(audited.item.data.messages).toHaveLength(2)
  expect(audited.delivery[0].state).toBe('sent')
  expect((await api(thread, 'PATCH', { version: audited.item.version, paused: true, status: 'handover' })).status).toBe(200)
  expect(await (await api('integrations/messenger/mock', 'POST', event('second', 'Còn giá?'))).json()).toMatchObject({ sent: 0 })
  expect(await (await api('integrations/messenger/mock', 'POST', event('expired', 'Còn giá?', Date.now() - 86_400_000))).json()).toMatchObject({ sent: 0 })
  const updated = await (await api(thread)).json() as { item: Entry<'conversations'>; delivery: { state: string }[] }
  expect(updated.delivery.map(row => row.state)).toEqual(expect.arrayContaining(['paused', 'expired']))
  expect((await api(thread + '?version=' + updated.item.version, 'DELETE')).status).toBe(200)
  expect((await api(thread)).status).toBe(404)
  expect((await instance.db.prepare("SELECT count(*) n FROM messenger_outbox WHERE thread_id='messenger-mock:209'").first<{ n: number }>())?.n).toBe(0)
})

it('enforces send adapter status and stages without making network requests', async () => {
  const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
  const env = { DB, BRAND_ID: 'nepmui', META_GRAPH_VERSION: 'v27.0', META_PAGE_TOKEN: 'fixture', META_PAGE_ID: '100',
    MESSENGER_INGEST: 'true', MESSENGER_OUTBOUND: 'true' }
  expect(canSend({ ...env, STUDIO_ENV: 'staging' })).toBe(false)
  expect(await drainMessenger({ ...env, STUDIO_ENV: 'staging' }, 'messenger')).toBe(0)
  expect(withinWindow(100, 86_400_100)).toBe(false)
  expect(withinWindow(900, 899)).toBe(false)
  const retry = await sendMessenger(env, '209', 'Bản thử', async (url, init) => {
    expect(url).toBe('https://graph.facebook.com/v27.0/100/messages')
    expect(JSON.parse(String(init?.body))).toMatchObject({ messaging_type: 'RESPONSE', recipient: { id: '209' } })
    return new Response(null, { status: 429 })
  })
  expect(retry).toBe('retry')
  expect(await sendMessenger(env, '209', 'Bản thử', async () => { throw new Error('timeout') })).toBe('unknown')
})

it('purges expired data within tenant scope and revokes copied session cookies on logout', async () => {
  expect((await api('privacy', 'PUT', { days: 1 })).status).toBe(200)
  const chat = await postChat('Đây là dữ liệu thử đã hết hạn')
  await instance.db.prepare("UPDATE records SET updated=0 WHERE brand_id='nepmui' AND kind='conversations' AND id=?").bind(chat.conversation.id).run()
  expect(await (await api('privacy/purge', 'POST')).json()).toMatchObject({ count: 1 })
  expect((await api('conversations/' + chat.conversation.id)).status).toBe(404)
  expect((await api('session', 'DELETE')).status).toBe(200)
  expect((await api('knowledge')).status).toBe(401)
  for (let attempt = 0; attempt < 4; attempt++) expect((await api('session', 'POST', { token: 'incorrect' }, '')).status).toBe(401)
  expect((await api('session', 'POST', { token: key }, '')).status).toBe(429)
})

it('retries explicit rate-limit rejections and never retries an ambiguous send', async () => {
  const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
  const env = { DB, BRAND_ID: 'nepmui', META_GRAPH_VERSION: 'v27.0', META_PAGE_TOKEN: 'fixture', META_PAGE_ID: '100',
    MESSENGER_INGEST: 'true', MESSENGER_OUTBOUND: 'true' }
  const { receiveBatch } = await import('../worker/channels')
  const at = Date.now()
  const question = 'Mẫu Thử Tuyết Tùng giá bao nhiêu?'
  const job = (id: string) => instance.db.prepare("SELECT state, attempts FROM messenger_outbox WHERE brand_id='nepmui' AND external_id=?")
    .bind(id).first()
  await receiveBatch(DB, 'nepmui', 'messenger', [{ id: 'retry-test', sender: '103', text: question, timestamp: at }], true)
  expect(await drainMessenger(env, 'messenger', 1, async () => new Response(null, { status: 429 }))).toBe(0)
  expect(await job('retry-test')).toMatchObject({ state: 'retry', attempts: 1 })
  await instance.db.prepare("UPDATE messenger_outbox SET due=0 WHERE external_id='retry-test'").run()
  expect(await drainMessenger(env, 'messenger', 1, async () => new Response(null, { status: 200 }))).toBe(1)
  expect(await job('retry-test')).toMatchObject({ state: 'sent', attempts: 2 })
  await receiveBatch(DB, 'nepmui', 'messenger', [{ id: 'unknown-test', sender: '103', text: question, timestamp: at }], true)
  expect(await drainMessenger(env, 'messenger', 1, async () => new Response(null, { status: 500 }))).toBe(0)
  expect(await job('unknown-test')).toMatchObject({ state: 'unknown', attempts: 1 })
  expect(await drainMessenger(env, 'messenger', 1, async () => { throw new Error('must not send again') })).toBe(0)
})

it('persists large signed-style batches with bounded per-thread history and deduplication', async () => {
  const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
  const { receiveBatch } = await import('../worker/channels')
  const first = Array.from({ length: 30 }, (_, index) => ({ id: 'incoming-' + index, sender: '999', text: 'Bản thử ' + index }))
  const second = Array.from({ length: 30 }, (_, index) => ({ id: 'incoming-' + (index + 30), sender: '999', text: 'Bản thử ' + (index + 30) }))
  expect(await receiveBatch(DB, 'nepmui', 'messenger', first, false)).toBe(30)
  expect(await receiveBatch(DB, 'nepmui', 'messenger', [...second, first[0]], false)).toBe(30)
  expect(await receiveBatch(DB, 'nepmui', 'messenger', second, false)).toBe(0)
  const conversation = await studio(DB, 'nepmui').get('conversations', 'messenger:999')
  expect(conversation?.data.messages.map(message => message.text)).toEqual(
    Array.from({ length: 40 }, (_, index) => 'Bản thử ' + (index + 20)),
  )
})
