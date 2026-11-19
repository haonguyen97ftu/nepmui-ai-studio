import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runtime } from '../scripts/runtime.mjs'
import { mockProvider, rank, workersProvider, answer } from '../worker/ai'
import { signPayload } from '../worker/channels'
import { hex, newSession } from '../worker/security'
import { studio, type Studio } from '../worker/store'
import { models } from '../shared/models'
import messenger from './fixtures/messenger.json'

const secret = 'studio-synthetic-auth-token-for-tests'
const meta = 'studio-synthetic-meta-secret'
const verify = 'studio-synthetic-verify-token'
const origin = 'https://studio.example.test'
let app: Awaited<ReturnType<typeof runtime>>['app']
let db: Awaited<ReturnType<typeof runtime>>['db']
let cookie: string

beforeAll(async () => {
  const instance = await runtime({ ADMIN_SECRET: secret, META_APP_SECRET: meta, META_VERIFY_TOKEN: verify, META_PAGE_ID: '100', MESSENGER_INGEST: 'true' })
  app = instance.app
  db = instance.db
  const response = await request('session', 'POST', { token: secret }, false)
  expect(response.status).toBe(200)
  cookie = response.headers.get('Set-Cookie')!.split(';')[0]
  expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/i)
})
afterAll(async () => { await app?.dispose() })

