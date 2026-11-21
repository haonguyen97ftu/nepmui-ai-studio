import { endpointPolicy, permitted } from './permissions'
import { connection, engineStore, registryRoutes, type Connection } from './registry'
import { legacySessionAllowed, currentActor, accountsExist, credentials, digest, legacyWorkspace, login, principal, throttle, audit, type Principal } from './accounts'
import { platformRoutes } from './platform'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { answer, safeSharedText, type Inference } from './ai'
import { channelAdapters, receiveBatch, signatureValid } from './channels'
import { chatInput, contracts, conversationAction, type Data } from './contracts'
import { bodyBytes, equalSecret, jsonBody, newSession, sessionAge, sessionCookie } from './security'
import { studio, type Studio } from './store'
import { canSend, drainMessenger } from './messenger'
import { deleteThread, purge, retentionDays, revoke } from './privacy'

export type Env = {
  DB: D1Database
  AI?: Inference
  /** Legacy transport compatibility only; never selects an authenticated workspace. */
  BRAND_ID?: string
  CHANNEL_ENCRYPTION_KEY?: string
  AUTH_PEPPER?: string
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

export type Variables = { store: Studio; demo: boolean; principal: Principal | undefined; workspaceId: string }
const app = new Hono<{ Bindings: Env; Variables: Variables }>()
const authCookieOptions = { path: '/', secure: true, httpOnly: true, sameSite: 'Strict' } as const
const versionInput = z.number().int().positive()
const webhooks = '/api/webhooks/messenger'

export const authorizeRequest=createMiddleware<{Bindings:Env;Variables:Variables}>(async (c,next)=>{
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  const url = new URL(c.req.url)
  const demo = c.env.DEMO === 'loopback' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  c.set('demo', demo)
  const policy=endpointPolicy(c.req.method,url.pathname)
  if (!policy) return c.json({ error:'forbidden' },403)
  if (url.pathname === webhooks) return next()
  const safe = c.req.method === 'GET' || c.req.method === 'HEAD'
  if (!safe && c.req.header('Origin') !== url.origin) return c.json({ error: 'origin_denied' }, 403)
  const user = await principal(c.env,getCookie(c,sessionCookie),demo)
  c.set('principal',user)
  c.set('workspaceId',user?.workspaceId ?? '')
  const access=user?.role==='customer-service' ? 'customer-service' : user?.role==='ai-trainer' ? 'ai-trainer' : 'brand-admin'
  c.set('store',studio(c.env.DB,user?.workspaceId ?? '',user && !user.legacy ? {authorization:currentActor(user,demo,access,user.workspaceId??undefined)} : {}))
  const publicSession=url.pathname==='/api/session' && ['GET','POST'].includes(c.req.method)
  if (publicSession) return next()
  if (!user) return c.json({ error:'unauthorized' },401)
  if (user.legacy) {
    if (!legacySessionAllowed(url.pathname,c.req.method)) return c.json({error:'bootstrap_required'},403)
    return next()
  }
  if (c.req.header('X-Workspace-ID') && c.req.header('X-Workspace-ID')!==user.workspaceId) return c.json({ error:'workspace_changed' },403)
  const globalRoute=/^\/api\/(session|bootstrap|workspaces|platform|accounts|account)(?:\/|$)/.test(url.pathname)
  if (!globalRoute && !user.workspaceId) return c.json({ error:'workspace_required' },409)
  if (!permitted(user.role,c.req.method,url.pathname)) return c.json({ error:'forbidden' },403)
  if (!safe && (!globalRoute || (url.pathname==='/api/accounts' && c.req.method==='POST'))) {
    const workspace=await c.env.DB.prepare('SELECT active FROM brands WHERE id=?').bind(user.workspaceId).first<{ active:number }>()
    if (!workspace?.active) return c.json({ error:'workspace_archived' },403)
  }
  await next()
  if (!safe && c.res.status<400 && !['/api/session','/api/bootstrap'].includes(url.pathname)) {
    await audit(c.env.DB,user.id,c.req.method.toLowerCase()+'.'+(url.pathname.split('/')[2]??''),url.pathname.slice(0,200),user.workspaceId)
  }
})

app.use('/api/*',authorizeRequest)

app.get('/api/session', async c => {
  const user=c.get('principal')
  const profile=user?.workspaceId && !user.legacy ? await c.env.DB.prepare('SELECT logo,color,language,archived,version FROM workspace_profiles WHERE brand_id=?').bind(user.workspaceId).first() : undefined
  const brand=user?.workspaceId && !user.legacy ? await c.env.DB.prepare('SELECT id,name,active FROM brands WHERE id=?').bind(user.workspaceId).first() : undefined
  return c.json({ authenticated:!!user,demo:c.get('demo'),staging:c.env.STUDIO_ENV==='staging',
    bootstrapRequired:!!user?.legacy, user:user ? { id:user.id,email:user.email,role:user.role,superAdmin:user.superAdmin } : undefined,
    brand:brand ? { ...brand,...profile } : undefined })
})
app.post('/api/session', async c => {
  const secret=c.env.ADMIN_SECRET
  if (!secret || secret.length<32) return c.json({ error:'unauthorized' },401)
  const input=z.union([z.object({ token:z.string().max(512) }),credentials]).parse(await jsonBody(c.req.raw))
  const address=c.req.header('CF-Connecting-IP')??'direct'
  const admitted=await throttle(c.env.DB,secret,'ip:'+address,20)
  const accountAdmitted=await throttle(c.env.DB,secret,'login:'+('email' in input ? input.email : 'bootstrap')+':'+address,5)
  if (!admitted || !accountAdmitted) { c.header('Retry-After','600'); return c.json({ error:'login_limit' },429) }
  let token:string|undefined
  if ('token' in input) {
    if (!await accountsExist(c.env.DB) && await equalSecret(input.token,secret)) token=await newSession(secret,legacyWorkspace)
  } else {
    // Independent account bucket prevents distributed guesses against one account.
    if (!await throttle(c.env.DB,secret,'account:'+input.email,10)) return c.json({ error:'login_limit' },429)
    token=await login(c.env,input.email,input.password)
  }
  if (!token) return c.json({ error:'unauthorized' },401)
  setCookie(c,sessionCookie,token,{ ...authCookieOptions,maxAge:sessionAge })
  return c.json({ ok:true })
})
app.delete('/api/session', async c => {
  const token=getCookie(c,sessionCookie)
  if (token && /^[a-f0-9]{64}$/.test(token)) await c.env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await digest(token)).run()
  else await revoke(c.env.DB,legacyWorkspace,token)
  deleteCookie(c, sessionCookie, authCookieOptions)
  return c.json({ ok: true })
})

