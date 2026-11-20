import { describe, expect, it, vi } from 'vitest'
import { answer, type Inference } from '../worker/ai'
import { contracts, type Message } from '../worker/contracts'
import { models } from '../shared/models'
import type { Studio } from '../worker/store'
import fixture from './fixtures/evaluation.json'

const productRows = fixture.products.map((data, index) => ({ id: `product-${index}`, version: 1, data: contracts.products.parse(data) }))
function store(rows = productRows, reserved = true) {
  return {
    setting: async (kind: string) => kind === 'models'
      ? { provider: 'workers-ai', model: models[0], dailyLimit: 20, dailyNeurons: 4000 }
      : { prompt: 'Hỗ trợ khách hàng', voice: 'Ấm áp', rules: '', language: 'vi' },
    get: async (_kind: string, id: string) => rows.find(row => row.id === id),
    retrieve: async (kind: string) => kind === 'products' ? rows : [],
    reserve: vi.fn(async () => reserved),
  } as unknown as Studio
}
const plan = (id = 'product-0') => ({ abstain: false, tone: 'warm', closing: 'preferences', knowledge: [], products: [id] })
const failed = fixture.cases.filter(entry => ['consultation', 'fragrance-preference', 'current-price', 'stock-check', 'accent-free'].includes(entry.id))

