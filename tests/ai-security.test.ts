import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runtime } from '../scripts/runtime.mjs'
import { models } from '../shared/models'
import { createSession } from '../worker/accounts'
import { answer, type Inference } from '../worker/ai'
import type { Message } from '../worker/contracts'
import { studio, type Studio } from '../worker/store'

const canary = 'SYNTHETIC-CREDENTIAL-CANARY'
const privateTurn = 'My password is ' + canary
const product = { title: 'Nến Tuyết Tùng', notes: 'Gỗ tuyết tùng', price: 245000, availability: 'available' as const, image: '' }
const config = { provider: 'workers-ai' as const, model: models[0], dailyLimit: 20, dailyNeurons: 4000 }
const plan = { response: { abstain: false, tone: 'concise', closing: 'none', products: ['p'], knowledge: [] } }
const priceQuestion = product.title + ' giá bao nhiêu?'
function inferenceStore(rows = [{ id: 'p', version: 1, data: product }]) {
  return {
    setting: async (kind: string) => kind === 'models' ? config : { prompt: '', voice: '', rules: '', language: 'vi' },
    retrieve: async (kind: string) => kind === 'products' ? rows : [],
    reserve: async () => true,
  } as unknown as Studio
}

describe('provider data boundaries', () => {
  it('omits previously blocked turns and operator messages from a later provider request', async () => {
    const run = vi.fn<Inference['run']>(async () => plan)
    expect((await answer(inferenceStore(), { run }, privateTurn, [])).reason).toBe('sensitive')
    expect(run).not.toHaveBeenCalled()
    const history: Message[] = [
      { role: 'user', text: privateTurn },
      { role: 'assistant', reason: 'sensitive', text: 'Handed over' },
      { role: 'human', text: 'Operator note ' + canary },
    ]
    expect((await answer(inferenceStore(), { run }, priceQuestion, history)).method).toBe('generated')
    expect(JSON.stringify(run.mock.calls[0][1])).not.toContain(canary)
    expect(JSON.parse(run.mock.calls[0][1].messages[1].content).history).toEqual([])
  })

  it('never reflects arbitrary error digits into the public diagnostic', async () => {
    const result = await answer(inferenceStore(), { run: async () => {
      throw new Error('provider rejected synthetic OTP error code 839154')
    } }, priceQuestion, [])
    expect(result.method).toBe('extractive-fallback')
    expect(JSON.stringify(result.diagnostic)).not.toContain('839154')
  })

  it('abstains from quoting ambiguous names and suppresses conflicting unstructured claims', async () => {
    const run = vi.fn<Inference['run']>(async () => plan)
    const ambiguous = await answer(inferenceStore([{ id: 'p', data: product, version: 1 },
      { id: 'p2', data: { ...product, price: 355000 }, version: 1 }]), { run }, priceQuestion, [])
    expect(ambiguous.reason).toBe('no_source')
    expect(run).not.toHaveBeenCalled()
    const notes = 'Gỗ tuyết tùng. Sale price 150 thousand VNÐ.'
    const consultation = await answer(inferenceStore([{ id: 'p', data: { ...product, notes }, version: 1 }]),
      { run }, 'Tư vấn nến phù hợp cho phòng ngủ', [])
    expect(consultation.text).toContain('245.000 ₫')
    expect(JSON.stringify(consultation)).not.toContain('150 thousand')
  })
})

