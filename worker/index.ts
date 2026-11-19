import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { answer, redact, type Inference } from './ai'
import { channelAdapters, receiveBatch, signatureValid } from './channels'
import { chatInput, contracts, conversationAction, type Data } from './contracts'
import { authorized, bodyBytes, equalSecret, jsonBody, newSession, sessionAge, sessionCookie } from './security'
import { studio, type Studio } from './store'
import { canSend, drainMessenger } from './messenger'
import { admitLogin, deleteThread, purge, retentionDays, revoke, revoked } from './privacy'

export type Env = {
  DB: D1Database
  AI?: Inference
  BRAND_ID: string
  ADMIN_SECRET?: string
  META_APP_SECRET?: string
  META_VERIFY_TOKEN?: string
  META_PAGE_ID?: string
  MESSENGER_INGEST?: string
  MESSENGER_OUTBOUND?: string
  META_PAGE_TOKEN?: string
  META_GRAPH_VERSION?: string
  STUDIO_ENV?: string
  WORKERS_AI_ENABLED?: string
  DEMO?: 'loopback'
}

const app = new Hono<{ Bindings: Env; Variables: { store: Studio; demo: boolean } }>()
const authCookieOptions = { path: '/', secure: true, httpOnly: true, sameSite: 'Strict' } as const
const versionInput = z.number().int().positive()
async function authenticated(env: Env, cookie: string | undefined) {
  return await authorized(env.ADMIN_SECRET, env.BRAND_ID, cookie) &&
    !await revoked(env.DB, env.BRAND_ID, cookie)
}
const webhooks = '/api/webhooks/messenger'

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  const url = new URL(c.req.url)
  const demo = c.env.DEMO === 'loopback' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  c.set('demo', demo)
  c.set('store', studio(c.env.DB, c.env.BRAND_ID))
  if (url.pathname === webhooks) return next()
  const safe = c.req.method === 'GET' || c.req.method === 'HEAD'
  if (!safe && c.req.header('Origin') !== url.origin) return c.json({ error: 'origin_denied' }, 403)
  const publicSession = url.pathname === '/api/session' && ['GET', 'POST'].includes(c.req.method)
  if (!publicSession && !demo && !await authenticated(c.env, getCookie(c, sessionCookie))) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

app.get('/api/session', async c => {
  const demo = c.get('demo')
  const signedIn = demo || await authenticated(c.env, getCookie(c, sessionCookie))
  return c.json({ authenticated: signedIn, demo, staging: c.env.STUDIO_ENV === 'staging', brand: signedIn ? await c.get('store').brand() : undefined })
})
app.post('/api/session', async c => {
  const { ADMIN_SECRET: secret, DB, BRAND_ID } = c.env
  if (!secret || secret.length < 32) return c.json({ error: 'unauthorized' }, 401)
  if (!await admitLogin(DB, BRAND_ID, secret, c.req.header('CF-Connecting-IP') ?? 'direct')) {
    c.header('Retry-After', '600')
    return c.json({ error: 'login_limit' }, 429)
  }
  const { token } = z.object({ token: z.string().max(512) }).parse(await jsonBody(c.req.raw))
  if (!await equalSecret(token, secret)) return c.json({ error: 'unauthorized' }, 401)
  setCookie(c, sessionCookie, await newSession(secret, c.env.BRAND_ID), { ...authCookieOptions, maxAge: sessionAge })
  return c.json({ ok: true })
})
app.delete('/api/session', async c => {
  await revoke(c.env.DB, c.env.BRAND_ID, getCookie(c, sessionCookie))
  deleteCookie(c, sessionCookie, authCookieOptions)
  return c.json({ ok: true })
})

const modeInput = z.enum(['test', 'live'])
app.get('/api/overview', async c => {
  const now = new Date()
  const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  const mode = modeInput.parse(c.req.query('mode') ?? (c.get('demo') ? 'test' : 'live'))
  return c.json(await c.get('store').overview(now.toISOString().slice(0, 10), since, mode))
})
app.get('/api/audit', async c => c.json(await c.get('store').audit()))
app.patch('/api/brand', async c => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await jsonBody(c.req.raw))
  await c.get('store').rename(name)
  return c.json({ ok: true })
})