platformRoutes(app)
registryRoutes(app)

const modeInput = z.enum(['test', 'live'])
app.get('/api/overview', async c => {
  const now = new Date()
  const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  const mode = modeInput.parse(c.req.query('mode') ?? (c.get('demo') ? 'test' : 'live'))
  return c.json(await c.get('store').overview(now.toISOString().slice(0, 10), since, mode))
})
app.get('/api/audit', async c => {
  const attributed=(await c.env.DB.prepare('SELECT id,action,target,actor,at FROM platform_audit WHERE brand_id=? ORDER BY at DESC LIMIT 50').bind(c.get('workspaceId')).all<{id:string;action:string;target:string;actor:string;at:number}>()).results
  return c.json([...(await c.get('store').audit()),...attributed.map(row=>({...row,kind:'access'}))].sort((a,b)=>Number(b.at)-Number(a.at)).slice(0,100))
})
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
    const status = kind==='knowledge' && ['viewer','customer-service'].includes(c.get('principal')!.role) ? 'published' : kind === 'conversations' && c.req.query('status') === 'handover' ? 'handover' : undefined
    const results = await c.get('store').list(kind, search, page * 50, status, mode)
    return c.json({ items: results.slice(0, 50), more: results.length > 50 })
  })
}

for (const kind of ['knowledge', 'products', 'training'] as const) {
  app.get(`/api/${kind}/:id`, async c => {
    const item = await c.get('store').get(kind, c.req.param('id'))
    return item && !(kind==='knowledge' && ['viewer','customer-service'].includes(c.get('principal')!.role) && (!('status' in item.data) || item.data.status!=='published')) ? c.json(item) : c.json({ error: 'missing' }, 404)
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
    if (current.version!==version) return c.json({error:'conflict'},409)
    if (c.get('principal')?.role==='ai-trainer' && 'status' in data && (data.status!=='draft' || ('status' in current.data && current.data.status!=='draft'))) return c.json({ error:'forbidden' },403)
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
    const current=await c.get('store').get(kind,c.req.param('id'))
    if (!current || current.version!==version) return c.json({error:'conflict'},409)
    if (c.get('principal')?.role==='ai-trainer' && current && 'status' in current.data && current.data.status!=='draft') return c.json({error:'forbidden'},403)
    return await c.get('store').remove(kind, c.req.param('id'), version)
      ? c.json({ ok: true }) : c.json({ error: 'conflict' }, 409)
  })
}
app.get('/api/knowledge/:id/history', async c => {
  const store=c.get('store'),id=c.req.param('id')
  if (!await store.get('knowledge',id)) return c.json({error:'missing'},404)
  return c.json(await store.history(id))
})
app.post('/api/knowledge/:id/restore', async c => {
  const { revision, version } = z.object({ revision: z.string().min(1).max(64), version: versionInput }).parse(await jsonBody(c.req.raw))
  const id = c.req.param('id')
  const store = c.get('store')
  const current=await store.get('knowledge',id)
  if (!current) return c.json({error:'missing'},404)
  if (current.version!==version) return c.json({error:'conflict'},409)
  if (c.get('principal')?.role==='ai-trainer' && current.data.status!=='draft') return c.json({error:'forbidden'},403)
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
  if (!['super-admin','brand-admin'].includes(c.get('principal')!.role)) return c.json({ error:'forbidden' },403)
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
  const user = c.get('principal')!
  const previous = input.conversationId ? await c.get('store').get('conversations', input.conversationId) : undefined
  if (input.conversationId && (previous?.data.channel !== 'playground' || previous.data.channelId !== input.channelId ||
    (previous.data.ownerId !== user.id && user.role !== 'super-admin' && user.role !== 'brand-admin'))) {
    return c.json({ error: 'missing' }, 404)
  }
  const access = previous && previous.data.ownerId !== user.id ? 'brand-admin' :
    user.role === 'customer-service' ? 'customer-service' : 'ai-trainer'
  let store:Studio
  try { store=await engineStore(c.env.DB,c.get('workspaceId'),input.channelId,input.agentId,currentActor(user,c.get('demo'),access,c.get('workspaceId'))) }
  catch { return c.json({ error:'missing' },404) }
  const history = previous?.data.messages ?? []
  const result = await answer(store, c.env.WORKERS_AI_ENABLED === 'true' ? c.env.AI : undefined, input.question,
    history)
  const data: Data<'conversations'> = {
    title: previous?.data.title ?? input.question.slice(0, 160), channel: 'playground', channelId:input.channelId,
    ownerId: previous ? previous.data.ownerId : user.id,
    status: result.reason === 'grounded' && previous?.data.status !== 'handover' ? 'answered' : 'handover',
    messages: [...history, { role: 'user' as const, text: input.question }, {
      role: 'assistant' as const, text: result.text, reason: result.reason, latency: result.latency, provider: result.provider, sources: result.references,
    }].slice(-40),
  }
  const saved = await store.savePlayground(data, [...result.sources, ...result.products].map(({ id, kind, title, version }) => ({
    id, kind, title, version,
  })), previous)
  return saved ? c.json({ conversation: saved, result }) : c.json({ error: 'conflict' }, 409)
})
app.get('/api/conversations/detail-empty', c => c.json({ item: null }))
app.get('/api/conversations/:id', async c => {
  const item = await c.get('store').get('conversations', c.req.param('id'))
  if (!item) return c.json({ error: 'missing' }, 404)
  const delivery = await c.env.DB.prepare(`SELECT state, attempts, received FROM messenger_outbox
    WHERE brand_id=? AND thread_id=? ORDER BY received DESC LIMIT 20`).bind(c.get('workspaceId'), item.id).all()
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
  const brand=c.get('workspaceId'),actor=currentActor(c.get('principal')!,c.get('demo'),'brand-admin',brand)
  return await deleteThread(c.env.DB,brand,c.req.param('id'),version,actor)
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
  const safeTitle = last?.reason === 'sensitive' ? undefined : safeSharedText(message?.text ?? item.data.title)
  const data = contracts.training.parse({ title: (safeTitle ?? '[Thông tin riêng tư đã ẩn]').slice(0, 160),
    incorrect: safeSharedText(last?.text ?? '') ?? '', body: '', status: 'draft',
    sources: last?.sources?.filter(source => safeSharedText(source.title) !== undefined) })
  return c.json(await store.create('training', data), 201)
})
app.get('/api/privacy', async c => c.json({ days: await retentionDays(c.env.DB, c.get('workspaceId')) }))
app.put('/api/privacy', async c => {
  const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(await jsonBody(c.req.raw))
  const brand=c.get('workspaceId'),actor=currentActor(c.get('principal')!,c.get('demo'),'brand-admin',brand)
  const saved=await c.env.DB.prepare(`INSERT INTO retention SELECT ?,? WHERE ${actor.sql}
    ON CONFLICT(brand_id) DO UPDATE SET days=excluded.days RETURNING days`).bind(brand,days,...actor.bindings).first()
  return saved ? c.json({ days }) : c.json({error:'forbidden'},403)
})
app.post('/api/privacy/purge', async c => {
  const brand=c.get('workspaceId'),actor=currentActor(c.get('principal')!,c.get('demo'),'brand-admin',brand)
  return c.json({ count:await purge(c.env.DB,brand,actor) })
})

