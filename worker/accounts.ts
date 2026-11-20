import { z } from 'zod'
import { authorized, equalSecret, hex, sessionAge } from './security'
import { revoked } from './privacy'
import type { Env } from './index'

export const roles = ['brand-admin', 'ai-trainer', 'customer-service', 'viewer'] as const
export type Role = typeof roles[number] | 'super-admin'
export type Principal = { id: string; email: string; role: Role; superAdmin: boolean; workspaceId: string | null; hash?: string; legacy?: boolean }
export const legacyWorkspace = 'nepmui'
export const credentials = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(12).max(128) })
const encoder = new TextEncoder()
export async function digest(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}
export async function passwordHash(password: string, salt: string, pepper: string) {
  const pepperKey=await crypto.subtle.importKey('raw',encoder.encode(pepper),{ name:'HMAC',hash:'SHA-256' },false,['sign'])
  const material=await crypto.subtle.sign('HMAC',pepperKey,encoder.encode(password))
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits'])
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: encoder.encode(salt) }, key, 256)))
}
export async function accountPassword(password: string, pepper: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, hash: await passwordHash(password, salt, pepper) }
}
export async function accountsExist(db: D1Database) { return !!await db.prepare('SELECT 1 FROM accounts LIMIT 1').first() }
export async function audit(db: D1Database, actor: string, action: string, target: string, workspace: string | null = null) {
  await db.prepare('INSERT INTO platform_audit VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), workspace, actor, action, target, Date.now()).run()
}
export async function createSession(db: D1Database, accountId: string, workspace: string | null, expectedVersion?:number) {
  const token=hex(crypto.getRandomValues(new Uint8Array(32)))
  const version=expectedVersion??(await db.prepare('SELECT auth_version FROM accounts WHERE id=? AND active=1').bind(accountId).first<{auth_version:number}>())?.auth_version
  if (version===undefined) return undefined
  const row=await db.prepare(`INSERT INTO account_sessions(token_hash,account_id,brand_id,expires,auth_version)
    SELECT ?,id,?,?,auth_version FROM accounts WHERE id=? AND active=1 AND auth_version=? RETURNING token_hash`)
    .bind(await digest(token),workspace,Date.now()+sessionAge*1000,accountId,version).first()
  return row ? token : undefined
}
export async function workspaceRole(db: D1Database, id: string, workspace: string, superAdmin: boolean): Promise<Role | undefined> {
  if (superAdmin) return await db.prepare('SELECT 1 FROM brands WHERE id=?').bind(workspace).first() ? 'super-admin' : undefined
  return (await db.prepare('SELECT role FROM memberships WHERE account_id=? AND brand_id=?').bind(id,workspace).first<{ role: Role }>())?.role
}
export async function principal(env: Env, token: string | undefined, demo = false): Promise<Principal | undefined> {
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const hash = await digest(token)
    const row = await env.DB.prepare(`SELECT a.id,a.email,a.super_admin,s.brand_id FROM account_sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.token_hash=? AND s.expires>? AND a.active=1 AND s.auth_version=a.auth_version`).bind(hash,Date.now()).first<{ id: string; email: string; super_admin: number; brand_id: string | null }>()
    if (row) {
      const role = row.brand_id ? await workspaceRole(env.DB,row.id,row.brand_id,!!row.super_admin) : undefined
      return { id: row.id, email: row.email, superAdmin: !!row.super_admin, role: role ?? (row.super_admin ? 'super-admin' : 'viewer'), workspaceId: role ? row.brand_id : null, hash }
    }
  }
  if (demo) {
    const founder = await env.DB.prepare('SELECT id,email FROM accounts WHERE super_admin=1 AND active=1 LIMIT 1').first<{ id: string; email: string }>()
    return { id: founder?.id ?? 'demo', email: founder?.email ?? 'demo@example.test', superAdmin: true, role: 'super-admin', workspaceId: legacyWorkspace }
  }
  // The legacy credential is accepted only before the first account is claimed.
  if (!await accountsExist(env.DB) && await authorized(env.ADMIN_SECRET,legacyWorkspace,token) && !await revoked(env.DB,legacyWorkspace,token)) {
    return { id: 'bootstrap', email: '', superAdmin: true, role: 'super-admin', workspaceId: legacyWorkspace, legacy: true }
  }
}
export async function throttle(db: D1Database, secret: string, key: string, max: number) {
  const hmac = await crypto.subtle.importKey('raw',encoder.encode(secret),{ name: 'HMAC', hash: 'SHA-256' },false,['sign'])
  const bucket = hex(new Uint8Array(await crypto.subtle.sign('HMAC',hmac,encoder.encode(key))))
  const now = Date.now()
  return !!await db.prepare(`INSERT INTO platform_login_attempts VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END,
    attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END WHERE expires<=? OR attempts<? RETURNING attempts`)
    .bind(bucket,now+600000,now,now,now,max).first()
}
export const authReady=(env:Env)=>!!env.AUTH_PEPPER && /^[a-f0-9]{64}$/i.test(env.AUTH_PEPPER)
export async function login(env: Env, email: string, password: string) {
  if (!authReady(env)) return undefined
  const account = await env.DB.prepare('SELECT id,password_hash,salt,active,super_admin,auth_version FROM accounts WHERE email=? COLLATE NOCASE')
    .bind(email).first<{ id: string; password_hash: string; salt: string; active: number; super_admin: number; auth_version:number }>()
  const computed = await passwordHash(password,account?.salt ?? '00000000000000000000000000000000',env.AUTH_PEPPER!)
  if (!account || !account.active || !await equalSecret(computed,account.password_hash)) return undefined
  const workspace = account.super_admin
    ? await env.DB.prepare('SELECT id FROM brands WHERE active=1 ORDER BY id=? DESC,id LIMIT 1').bind(legacyWorkspace).first<{ id: string }>()
    : await env.DB.prepare('SELECT b.id FROM brands b JOIN memberships m ON b.id=m.brand_id WHERE m.account_id=? AND b.active=1 ORDER BY b.id LIMIT 1').bind(account.id).first<{ id: string }>()
  return createSession(env.DB,account.id,workspace?.id ?? null,account.auth_version)
}
export function allowed(role: Role, path: string, method: string) {
  if (role === 'super-admin' || role === 'brand-admin') return true
  const read = method === 'GET' || method === 'HEAD'
  const section = path.split('/')[2]
  if (read) {
    if (['workspaces','session','overview','knowledge','products','persona','models','agents','channels','analytics'].includes(section)) return true
    if (section === 'training') return role === 'ai-trainer'
    if (section === 'conversations') return role === 'customer-service'
    return false
  }
  if (section === 'playground') return role !== 'viewer'
  if (section === 'conversations') return role === 'customer-service' && method !== 'DELETE'
  if (['knowledge','training','persona','agents'].includes(section)) return role === 'ai-trainer'
  return false
}