for (const kind of ['knowledge', 'products', 'training', 'conversations'] as const) {
  app.get(`/api/${kind}`, async c => {
    const search = (c.req.query('q') ?? '').trim().slice(0, 100)
    const page = z.coerce.number().int().min(0).max(1000).parse(c.req.query('page') ?? 0)
    const mode = kind === 'conversations' ? modeInput.optional().parse(c.req.query('mode')) : undefined
    const status = kind === 'conversations' && c.req.query('status') === 'handover' ? 'handover' : undefined
    const results = await c.get('store').list(kind, search, page * 50, status, mode)
    return c.json({ items: results.slice(0, 50), more: results.length > 50 })
  })
}

for (const kind of ['knowledge', 'products', 'training'] as const) {
  app.get(`/api/${kind}/:id`, async c => {
    const item = await c.get('store').get(kind, c.req.param('id'))
    return item ? c.json(item) : c.json({ error: 'missing' }, 404)
  })
  app.post(`/api/${kind}`, async c => {
    const data = contracts[kind].parse(await jsonBody(c.req.raw))
    if ('status' in data && data.status !== 'draft') return c.json({ error: 'draft_required' }, 409)
    return c.json(await c.get('store').create(kind, data), 201)
  })
  app.put(`/api/${kind}/:id`, async c => {
    const { data, version } = z.object({ data: contracts[kind], version: versionInput }).parse(await jsonBody(c.req.raw))
    const store = c.get('store')
    const current = await store.get(kind, c.req.param('id'))
    if (!current) return c.json({ error: 'missing' }, 404)
    if ('status' in data && 'status' in current.data) {
      const { status: previous, ...before } = current.data
      const { status: next, ...after } = data
      const changed = JSON.stringify(before) !== JSON.stringify(after)
      const allowed = next === 'draft' || (!changed && (
        (previous === 'draft' && next === 'approved') ||
        (kind === 'knowledge' && previous === 'approved' && next === 'published')
      ))
      if (!allowed) return c.json({ error: 'invalid_transition' }, 409)
    }
    if (kind === 'training' && 'body' in data && 'status' in data && data.status !== 'draft' && !data.body.trim()) {
      return c.json({ error: 'invalid_input' }, 400)
    }
    const result = await store.update(kind, current.id, data, version)
    return result ? c.json(result) : c.json({ error: 'conflict' }, 409)
  })
  app.delete(`/api/${kind}/:id`, async c => {
    const version = z.coerce.number().int().positive().parse(c.req.query('version'))
    return await c.get('store').remove(kind, c.req.param('id'), version)
      ? c.json({ ok: true }) : c.json({ error: 'conflict' }, 409)
  })
}
app.get('/api/knowledge/:id/history', async c => c.json(await c.get('store').history(c.req.param('id'))))
app.post('/api/knowledge/:id/restore', async c => {
  const { revision, version } = z.object({ revision: z.string().min(1).max(64), version: versionInput }).parse(await jsonBody(c.req.raw))
  const id = c.req.param('id')
  const store = c.get('store')
  const snapshot = await store.snapshot(id, revision)
  if (!snapshot) return c.json({ error: 'missing' }, 404)
  const data = contracts.knowledge.parse(JSON.parse(snapshot.data))
  const restored = await store.update('knowledge', id, { ...data, status: 'draft' }, version)
  return restored ? c.json(restored) : c.json({ error: 'conflict' }, 409)
})
const importedItem = contracts.knowledge.omit({ status: true })
app.post('/api/knowledge/import', async c => {
  const items = z.array(importedItem).min(1).max(30).parse(await jsonBody(c.req.raw))
  await c.get('store').importDrafts(items.map(item => ({ ...item, status: 'draft' })))
  return c.json({ count: items.length }, 201)
})
app.post('/api/training/:id/publish', async c => {
  const { version } = z.object({ version: versionInput }).parse(await jsonBody(c.req.raw))
  const store = c.get('store')
  const entry = await store.get('training', c.req.param('id'))
  if (!entry || entry.version !== version || entry.data.status !== 'approved' || !await store.publishCorrection(entry)) {
    return c.json({ error: 'conflict' }, 409)
  }
  return c.json({ ok: true })
})