describe('D1 AI boundary enforcement', () => {
  let instance: Awaited<ReturnType<typeof runtime>>
  let store: Studio
  beforeAll(async () => {
    instance = await runtime()
    const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
    store = studio(DB, 'nepmui')
    await instance.db.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES (?,?,?,?,?,1,1,0)')
      .bind('synthetic-founder', 'founder@example.test', 'Synthetic founder', '-', '-').run()
  })
  afterAll(async () => { await instance?.app.dispose() })

  it('keeps published rankings stable after foreign and unpublished corpus additions', async () => {
    const doc = { category: 'Synthetic', body: 'Synthetic content', status: 'published' as const }
    await store.create('knowledge', { ...doc, title: 'termalpha' }, 'rank-1')
    await store.create('knowledge', { ...doc, title: 'termbeta' }, 'rank-2')
    expect((await store.retrieve('knowledge', 'termalpha termbeta')).map(row => row.id)).toEqual(['rank-1', 'rank-2'])
    await instance.db.prepare("INSERT INTO brands VALUES ('other','Other synthetic workspace',1)").run()
    const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
    const other = studio(DB, 'other')
    await other.importDrafts(Array.from({ length: 12 }, () => ({ ...doc, title: 'termalpha' })))
    await store.importDrafts(Array.from({ length: 12 }, () => ({ ...doc, title: 'termalpha', status: 'draft' as const })))
    expect((await store.retrieve('knowledge', 'termalpha termbeta')).map(row => row.id)).toEqual(['rank-1', 'rank-2'])
  })

  it('checks current workspace ceilings in the same statement as the reservation', async () => {
    await store.create('models', config, 'config')
    expect(await store.reserve('2055-01-01', 20, 4000, 100, true)).toBe(true)
    await store.update('models', 'config', { ...config, dailyLimit: 1 }, 1)
    expect(await store.reserve('2055-01-01', 20, 4000, 100, true)).toBe(false)
    await store.update('models', 'config', { ...config, dailyNeurons: 20 }, 2)
    expect(await store.reserve('2055-01-02', 20, 4000, 100, true)).toBe(false)
  })

  it('refuses a Playground save after a source changes or is unpublished', async () => {
    const entry = await store.create('products', product, 'price-source')
    const refs = [{ id: entry!.id, version: entry!.version, title: product.title, kind: 'products' as const }]
    const thread = { title: 'Synthetic question', channel: 'playground' as const, status: 'answered' as const, messages: [] }
    const original = await store.savePlayground(thread, refs)
    expect(original).toBeDefined()
    await store.update('products', entry!.id, { ...product, price: 355000 }, entry!.version)
    expect(await store.savePlayground(thread, refs, original)).toBeUndefined()
    expect(await store.savePlayground(thread, refs)).toBeUndefined()
    const draft = await store.create('knowledge', { title: 'Synthetic draft', category: 'Synthetic', body: 'Draft', status: 'draft' }, 'draft-source')
    expect(await store.savePlayground(thread, [{ id: draft!.id, version: draft!.version, title: draft!.data.title, kind: 'knowledge' }])).toBeUndefined()
  })

  it('redacts sensitive customer text when creating a training correction', async () => {
    const service = 'synthetic-service'
    await instance.db.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES (?,?,?,?,?,1,0,0)')
      .bind(service, 'service@example.test', 'Synthetic service user', '-', '-').run()
    await instance.db.prepare("INSERT INTO memberships VALUES (?,'nepmui','customer-service')").bind(service).run()
    const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
    const token = await createSession(DB, service, 'nepmui')
    const thread = await store.create('conversations', {
      title: privateTurn, channel: 'playground', ownerId: service, status: 'handover',
      messages: [{ role: 'user', text: privateTurn }, { role: 'assistant', text: 'Handed over', reason: 'sensitive' }],
    })
    const origin = 'https://ai-security.example.test'
    const response = await instance.app.dispatchFetch(origin + '/api/conversations/' + thread!.id + '/training', {
      method: 'POST', headers: { Origin: origin, Cookie: '__Host-studio=' + token },
    })
    expect(response.status).toBe(201)
    const draft = await response.json() as { id: string }
    expect(JSON.stringify(await store.get('training', draft.id))).not.toContain(canary)
  })

  it('limits Playground resume to the owner and administrators without assigning legacy ownership', async () => {
    const { DB } = await instance.app.getBindings<{ DB: D1Database }>()
    const origin = 'https://ai-security.example.test'
    const trainer = 'synthetic-trainer'
    const owner = 'synthetic-owner'
    for (const id of [trainer, owner]) {
      await instance.db.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES (?,?,?,?,?,1,0,0)')
        .bind(id, id + '@example.test', id, '-', '-').run()
      await instance.db.prepare("INSERT INTO memberships VALUES (?,'nepmui','ai-trainer')").bind(id).run()
    }
    const request = async (actor: string, conversationId?: string, question = 'Synthetic follow-up') => {
      const token = await createSession(DB, actor, 'nepmui')
      return instance.app.dispatchFetch(origin + '/api/playground', {
        method: 'POST', headers: { Origin: origin, Cookie: '__Host-studio=' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversationId }),
      })
    }
    const created = await request(owner, undefined, privateTurn)
    expect(created.status).toBe(200)
    const { conversation } = await created.json() as { conversation: { id: string; data: { ownerId: string } } }
    expect(conversation.data.ownerId).toBe(owner)
    const denied = await request(trainer, conversation.id)
    expect(denied.status).toBe(404)
    expect(await denied.text()).not.toContain(canary)
    expect((await request(owner, conversation.id)).status).toBe(200)
    expect((await request('synthetic-founder', conversation.id)).status).toBe(200)
    expect((await store.get('conversations', conversation.id))?.data.ownerId).toBe(owner)

    const legacy = await store.create('conversations', {
      title: 'Synthetic legacy thread', channel: 'playground', status: 'handover', messages: [],
    })
    expect((await request(owner, legacy!.id)).status).toBe(404)
    expect((await request('synthetic-founder', legacy!.id)).status).toBe(200)
    expect((await store.get('conversations', legacy!.id))?.data.ownerId).toBeUndefined()
  })
})
