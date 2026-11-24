import { readFile } from 'node:fs/promises'

const { STUDIO_BENCHMARK_URL, STUDIO_BENCHMARK_EMAIL, STUDIO_BENCHMARK_PASSWORD, STUDIO_BENCHMARK_WORKSPACE } = process.env
if (!STUDIO_BENCHMARK_URL || !STUDIO_BENCHMARK_EMAIL || !STUDIO_BENCHMARK_PASSWORD || !STUDIO_BENCHMARK_WORKSPACE) {
  throw new Error('The staging benchmark requires scoped account credentials and the authorized workspace ID.')
}
const host = new URL(STUDIO_BENCHMARK_URL)
if (host.protocol !== 'https:' || !/^nepmui-ai-studio-staging\.[\w-]+\.workers\.dev$/.test(host.hostname)) {
  throw new Error('Use the staging workers.dev URL.')
}
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/evaluation.json', import.meta.url), 'utf8'))
const cleanup = []
let cookie,workspaceScope
async function api(path, method = 'GET', payload) {
  const response = await fetch(new URL('/api/' + path, host), {
    method, redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Origin: host.origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),...(workspaceScope && path!=='session'?{'X-Workspace-ID':workspaceScope}:{}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Staging request failed (${method} ${path.split('/')[0]}, HTTP ${response.status}).`)
  if (path === 'session' && method === 'POST') cookie = response.headers.get('Set-Cookie')?.split(';')[0]
  return response.json()
}
try {
  await api('session', 'POST', {email:STUDIO_BENCHMARK_EMAIL,password:STUDIO_BENCHMARK_PASSWORD})
  await api('workspaces/'+encodeURIComponent(STUDIO_BENCHMARK_WORKSPACE)+'/switch','POST')
  const session=await api('session')
  if (session.brand?.id!==STUDIO_BENCHMARK_WORKSPACE) throw new Error('Benchmark workspace mismatch.')
  workspaceScope=STUDIO_BENCHMARK_WORKSPACE
  if (!session.staging) throw new Error('The session does not identify this Worker as staging.')
  const model = await api('models')
  if (model.data.provider !== 'workers-ai' || model.data.dailyLimit < fixture.cases.length || model.data.dailyNeurons === 0) {
    throw new Error('Configure Workers AI and enough remaining staging budget for this fixture before running the benchmark.')
  }
  for (const product of fixture.products) {
    const row = await api('products', 'POST', product)
    cleanup.push({ path: 'products/' + row.id, version: row.version })
  }
  for (const knowledge of fixture.knowledge) {
    const draft = { ...knowledge, status: 'draft' }
    let row = await api('knowledge', 'POST', draft)
    const item = { path: 'knowledge/' + row.id, version: row.version }
    cleanup.push(item)
    if (knowledge.status === 'published') {
      for (const status of ['approved', 'published']) {
        row = await api(item.path, 'PUT', { data: { ...draft, status }, version: row.version })
        item.version = row.version
      }
    }
  }
  const conversations = new Map()
  let passed = 0
  for (const scenario of fixture.cases) {
    const { result, conversation } = await api('playground', 'POST', { question: scenario.question })
    const saved = { path: 'conversations/' + conversation.id, version: conversation.version }
    cleanup.push(saved)
    conversations.set(scenario.id, { conversation, saved })
    const ok = result.reason === scenario.reason &&
      (scenario.reason !== 'grounded' || result.method === 'generated') &&
      (scenario.includes ?? []).every(text => result.text.includes(text)) &&
      (scenario.excludes ?? []).every(text => !result.text.includes(text))
    passed += Number(ok)
    console.log(JSON.stringify({ scenario: scenario.id, passed: ok, method: result.method, reason: result.reason, ms: result.latency, diagnostic: result.diagnostic }))
  }
  console.log(JSON.stringify({ passed, total: fixture.cases.length, model: model.data.model }))
  // Additional checks keep the original 13 scenarios and assertions intact.
  const consultation = conversations.get('consultation')
  const preference = await api('playground', 'POST', {
    question: 'Mình thích hương tuyết tùng', conversationId: consultation.conversation.id,
  })
  consultation.saved.version = preference.conversation.version
  const preferenceOk = preference.result.method === 'generated' && preference.result.reason === 'grounded' &&
    preference.result.text.includes('Gỗ tuyết tùng') && !preference.result.text.includes('Hoa Trắng') &&
    !preference.result.text.includes('Bạn thích nhóm hương nào')
  console.log(JSON.stringify({ scenario: 'multi-turn-preference', passed: preferenceOk, diagnostic: preference.result.diagnostic }))

  const product = cleanup.find(item => item.path.startsWith('products/'))
  const current = await api(product.path)
  const updated = await api(product.path, 'PUT', { version: current.version,
    data: { ...current.data, price: 265000, availability: 'unavailable' } })
  product.version = updated.version
  const price = conversations.get('current-price')
  const refreshed = await api('playground', 'POST', {
    question: 'Còn giá và tồn kho?', conversationId: price.conversation.id,
  })
  price.saved.version = refreshed.conversation.version
  const refreshedOk = refreshed.result.method === 'generated' && refreshed.result.reason === 'grounded' &&
    refreshed.result.text.includes('265.000 ₫') && refreshed.result.text.includes('hết hàng') &&
    !refreshed.result.text.includes('245.000') && refreshed.result.references.some(ref => ref.id === updated.id && ref.version === updated.version)
  console.log(JSON.stringify({ scenario: 'multi-turn-current-catalog', passed: refreshedOk, diagnostic: refreshed.result.diagnostic }))
  if (!preferenceOk || !refreshedOk) process.exitCode = 1
  if (passed !== fixture.cases.length) process.exitCode = 1
} finally {
  for (const item of cleanup.reverse()) {
    try {
      // Refresh only IDs created by this run, so a committed follow-up whose
      // response timed out does not strand a synthetic row at a newer version.
      const current = await api(item.path)
      const row = item.path.startsWith('conversations/') ? current.item : current
      await api(item.path + '?version=' + row.version, 'DELETE')
    } catch {
      console.error('A synthetic staging record needs manual cleanup.')
      process.exitCode = 1
    }
  }
  if (cookie) await api('session', 'DELETE')
}