for (const kind of ['persona', 'models'] as const) {
  app.get(`/api/${kind}`, async c => {
    const store = c.get('store')
    const existing = await store.get(kind, 'config')
    return c.json({ data: existing?.data ?? await store.setting(kind), version: existing?.version ?? 0, aiEnabled: c.env.WORKERS_AI_ENABLED === 'true' && !!c.env.AI })
  })
  app.put(`/api/${kind}`, async c => {
    const { data, version } = z.object({ data: contracts[kind], version: z.number().int().nonnegative() }).parse(await jsonBody(c.req.raw))
    if ('provider' in data && data.provider === 'workers-ai' && (c.env.WORKERS_AI_ENABLED !== 'true' || !c.env.AI)) {
      return c.json({ error: 'provider_unavailable' }, 409)
    }
    const store = c.get('store')
    const entry = version ? await store.update(kind, 'config', data, version) : await store.create(kind, data, 'config')
    return entry ? c.json(entry) : c.json({ error: 'conflict' }, 409)
  })
}

app.post('/api/playground', async c => {
  const input = chatInput.parse(await jsonBody(c.req.raw))
  const store = c.get('store')
  const previous = input.conversationId ? await store.get('conversations', input.conversationId) : undefined
  if (input.conversationId && previous?.data.channel !== 'playground') return c.json({ error: 'missing' }, 404)
  const history = previous?.data.messages ?? []
  const result = await answer(store, c.env.WORKERS_AI_ENABLED === 'true' ? c.env.AI : undefined, input.question,
    history)
  const data: Data<'conversations'> = {
    title: previous?.data.title ?? input.question.slice(0, 160), channel: 'playground',
    status: result.reason === 'grounded' && previous?.data.status !== 'handover' ? 'answered' : 'handover',
    messages: [...history, { role: 'user' as const, text: input.question }, {
      role: 'assistant' as const, text: result.text, reason: result.reason, latency: result.latency, provider: result.provider, sources: result.references,
    }].slice(-40),
  }
  const saved = previous
    ? await store.update('conversations', previous.id, data, previous.version)
    : await store.create('conversations', data)
  return saved ? c.json({ conversation: saved, result }) : c.json({ error: 'conflict' }, 409)
})
app.get('/api/conversations/detail-empty', c => c.json({ item: null }))
app.get('/api/conversations/:id', async c => {
  const item = await c.get('store').get('conversations', c.req.param('id'))
  if (!item) return c.json({ error: 'missing' }, 404)
  const delivery = await c.env.DB.prepare(`SELECT state, attempts, received FROM messenger_outbox
    WHERE brand_id=? AND thread_id=? ORDER BY received DESC LIMIT 20`).bind(c.env.BRAND_ID, item.id).all()
  return c.json({ item, delivery: delivery.results })
})
app.patch('/api/conversations/:id', async c => {
  const input = conversationAction.parse(await jsonBody(c.req.raw))
  const store = c.get('store')
  const existing = await store.get('conversations', c.req.param('id'))
  if (!existing) return c.json({ error: 'missing' }, 404)
  const { messages } = existing.data
  const reply = input.reply ? [{ role: 'human' as const, text: input.reply }] : []
  const saved = await store.update('conversations', existing.id,
    { ...existing.data, status: input.status, paused: input.paused ?? existing.data.paused, messages: [...messages, ...reply].slice(-40) }, input.version)
  return saved ? c.json(saved) : c.json({ error: 'conflict' }, 409)
})

