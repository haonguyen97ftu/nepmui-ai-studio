import { readFile } from 'node:fs/promises'

const { STUDIO_BENCHMARK_URL, STUDIO_BENCHMARK_ADMIN_SECRET } = process.env
if (!STUDIO_BENCHMARK_URL || !STUDIO_BENCHMARK_ADMIN_SECRET) {
  throw new Error('Set STUDIO_BENCHMARK_URL and STUDIO_BENCHMARK_ADMIN_SECRET in a private staging shell.')
}
const host = new URL(STUDIO_BENCHMARK_URL)
if (host.protocol !== 'https:' || !/^nepmui-ai-studio-staging\.[\w-]+\.workers\.dev$/.test(host.hostname)) {
  throw new Error('Use the staging workers.dev URL.')
}
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/evaluation.json', import.meta.url), 'utf8'))
const cleanup = []
let cookie
async function api(path, method = 'GET', payload) {
  const response = await fetch(new URL('/api/' + path, host), {
    method, redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Origin: host.origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Staging request failed (${method} ${path.split('/')[0]}, HTTP ${response.status}).`)
  if (path === 'session' && method === 'POST') cookie = response.headers.get('Set-Cookie')?.split(';')[0]
  return response.json()
}
try {
  await api('session', 'POST', { token: STUDIO_BENCHMARK_ADMIN_SECRET })
  if (!(await api('session')).staging) throw new Error('The session does not identify this Worker as staging.')
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
  let passed = 0
  for (const scenario of fixture.cases) {
    const { result, conversation } = await api('playground', 'POST', { question: scenario.question })
    cleanup.push({ path: 'conversations/' + conversation.id, version: conversation.version })
    const ok = result.reason === scenario.reason &&
      (scenario.reason !== 'grounded' || result.method === 'generated') &&
      (scenario.includes ?? []).every(text => result.text.includes(text)) &&
      (scenario.excludes ?? []).every(text => !result.text.includes(text))
    passed += Number(ok)
    console.log(JSON.stringify({ scenario: scenario.id, passed: ok, method: result.method, reason: result.reason, ms: result.latency }))
  }
  console.log(JSON.stringify({ passed, total: fixture.cases.length }))
  if (passed !== fixture.cases.length) process.exitCode = 1
} finally {
  for (const item of cleanup.reverse()) {
    try {
      await api(item.path + '?version=' + item.version, 'DELETE')
    } catch {
      console.error('A synthetic staging record needs manual cleanup.')
      process.exitCode = 1
    }
  }
  if (cookie) await api('session', 'DELETE')
}
