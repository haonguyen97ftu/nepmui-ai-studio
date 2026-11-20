import type { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { z } from 'zod'
import { accountPassword, passwordHash, authReady, throttle, accountsExist, audit, createSession, legacyWorkspace, roles, workspaceRole, type Principal } from './accounts'
import { equalSecret, jsonBody, sessionAge, sessionCookie } from './security'
import type { Env, Variables } from './index'

export const profileInput = z.object({
  name: z.string().trim().min(1).max(80), logo: z.string().max(1000).refine(v => !v || /^https:\/\/[^\s]+$/.test(v)).default(''),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#445239'), language: z.enum(['vi','en']).default('vi'),
  active: z.boolean().default(true), archived: z.boolean().default(false),
})
export type Workspace = z.infer<typeof profileInput> & { id: string; version: number }
export async function workspaces(db: D1Database, user: Principal) {
  return (await db.prepare(`SELECT b.id,b.name,b.active,p.logo,p.color,p.language,p.archived,p.version,
    (SELECT count(*) FROM channels c WHERE c.brand_id=b.id AND c.state='connected') channels,
    coalesce((SELECT calls FROM usage WHERE brand_id=b.id AND day=date('now')),0) calls,
    coalesce((SELECT reserved_neurons FROM usage WHERE brand_id=b.id AND day=date('now')),0) neurons
    FROM brands b JOIN workspace_profiles p ON p.brand_id=b.id
    WHERE ?=1 OR EXISTS(SELECT 1 FROM memberships m WHERE m.account_id=? AND m.brand_id=b.id)
    ORDER BY p.archived,b.id`).bind(Number(user.superAdmin),user.id).all()).results
}
export function platformRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {
  app.post('/api/bootstrap', async c => {
    const user = c.get('principal')!
    if (!user.legacy || await accountsExist(c.env.DB)) return c.json({ error: 'bootstrap_closed' },409)
    const input = z.object({ email: z.email().max(254).transform(v=>v.toLowerCase()), name: z.string().trim().min(1).max(80), password: z.string().min(16).max(128) }).parse(await jsonBody(c.req.raw))
    if (!authReady(c.env)) return c.json({error:'auth_unavailable'},409)
    const { salt, hash } = await accountPassword(input.password,c.env.AUTH_PEPPER!)
    const id = crypto.randomUUID()
    // INSERT ... SELECT serializes the one-time bootstrap across competing requests.
    const row = await c.env.DB.prepare(`INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) SELECT ?,?,?,?,?,1,1,? WHERE NOT EXISTS(SELECT 1 FROM accounts) RETURNING id`)
      .bind(id,input.email,input.name,hash,salt,Date.now()).first()
    if (!row) return c.json({ error: 'bootstrap_closed' },409)
    const token = await createSession(c.env.DB,id,legacyWorkspace)
    if (!token) return c.json({ error:'conflict' },409)
    setCookie(c,sessionCookie,token,{ path: '/',secure: true,httpOnly: true,sameSite: 'Strict',maxAge: sessionAge })
    await audit(c.env.DB,id,'founder.bootstrap',id,legacyWorkspace)
    return c.json({ ok: true },201)
  })
  app.post('/api/account/password',async c=>{
    const user=c.get('principal')!
    if (user.legacy || c.get('demo')) return c.json({ error:'forbidden' },403)
    if (!authReady(c.env)) return c.json({error:'auth_unavailable'},409)
    const input=z.object({ currentPassword:z.string().min(1).max(128),password:z.string().min(16).max(128) }).parse(await jsonBody(c.req.raw))
    if (!await throttle(c.env.DB,c.env.ADMIN_SECRET??'',user.id+':password-change',5)) return c.json({ error:'login_limit' },429)
    const current=await c.env.DB.prepare('SELECT salt,password_hash FROM accounts WHERE id=? AND active=1').bind(user.id).first<{salt:string;password_hash:string}>()
    if (!current || !await equalSecret(await passwordHash(input.currentPassword,current.salt,c.env.AUTH_PEPPER!),current.password_hash)) return c.json({ error:'unauthorized' },401)
    const {salt,hash}=await accountPassword(input.password,c.env.AUTH_PEPPER!)
    const changed=await c.env.DB.batch([
      c.env.DB.prepare('UPDATE accounts SET password_hash=?,salt=?,auth_version=auth_version+1 WHERE id=? AND password_hash=? RETURNING id').bind(hash,salt,user.id,current.password_hash),
      c.env.DB.prepare('DELETE FROM account_sessions WHERE account_id=? AND changes()=1').bind(user.id),
    ])
    if (!changed[0].results.length) return c.json({error:'conflict'},409)
    await audit(c.env.DB,user.id,'account.password',user.id)
    return c.json({ ok:true })
  })
  app.get('/api/workspaces', async c => c.json({ items: await workspaces(c.env.DB,c.get('principal')!) }))
  app.post('/api/workspaces', async c => {
    const user = c.get('principal')!
    if (!user.superAdmin) return c.json({ error: 'forbidden' },403)
    const input = profileInput.parse(await jsonBody(c.req.raw))
    const id = crypto.randomUUID()
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO brands VALUES (?,?,?)').bind(id,input.name,Number(input.active && !input.archived)),
      c.env.DB.prepare('INSERT INTO workspace_profiles VALUES (?,?,?,?,?,1)').bind(id,input.logo,input.color,input.language,Number(input.archived)),
      c.env.DB.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES (?,'persona','config',?,?)")
        .bind(id,JSON.stringify({ prompt: `Bạn là trợ lý của ${input.name}.`, voice: 'Rõ ràng, thân thiện', rules: 'Chuyển câu hỏi chưa có căn cứ cho nhân viên.', language: input.language }),Date.now()),
    ])
    await audit(c.env.DB,user.id,'workspace.create',id,id)
    return c.json({ id },201)
  })
  app.put('/api/workspaces/:id', async c => {
    const user = c.get('principal')!
    const id = c.req.param('id')
    if (!user.superAdmin && (user.workspaceId !== id || user.role !== 'brand-admin')) return c.json({ error: 'forbidden' },403)
    const { version, ...input } = profileInput.extend({ version: z.number().int().positive() }).parse(await jsonBody(c.req.raw))
    if (!user.superAdmin && (input.archived || !input.active)) return c.json({ error: 'forbidden' },403)
    const previous=await c.env.DB.prepare('SELECT language FROM workspace_profiles WHERE brand_id=? AND version=?').bind(id,version).first<{language:string}>()
    const result = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE workspace_profiles SET logo=?,color=?,language=?,archived=?,version=version+1 WHERE brand_id=? AND version=? AND (?=1 OR (archived=0 AND EXISTS(SELECT 1 FROM brands b WHERE b.id=brand_id AND b.active=1))) RETURNING brand_id')
        .bind(input.logo,input.color,input.language,Number(input.archived),id,version,Number(user.superAdmin)),
      c.env.DB.prepare('UPDATE brands SET name=?,active=? WHERE id=? AND changes()=1').bind(input.name,Number(input.active && !input.archived),id),
      c.env.DB.prepare("UPDATE records SET data=json_set(data,'$.language',?),version=version+1,updated=? WHERE brand_id=? AND kind='persona' AND id='config' AND ?=1 AND changes()=1").bind(input.language,Date.now(),id,Number(!!previous && previous.language!==input.language)),
    ])
    if (!result[0].results.length) return c.json({ error: 'conflict' },409)
    await audit(c.env.DB,user.id,input.archived ? 'workspace.archive' : 'workspace.update',id,id)
    return c.json({ ok: true })
  })
  app.post('/api/workspaces/:id/switch', async c => {
    const user = c.get('principal')!
    const id = c.req.param('id')
    if (!await workspaceRole(c.env.DB,user.id,id,user.superAdmin)) return c.json({ error: 'forbidden' },403)
    if (user.legacy) return c.json({ error: 'bootstrap_required' },409)
    if (user.hash) await c.env.DB.prepare('UPDATE account_sessions SET brand_id=? WHERE token_hash=?').bind(id,user.hash).run()
    else if (c.get('demo')) {
      const token = await createSession(c.env.DB,user.id,id)
      if (!token) return c.json({ error:'conflict' },409)
      setCookie(c,sessionCookie,token,{ path:'/',secure:true,httpOnly:true,sameSite:'Strict',maxAge:sessionAge })
    } else return c.json({ error: 'unauthorized' },401)
    await audit(c.env.DB,user.id,'workspace.switch',id,id)
    return c.json({ ok: true })
  })
  app.get('/api/platform', async c => {
    const user = c.get('principal')!
    if (!user.superAdmin) return c.json({ error: 'forbidden' },403)
    const day = new Date().toISOString().slice(0,10)
    return c.json({ workspaces: await workspaces(c.env.DB,user),
      limits: await c.env.DB.prepare('SELECT calls,neurons FROM platform_limits WHERE id=1').first(),
      usage: await c.env.DB.prepare('SELECT calls,neurons FROM platform_usage WHERE day=?').bind(day).first() ?? { calls:0,neurons:0 },
      audit: (await c.env.DB.prepare('SELECT * FROM platform_audit ORDER BY at DESC LIMIT 50').all()).results })
  })
  app.put('/api/platform/limits', async c => {
    const user = c.get('principal')!
    if (!user.superAdmin) return c.json({ error: 'forbidden' },403)
    const input = z.object({ calls:z.number().int().min(0).max(1000),neurons:z.number().int().min(0).max(8000) }).parse(await jsonBody(c.req.raw))
    await c.env.DB.prepare('UPDATE platform_limits SET calls=?,neurons=? WHERE id=1').bind(input.calls,input.neurons).run()
    await audit(c.env.DB,user.id,'platform.limits','1')
    return c.json({ ok:true })
  })
  app.get('/api/accounts', async c => {
    const user = c.get('principal')!
    if (!user.superAdmin && user.role !== 'brand-admin') return c.json({ error:'forbidden' },403)
    const rows = await c.env.DB.prepare(`SELECT a.id,a.name,a.email,a.active,a.super_admin,m.role FROM accounts a
      LEFT JOIN memberships m ON m.account_id=a.id AND m.brand_id=?
      WHERE ?=1 OR m.brand_id=? ORDER BY a.created DESC LIMIT 100`)
      .bind(user.workspaceId,Number(user.superAdmin),user.workspaceId).all()
    return c.json({ items:rows.results })
  })
  app.post('/api/accounts', async c => {
    const user = c.get('principal')!
    if (!user.superAdmin && user.role !== 'brand-admin') return c.json({ error:'forbidden' },403)
    const input = z.object({ email:z.email().max(254).transform(v=>v.toLowerCase()),name:z.string().trim().min(1).max(80),
      password:z.string().min(16).max(128),role:z.enum(roles),superAdmin:z.boolean().default(false) }).parse(await jsonBody(c.req.raw))
    if ((!user.superAdmin && input.superAdmin) || !user.workspaceId) return c.json({ error:'forbidden' },403)
    if (await c.env.DB.prepare('SELECT 1 FROM accounts WHERE email=?').bind(input.email).first()) return c.json({ error:'conflict' },409)
    if (!authReady(c.env)) return c.json({error:'auth_unavailable'},409)
    const id=crypto.randomUUID(), { hash,salt }=await accountPassword(input.password,c.env.AUTH_PEPPER!)
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES (?,?,?,?,?,1,?,?)').bind(id,input.email,input.name,hash,salt,Number(input.superAdmin),Date.now()),
      c.env.DB.prepare('INSERT INTO memberships VALUES (?,?,?)').bind(id,user.workspaceId,input.role),
    ])
    await audit(c.env.DB,user.id,'account.create',id,user.workspaceId)
    return c.json({ id },201)
  })
  app.put('/api/accounts/:id', async c => {
    const user=c.get('principal')!, id=c.req.param('id')
    if (!user.superAdmin || id===user.id) return c.json({ error:'forbidden' },403)
    const input=z.object({ active:z.boolean(),superAdmin:z.boolean(),password:z.string().min(16).max(128).optional() }).parse(await jsonBody(c.req.raw))
    if (input.password && !authReady(c.env)) return c.json({error:'auth_unavailable'},409)
    const password=input.password ? await accountPassword(input.password,c.env.AUTH_PEPPER!) : undefined
    const result=await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE accounts SET auth_version=auth_version+1,active=?,super_admin=?,password_hash=coalesce(?,password_hash),salt=coalesce(?,salt) WHERE id=? RETURNING id`)
        .bind(Number(input.active),Number(input.superAdmin),password?.hash??null,password?.salt??null,id),
      c.env.DB.prepare('DELETE FROM account_sessions WHERE account_id=?').bind(id),
    ])
    if (!result[0].results.length) return c.json({ error:'missing' },404)
    await audit(c.env.DB,user.id,'account.lifecycle',id)
    return c.json({ ok:true })
  })
  app.put('/api/memberships/:id', async c => {
    const user=c.get('principal')!, id=c.req.param('id')
    if (!user.workspaceId || (!user.superAdmin && user.role!=='brand-admin')) return c.json({ error:'forbidden' },403)
    const { role }=z.object({ role:z.enum(roles).nullable() }).parse(await jsonBody(c.req.raw))
    const target=await c.env.DB.prepare('SELECT super_admin FROM accounts WHERE id=?').bind(id).first<{ super_admin:number }>()
    if (!target || (!user.superAdmin && (target.super_admin || id===user.id))) return c.json({ error:'forbidden' },403)
    if (role) await c.env.DB.prepare('INSERT INTO memberships VALUES (?,?,?) ON CONFLICT(account_id,brand_id) DO UPDATE SET role=excluded.role').bind(id,user.workspaceId,role).run()
    else await c.env.DB.prepare('DELETE FROM memberships WHERE account_id=? AND brand_id=?').bind(id,user.workspaceId).run()
    // Permissions are resolved from membership on every request, not cached in the cookie.
    await audit(c.env.DB,user.id,'membership.update',id,user.workspaceId)
    return c.json({ ok:true })
  })
  app.post('/api/accounts/:id/revoke', async c => {
    const user=c.get('principal')!,id=c.req.param('id')
    if (!user.superAdmin && user.id!==id) return c.json({ error:'forbidden' },403)
    await c.env.DB.batch([c.env.DB.prepare('UPDATE accounts SET auth_version=auth_version+1 WHERE id=?').bind(id),c.env.DB.prepare('DELETE FROM account_sessions WHERE account_id=?').bind(id)])
    await audit(c.env.DB,user.id,'session.revoke',id)
    return c.json({ ok:true })
  })
  app.get('/api/analytics', async c => {
    const brand=c.get('workspaceId')
    return c.json({ workspaces:await workspaces(c.env.DB,c.get('principal')!),channels:(await c.env.DB.prepare(
      'SELECT channel_id,day,calls,neurons FROM channel_usage WHERE brand_id=? AND day>=date(\'now\',\'-6 days\') ORDER BY day DESC').bind(brand).all()).results,
      limits:await c.env.DB.prepare('SELECT calls,neurons FROM platform_limits WHERE id=1').first() })
  })
}