app.delete('/api/conversations/:id', async c => {
  const version = z.coerce.number().int().positive().parse(c.req.query('version'))
  return await deleteThread(c.env.DB, c.env.BRAND_ID, c.req.param('id'), version)
    ? c.json({ ok: true }) : c.json({ error: 'conflict' }, 409)
})
app.post('/api/conversations/:id/training', async c => {
  const store = c.get('store')
  const item = await store.get('conversations', c.req.param('id'))
  if (!item) return c.json({ error: 'missing' }, 404)
  const assistantIndex = item.data.messages.findLastIndex(message => message.role === 'assistant')
  const userIndex = item.data.messages.findLastIndex(message => message.role === 'user')
  const last = userIndex > assistantIndex ? undefined : item.data.messages[assistantIndex]
  const message = userIndex > assistantIndex ? item.data.messages[userIndex] :
    item.data.messages.slice(0, assistantIndex).findLast(message => message.role === 'user')
  const data = contracts.training.parse({ title: redact(message?.text ?? item.data.title).slice(0, 160),
    incorrect: redact(last?.text ?? ''), body: '', status: 'draft', sources: last?.sources })
  return c.json(await store.create('training', data), 201)
})
app.get('/api/privacy', async c => c.json({ days: await retentionDays(c.env.DB, c.env.BRAND_ID) }))
app.put('/api/privacy', async c => {
  const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(await jsonBody(c.req.raw))
  await c.env.DB.prepare('INSERT INTO retention VALUES (?,?) ON CONFLICT(brand_id) DO UPDATE SET days=excluded.days')
    .bind(c.env.BRAND_ID, days).run()
  return c.json({ days })
})
app.post('/api/privacy/purge', async c => c.json({ count: await purge(c.env.DB, c.env.BRAND_ID) }))

app.get('/api/integrations', c => c.json({
  messenger: c.env.STUDIO_ENV !== 'staging' && c.env.MESSENGER_INGEST === 'true' && !!(c.env.META_PAGE_ID && c.env.META_APP_SECRET && c.env.META_VERIFY_TOKEN),
  outbound: canSend(c.env),
}))
app.post('/api/integrations/messenger/mock', async c => {
  const items = channelAdapters.messenger.decode(await jsonBody(c.req.raw), '100')
  const accepted = await receiveBatch(c.env.DB, c.env.BRAND_ID, 'messenger-mock', items, true)
  const sent = await drainMessenger(c.env, 'messenger-mock')
  return c.json({ accepted, duplicate: items.length - accepted, sent })
})
app.get(webhooks, async c => {
  const token = c.env.META_VERIFY_TOKEN
  const challenge = c.req.query('hub.challenge') ?? ''
  if (c.env.STUDIO_ENV === 'staging' || c.env.MESSENGER_INGEST !== 'true' || !token || c.req.query('hub.mode') !== 'subscribe' ||
    !/^\d{1,64}$/.test(challenge) || !await equalSecret(c.req.query('hub.verify_token') ?? '', token)) {
    return c.text('Forbidden', 403)
  }
  return c.text(challenge)
})
app.post(webhooks, async c => {
  const { META_APP_SECRET, META_PAGE_ID, MESSENGER_INGEST, DB, BRAND_ID } = c.env
  if (c.env.STUDIO_ENV === 'staging' || MESSENGER_INGEST !== 'true' || !META_APP_SECRET || !META_PAGE_ID) return c.text('Forbidden', 403)
  const bytes = await bodyBytes(c.req.raw, 48_000)
  if (!await signatureValid(META_APP_SECRET, bytes, c.req.header('X-Hub-Signature-256') ?? '')) return c.text('Forbidden', 403)
  const events = channelAdapters.messenger.decode(JSON.parse(new TextDecoder().decode(bytes)), META_PAGE_ID)
  await receiveBatch(DB, BRAND_ID, 'messenger', events, canSend(c.env))
  return c.text('EVENT_RECEIVED')
})

app.onError((error, c) => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_input' }, 400)
  if (error instanceof RangeError && error.message === 'body_limit') return c.json({ error: 'body_limit' }, 413)
  return c.json({ error: 'internal_error' }, 500)
})
app.notFound(c => c.json({ error: 'missing' }, 404))

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env) {
    if (controller.cron === '15 3 * * *') await purge(env.DB, env.BRAND_ID)
    else if (env.STUDIO_ENV === 'staging') await drainMessenger(env, 'messenger-mock')
    else if (canSend(env)) await drainMessenger(env, 'messenger')
  },
}