app.get('/api/integrations', c => c.json({
  messenger: c.env.STUDIO_ENV !== 'staging' && c.env.MESSENGER_INGEST === 'true' && !!(c.env.META_PAGE_ID && c.env.META_APP_SECRET && c.env.META_VERIFY_TOKEN),
  outbound: canSend(c.env),
}))
app.post('/api/integrations/messenger/mock', async c => {
  const payload=await jsonBody(c.req.raw)
  const items=channelAdapters.messenger.decode(payload,'100')
  const brand=c.get('workspaceId')
  const actor=currentActor(c.get('principal')!,c.get('demo'),'brand-admin',brand)
  const accepted=await receiveBatch(c.env.DB,brand,'messenger-mock',items,true,undefined,actor)
  const sent=accepted ? await drainMessenger({ ...c.env,BRAND_ID:brand },'messenger-mock') : 0
  return c.json({ accepted,duplicate:items.length-accepted,sent })
})
app.post('/api/channels/:id/mock',async c=>{
  const brand=c.get('workspaceId'),registered=await connection(c.env.DB,brand,c.req.param('id'))
  if (!registered || registered.kind!=='messenger' || !registered.mock) return c.json({ error:'missing' },404)
  if (registered.state!=='connected' || registered.paused) return c.json({ error:'channel_paused' },409)
  const items=channelAdapters.messenger.decode(await jsonBody(c.req.raw),registered.external_id)
  const actor=currentActor(c.get('principal')!,c.get('demo'),'brand-admin',brand)
  const accepted=await receiveBatch(c.env.DB,brand,'messenger-mock',items,true,registered.id,actor)
  if (accepted) await c.env.DB.prepare(`UPDATE channels SET last_event=? WHERE brand_id=? AND id=? AND ${actor.sql}`)
    .bind(Date.now(),brand,registered.id,...actor.bindings).run()
  const sent=accepted ? await drainMessenger({ ...c.env,BRAND_ID:brand },'messenger-mock',2,fetch,registered.id) : 0
  return c.json({ accepted,duplicate:items.length-accepted,sent })
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
  const { META_APP_SECRET,MESSENGER_INGEST,DB }=c.env
  if (c.env.STUDIO_ENV==='staging' || MESSENGER_INGEST!=='true' || !META_APP_SECRET) return c.text('Forbidden',403)
  const bytes=await bodyBytes(c.req.raw,48000)
  if (!await signatureValid(META_APP_SECRET,bytes,c.req.header('X-Hub-Signature-256')??'')) return c.text('Forbidden',403)
  const payload=JSON.parse(new TextDecoder().decode(bytes))
  const pages=z.object({ object:z.literal('page'),entry:z.array(z.object({ id:z.string().max(100) }).passthrough()).max(10) }).parse(payload)
  for (const page of new Set(pages.entry.map(entry=>entry.id))) {
    const registered=await DB.prepare(`SELECT c.* FROM channels c JOIN brands b ON b.id=c.brand_id
      WHERE c.kind='messenger' AND c.external_id=? AND c.mock=0 AND c.verified=1 AND c.token_cipher IS NOT NULL AND c.state='connected' AND c.paused=0 AND b.active=1`).bind(page).first<Connection>()
    const events=channelAdapters.messenger.decode(payload,page)
    if (registered) {
      const accepted=await receiveBatch(DB,registered.brand_id,'messenger',events,true,registered.id)
      if (accepted) await DB.prepare('UPDATE channels SET last_event=? WHERE id=?').bind(Date.now(),registered.id).run()
    } else if (!await accountsExist(DB) && page===c.env.META_PAGE_ID && !await DB.prepare('SELECT 1 FROM channels LIMIT 1').first()) {
      // Temporary compatibility for the unmigrated, unclaimed founder environment only.
      await receiveBatch(DB,legacyWorkspace,'messenger',events,canSend(c.env))
    }
  }
  return c.text('EVENT_RECEIVED')
})

app.onError((error, c) => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_input' }, 400)
  if (error instanceof RangeError && error.message === 'write_conflict') return c.json({error:'conflict'},409)
  if (error instanceof RangeError && error.message === 'body_limit') return c.json({ error: 'body_limit' }, 413)
  return c.json({ error: 'internal_error' }, 500)
})
app.notFound(c => c.json({ error: 'missing' }, 404))

export default app