describe('Workers AI product inference regressions', () => {
  it.each(failed)('generates grounded Vietnamese for $id with schema constrained IDs', async scenario => {
    const ai: Inference = { run: async (_model, request) => {
      expect(request.response_format.type).toBe('json_schema')
      const input = JSON.parse(request.messages[1].content)
      expect(input.products.length).toBeGreaterThan(0)
      const schema = request.response_format.json_schema as { properties: { products: { items: { enum: string[] } } } }
      expect(schema.properties.products.items.enum).toEqual(input.products.map((p: { id: string }) => p.id))
      expect(request.max_tokens).toBeGreaterThan(256)
      const selected = input.products[0].id
      // Exercise both documented object response and string JSON envelopes.
      return { response: scenario.id === 'accent-free' ? JSON.stringify(plan(selected)) : plan(selected) }
    } }
    const result = await answer(store(), ai, scenario.question, [])
    expect(result).toMatchObject({ method: 'generated', reason: scenario.reason, diagnostic: { code: 'valid_plan' } })
    for (const value of scenario.includes ?? []) expect(result.text).toContain(value)
    for (const value of scenario.excludes ?? []) expect(result.text).not.toContain(value)
  })

  it.each([
    { result: {}, code: 'response_envelope' },
    { result: { response: '{"products":[' }, code: 'invalid_json' },
    { result: { response: { ...plan(), tone: 'invented' } }, code: 'invalid_schema' },
    { result: { response: { ...plan(), products: [{ id: 'product-0', price: 1 }] } }, code: 'invalid_schema' },
    { result: { response: plan('unsupported-id') }, code: 'invalid_selection' },
    { result: { response: { ...plan(), products: ['product-0', 'product-0'] } }, code: 'invalid_selection' },
    { result: { response: { ...plan(), products: [] } }, code: 'invalid_selection' },
  ])('keeps factual fallback and distinguishes $code', async ({ result, code }) => {
    const response = await answer(store(), { run: async () => result }, failed[0].question, [])
    expect(response).toMatchObject({ method: 'extractive-fallback', diagnostic: { code } })
    expect(response.text).toContain('245.000 ₫')
    expect(response.text).not.toContain('unsupported-id')
  })

  it('never exposes provider exception text or private output through diagnostics', async () => {
    for (const text of ["JSON Mode couldn't be met person@example.org", 'private token person@example.org']) {
      const response = await answer(store(), { run: async () => { throw new Error(text) } }, failed[0].question, [])
      expect(response.diagnostic.code).toBe(text.startsWith('JSON Mode') ? 'json_mode_unmet' : 'inference_error')
      expect(JSON.stringify(response)).not.toContain('person@example.org')
    }
    const response = await answer(store(), { run: async () => ({ response: { secret: 'person@example.org' } }) }, failed[0].question, [])
    expect(JSON.stringify(response.diagnostic)).not.toContain('secret')
    expect(JSON.stringify(response.diagnostic)).not.toContain('person@example.org')
  })

  it('honors abstention, quota and unavailable catalog matches', async () => {
    const run = vi.fn(async () => ({ response: { abstain: true } }))
    expect(await answer(store(), { run }, failed[0].question, [])).toMatchObject({ method: 'handover', reason: 'no_selection' })
    run.mockClear()
    expect(await answer(store(productRows, false), { run }, failed[0].question, [])).toMatchObject({ reason: 'limit_reached' })
    expect(await answer(store(), { run }, 'Tư vấn cho người thích hương dừa', [])).toMatchObject({ reason: 'no_source' })
    expect(run).not.toHaveBeenCalled()
  })

  it('uses preference follow-ups and current facts, without repeating answered preference questions', async () => {
    const history: Message[] = [
      { role: 'user', text: failed[0].question },
      { role: 'assistant', text: 'Bạn thích nhóm hương nào?', sources: [{ id: 'product-0', kind: 'products', title: productRows[0].data.title, version: 1 }] },
    ]
    const ai = { run: async () => ({ response: plan() }) }
    const preference = await answer(store(), ai, 'Mình thích hương tuyết tùng', history)
    expect(preference.method).toBe('generated')
    expect(preference.text).not.toContain('Bạn thích nhóm hương nào')
    const changed = productRows.map(row => ({ ...row, version: 2, data: { ...row.data, price: 265000, availability: 'unavailable' as const } }))
    const result = await answer(store(changed), ai, 'Giá và tồn kho?', history)
    expect(result.method).toBe('generated')
    expect(result.text).toContain('265.000 ₫')
    expect(result.text).toContain('hết hàng')
    expect(result.text).not.toContain('245.000')
    expect(result.references[0].version).toBe(2)
  })


  it('does not carry a previous product into an explicitly named unknown target', async () => {
    const history: Message[] = [{ role: 'assistant', text: 'Giá hiện tại', sources: [
      { id: 'product-0', kind: 'products', title: productRows[0].data.title, version: 1 },
    ] }]
    for (const question of ['Bao nhiêu tiền cho Nến Tím Sao Hỏa?', 'Còn Nến Tím Sao Hỏa giá bao nhiêu?']) {
      const result = await answer(store(), undefined, question, history)
      expect(result.reason).toBe('no_source')
      expect(result.text).not.toContain('245.000')
    }
    expect(await answer(store(), undefined, 'Còn bao nhiêu hàng?', history)).toMatchObject({ reason: 'no_source' })
  })

  it('resolves a renamed product by ID and does not confuse a duplicate title', async () => {
    const history: Message[] = [{ role: 'assistant', text: 'Giá hiện tại', sources: [
      { id: 'product-0', kind: 'products', title: productRows[0].data.title, version: 1 },
    ] }]
    const rows = [{ ...productRows[0], version: 2, data: { ...productRows[0].data, title: 'Tên mới thử nghiệm', price: 275000 } },
      { ...productRows[1], data: { ...productRows[1].data, title: 'Tên mới thử nghiệm' } }]
    const result = await answer(store(rows), { run: async () => ({ response: plan() }) }, 'Giá bao nhiêu?', history)
    expect(result.method).toBe('generated')
    expect(result.text).toContain('Tên mới thử nghiệm')
    expect(result.text).toContain('275.000 ₫')
    expect(result.references).toMatchObject([{ id: 'product-0', version: 2 }])
  })

  it.each(['And the price?', 'What about stock?', 'Tồn kho?'])('keeps generic follow-up context for %s', async question => {
    const history: Message[] = [{ role: 'assistant', text: 'Current product', sources: [
      { id: 'product-0', kind: 'products', title: productRows[0].data.title, version: 1 },
    ] }]
    const result = await answer(store(), { run: async () => ({ response: plan() }) }, question, history)
    expect(result.method).toBe('generated')
    expect(result.references).toMatchObject([{ id: 'product-0' }])
  })

  it('resets preferences for a fresh explicit consultation', async () => {
    const history: Message[] = [{ role: 'user', text: 'Tư vấn cho người thích hương dừa' },
      { role: 'assistant', text: 'Chuyển hỗ trợ' }]
    const result = await answer(store(), { run: async () => ({ response: plan() }) }, failed[0].question, history)
    expect(result.method).toBe('generated')
    expect(result.text).toContain('Mẫu Thử Tuyết Tùng')
  })

  it('hands over ambiguous follow-ups instead of picking the last of several products', async () => {
    const history: Message[] = [{ role: 'assistant', text: 'Hai lựa chọn', sources: productRows.map(row => ({ id: row.id, kind: 'products', title: row.data.title, version: 1 })) }]
    expect(await answer(store(), undefined, 'Giá bao nhiêu?', history)).toMatchObject({ reason: 'no_source' })
  })
})