function request(path: string, method = 'GET', data?: unknown, authenticated = true) {
  return app.dispatchFetch(origin + '/api/' + path, {
    method, headers: { Origin: origin, ...(authenticated ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
}
const record = { title: 'Quy trình kiểm tra nội bộ', body: 'Nội dung giả lập chỉ để kiểm thử.', category: 'Kiểm thử', status: 'draft' }

describe('administration and tenant isolation', () => {
  it('denies unauthenticated access, cross-origin writes, and cookies signed for another brand', async () => {
    expect((await request('knowledge', 'GET', undefined, false)).status).toBe(401)
    const foreign = await newSession(secret, 'foreign')
    expect((await app.dispatchFetch(origin + '/api/audit', { headers: { Cookie: '__Host-studio=' + foreign } })).status).toBe(401)
    const response = await app.dispatchFetch(origin + '/api/knowledge', {
      method: 'POST', headers: { Origin: 'https://foreign.example.test', Cookie: cookie }, body: JSON.stringify(record),
    })
    expect(response.status).toBe(403)
    const oversized = await request('knowledge', 'POST', { body: 'x'.repeat(170_000) })
    expect(oversized.status).toBe(413)
    const navigated = await app.dispatchFetch(origin + '/api/knowledge', { headers: { 'sec-fetch-mode': 'navigate' } })
    expect(navigated.status).toBe(401)
  })

  it('isolates stored rows and prevents mutation of another brand by ID', async () => {
    await db.batch([
      db.prepare("INSERT INTO brands VALUES ('foreign','Kiểm thử khác',0)"),
      db.prepare("INSERT INTO records (brand_id,kind,id,data,updated) VALUES ('foreign','knowledge','hidden-id',?,?)")
        .bind(JSON.stringify({ ...record, status: 'published' }), Date.now()),
    ])
    expect(await (await request('knowledge')).json()).not.toMatchObject({ items: [expect.objectContaining({ id: 'hidden-id' })] })
    expect((await request('knowledge/hidden-id', 'PUT', { data: record, version: 1 })).status).toBe(404)
    expect((await request('knowledge/hidden-id?version=1', 'DELETE')).status).toBe(409)
    expect(JSON.stringify(await (await request('audit')).json())).not.toContain('hidden-id')
    const chat = await (await request('playground', 'POST', { question: record.title })).json()
    expect(chat).toMatchObject({ result: { reason: 'no_source', sources: [] } })
  })
})

describe('knowledge and governance', () => {
  it('requires review, uses only published content, and rejects stale writes', async () => {
    expect((await request('knowledge', 'POST', { ...record, status: 'published' })).status).toBe(409)
    const draft = await (await request('knowledge', 'POST', record)).json() as { id: string; version: number }
    expect((await request('knowledge/' + draft.id, 'PUT', { version: 1, data: { ...record, status: 'published' } })).status).toBe(409)
    const approved = await request('knowledge/' + draft.id, 'PUT', { version: 1, data: { ...record, status: 'approved' } })
    expect(approved.status).toBe(200)
    expect((await request('knowledge/' + draft.id, 'PUT', { version: 2, data: { ...record, body: 'Nội dung thay đổi.', status: 'published' } })).status).toBe(409)
    const published = await request('knowledge/' + draft.id, 'PUT', { version: 2, data: { ...record, status: 'published' } })
    expect(published.status).toBe(200)
    expect((await request('knowledge/' + draft.id, 'PUT', { version: 1, data: record })).status).toBe(409)
    expect((await request('knowledge?q=' + encodeURIComponent('kiểm tra'))).status).toBe(200)
    const chat = await (await request('playground', 'POST', { question: record.title })).json() as { conversation: { id: string } }
    expect(chat).toMatchObject({ result: { reason: 'grounded', text: record.body, sourceId: draft.id } })
    const followup = await (await request('playground', 'POST', { question: 'Và quy trình?', conversationId: chat.conversation.id })).json()
    expect(followup).toMatchObject({ result: { reason: 'grounded' } })
    const unknown = await (await request('playground', 'POST', { question: 'Phí giao hàng bao nhiêu?', conversationId: chat.conversation.id })).json()
    expect(unknown).toMatchObject({ conversation: { data: { status: 'handover' } }, result: { reason: 'no_source' } })
    const sensitive = await (await request('playground', 'POST', { question: 'Tôi bị dị ứng tại quy trình kiểm tra nội bộ.' })).json()
    expect(sensitive).toMatchObject({ result: { reason: 'sensitive', sources: [] } })
  })

  it('imports drafts and publishes a correction only once under concurrent requests', async () => {
    const imported = await request('knowledge/import', 'POST', [{ ...record, title: 'Tài liệu nhập' }])
    expect(imported.status).toBe(201)
    expect(await (await request('knowledge?q=' + encodeURIComponent('Tài liệu nhập'))).json()).toMatchObject({ items: [{ data: { status: 'draft' } }] })
    const correction = { title: 'Tài liệu kiểm thử đã sửa', incorrect: 'Lỗi mô phỏng.', body: 'Câu trả lời mô phỏng.', status: 'draft' }
    const draft = await (await request('training', 'POST', correction)).json() as { id: string }
    const path = 'training/' + draft.id
    expect((await request(path, 'PUT', { version: 1, data: { ...correction, status: 'approved' } })).status).toBe(200)
    const results = await Promise.all(Array.from({ length: 3 }, () => request(path + '/publish', 'POST', { version: 2 })))
    expect(results.map(result => result.status).sort()).toEqual([200, 409, 409])
    const rows = await (await request('knowledge?q=' + encodeURIComponent(correction.title))).json() as { items: unknown[] }
    expect(rows.items).toHaveLength(1)
    expect(rows.items[0]).toMatchObject({ data: { body: correction.body, status: 'published' } })
  })
})

describe('Messenger intake', () => {
  it('verifies challenges and signatures, enforces deduplication, and isolates mock activity', async () => {
    const query = '?hub.mode=subscribe&hub.verify_token=' + verify + '&hub.challenge=427'
    expect(await (await request('webhooks/messenger' + query, 'GET', undefined, false)).text()).toBe('427')
    expect((await request('webhooks/messenger' + query.replace(verify, 'wrong'), 'GET', undefined, false)).status).toBe(403)
    const bytes = new TextEncoder().encode(JSON.stringify(messenger))
    const signature = 'sha256=' + hex(await signPayload(meta, bytes))
    const deliver = (body: string) => app.dispatchFetch(origin + '/api/webhooks/messenger', {
      method: 'POST', headers: { 'X-Hub-Signature-256': signature }, body,
    })
    expect((await deliver('{}')).status).toBe(403)
    const valid = await Promise.all([deliver(JSON.stringify(messenger)), deliver(JSON.stringify(messenger))])
    expect(valid.map(response => response.status)).toEqual([200, 200])
    const conversation = await (await request('conversations/messenger%3A200')).json() as { item: { data: { messages: unknown[] } } }
    expect(conversation.item.data.messages).toHaveLength(1)
    expect(await (await request('integrations/messenger/mock', 'POST', messenger)).json()).toEqual({ accepted: 1, duplicate: 0 })
    expect(await (await request('integrations/messenger/mock', 'POST', messenger)).json()).toEqual({ accepted: 0, duplicate: 1 })
    expect(await (await request('overview?mode=live')).json()).toMatchObject({ total: 1 })
    expect(await (await request('integrations')).json()).toMatchObject({ messenger: true, outbound: false })
  })
})

describe('AI routing', () => {
  it('atomically enforces both UTC Worker AI budgets in D1', async () => {
    const bindings = await app.getBindings<{ DB: D1Database }>()
    const store = studio(bindings.DB, 'nepmui')
    const day = '2050-01-01'
    const results = await Promise.all(Array.from({ length: 6 }, () => store.reserve(day, 4, 30, 10)))
    expect(results.filter(Boolean)).toHaveLength(3)
    expect(await store.reserve(day, 3, 100, 1)).toBe(false)
    expect(await store.reserve('2050-01-02', 0, 100, 1)).toBe(false)
    expect(await store.reserve('2050-01-02', 4, 0, 1)).toBe(false)
  })

  const sources = [{ id: 'test-source', title: record.title, body: record.body }]
  const persona = { prompt: 'Test', voice: 'Test', rules: '', language: 'vi' as const }
  it('ranks Vietnamese titles and accepts only IDs from the supplied source set', async () => {
    expect(rank('Quy trinh kiem tra noi bo', sources)).toEqual(sources)
    const context = { question: record.title, sources, persona, history: [] }
    expect(await mockProvider.pick(context)).toBe('test-source')
    const choose = workersProvider({ run: async () => ({ response: 'test-source' }) }, models[0])
    expect(await choose.pick(context)).toBe('test-source')
  })
  it('escalates on quota exhaustion or fabricated provider output', async () => {
    const config = { provider: 'workers-ai', model: models[0], dailyLimit: 1 }
    function store(reserved: boolean) {
      return {
        setting: (kind: string) => Promise.resolve(kind === 'persona' ? persona : config),
        candidates: async () => ({ results: sources }),
        reserve: async () => reserved,
      } as unknown as Studio
    }
    const ai = { run: async () => ({ response: 'An invented price' }) }
    expect(await answer(store(false), ai, record.title, [])).toMatchObject({ reason: 'limit_reached' })
    expect(await answer(store(true), ai, record.title, [])).toMatchObject({ reason: 'no_selection' })
  })
})

describe('brand and model settings', () => {
  it('persists persona and brand changes, records audit history, and rejects disabled AI', async () => {
    const name = 'NẾP MÙI · Kiểm thử'
    expect((await request('brand', 'PATCH', { name })).status).toBe(200)
    expect(await (await request('session')).json()).toMatchObject({ brand: { name }, demo: false })
    const persona = { prompt: 'Support the simulated studio.', voice: 'Warm', rules: 'Escalate uncertain answers.', language: 'en' }
    expect((await request('persona', 'PUT', { data: persona, version: 0 })).status).toBe(200)
    expect(await (await request('persona')).json()).toMatchObject({ data: persona, version: 1 })
    expect((await request('persona', 'PUT', { data: persona, version: 0 })).status).toBe(409)
    expect((await request('models', 'PUT', {
      data: { provider: 'workers-ai', model: models[0], dailyLimit: 2, dailyNeurons: 100 }, version: 0,
    })).status).toBe(409)
    const chosenModel = { provider: 'mock', model: models[1], dailyLimit: 0, dailyNeurons: 0 }
    expect(await (await request('models', 'PUT', { data: chosenModel, version: 0 })).json()).toMatchObject({ data: chosenModel, version: 1 })
    const chat = await (await request('playground', 'POST', { question: 'An unsupported test request' })).json()
    expect(chat).toMatchObject({ result: { text: 'I’ll pass your question to our support team for confirmation.' } })
    expect(await (await request('audit')).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'brand', action: 'update' }),
      expect.objectContaining({ kind: 'persona', action: 'create' }),
    ]))
    expect(JSON.stringify(await (await request('audit')).json())).not.toContain('An unsupported test request')
  })
})
