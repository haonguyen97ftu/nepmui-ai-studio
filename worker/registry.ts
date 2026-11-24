import type { Hono } from 'hono'
import { z } from 'zod'
import { contracts } from './contracts'
import { models } from '../shared/models'
import { audit, currentActor } from './accounts'
import { bodyBytes, jsonBody } from './security'
import { studio } from './store'
import type { Env, Variables } from './index'

export const agentConfig=z.object({ persona:contracts.persona.partial().optional(),model:z.enum(models).optional() }).strict()
const channelInput=z.object({ name:z.string().trim().min(1).max(80),kind:z.enum(['messenger','instagram','website']),
  externalId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),mock:z.boolean().default(true),paused:z.boolean().default(true),
  state:z.enum(['connected','disconnected']).default('connected'),agentId:z.uuid().nullable().default(null),
  overrides:agentConfig.default({}),accessToken:z.string().min(1).max(4096).optional() }).strict()
export type Connection={ id:string;brand_id:string;kind:'messenger'|'instagram'|'website';external_id:string;name:string;
  state:'connected'|'disconnected';paused:number;mock:number;token_cipher:string|null;agent_id:string|null;overrides:string;version:number;verified:number }
const encoder=new TextEncoder()
function bytes64(value:Uint8Array) { return btoa(String.fromCharCode(...value)) }
function from64(value:string) { return Uint8Array.from(atob(value),char=>char.charCodeAt(0)) }
async function encryptionKey(secret:string|undefined) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error('encryption_unavailable')
  return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!,part=>parseInt(part,16)),'AES-GCM',false,['encrypt','decrypt'])
}
export async function encryptToken(secret:string|undefined,value:string,scope:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey(secret)
  const cipher=await crypto.subtle.encrypt({ name:'AES-GCM',iv,additionalData:encoder.encode(scope) },key,encoder.encode(value))
  return JSON.stringify({ v:1,iv:bytes64(iv),cipher:bytes64(new Uint8Array(cipher)) })
}
export async function decryptToken(secret:string|undefined,value:string,scope:string) {
  const envelope=z.object({ v:z.literal(1),iv:z.string(),cipher:z.string() }).parse(JSON.parse(value))
  const clear=await crypto.subtle.decrypt({ name:'AES-GCM',iv:from64(envelope.iv),additionalData:encoder.encode(scope) },await encryptionKey(secret),from64(envelope.cipher))
  return new TextDecoder().decode(clear)
}
export const tokenScope=(connection:Pick<Connection,'brand_id'|'id'|'external_id'>)=>`${connection.brand_id}:${connection.id}:${connection.external_id}`
export async function connection(db:D1Database,brand:string,id:string) {
  return db.prepare('SELECT * FROM channels WHERE brand_id=? AND id=?').bind(brand,id).first<Connection>()
}
export async function engineStore(db:D1Database,brand:string,channelId?:string,agentId?:string,authorization?:{sql:string;bindings:(string|null)[]}) {
  const base=studio(db,brand)
  const channel=channelId ? await connection(db,brand,channelId) : undefined
  if (channelId && !channel) throw new RangeError('context_missing')
  const selected=agentId??channel?.agent_id
  const agent=selected ? await db.prepare('SELECT config FROM agents WHERE brand_id=? AND id=?').bind(brand,selected).first<{ config:string }>() : undefined
  if (selected && !agent) throw new RangeError('context_missing')
  const defaults=agent ? agentConfig.parse(JSON.parse(agent.config)) : {}
  const overrides=channel ? agentConfig.parse(JSON.parse(channel.overrides)) : {}
  const persona={ ...await base.setting('persona'),...defaults.persona,...overrides.persona }
  return studio(db,brand,{ channelId:channel?.id,persona,authorization,model:overrides.model??defaults.model })
}
export async function verifyPageOwnership(env:Env,registered:Connection,fetcher=fetch) {
  if (registered.mock || registered.kind!=='messenger' || !registered.token_cipher || !/^v\d{1,2}\.0$/.test(env.META_GRAPH_VERSION??'')) return false
  try {
    const token=await decryptToken(env.CHANNEL_ENCRYPTION_KEY,registered.token_cipher,tokenScope(registered))
    const response=await fetcher(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/me?fields=id`,{
      headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000),
    })
    if (!response.ok) { await response.body?.cancel();return false }
    const payload=z.object({id:z.string().regex(/^\d{1,32}$/)}).parse(JSON.parse(new TextDecoder().decode(await bodyBytes(response,4000))))
    return payload.id===registered.external_id
  } catch { return false }
}
export function registryRoutes(app:Hono<{ Bindings:Env;Variables:Variables }>) {
  app.get('/api/agents',async c=>c.json({ items:(await c.env.DB.prepare('SELECT id,name,config,version FROM agents WHERE brand_id=? ORDER BY name LIMIT 100').bind(c.get('workspaceId')).all()).results.map(row=>({ ...row,config:JSON.parse(String(row.config)) })) }))
  app.post('/api/agents',async c=>{
    const input=z.object({ name:z.string().trim().min(1).max(80),config:agentConfig }).parse(await jsonBody(c.req.raw))
    const id=crypto.randomUUID()
    const actor=currentActor(c.get('principal')!,c.get('demo'),'ai-trainer',c.get('workspaceId'))
    const created=await c.env.DB.prepare(`INSERT INTO agents SELECT ?,?,?,?,1 WHERE ${actor.sql} RETURNING id`)
      .bind(c.get('workspaceId'),id,input.name,JSON.stringify(input.config),...actor.bindings).first()
    return created ? c.json({ id },201) : c.json({error:'forbidden'},403)
  })
  app.put('/api/agents/:id',async c=>{
    const input=z.object({ name:z.string().trim().min(1).max(80),config:agentConfig,version:z.number().int().positive() }).parse(await jsonBody(c.req.raw))
    const actor=currentActor(c.get('principal')!,c.get('demo'),'ai-trainer',c.get('workspaceId'))
    const result=await c.env.DB.prepare(`UPDATE agents SET name=?,config=?,version=version+1 WHERE brand_id=? AND id=? AND version=? AND ${actor.sql} RETURNING id`)
      .bind(input.name,JSON.stringify(input.config),c.get('workspaceId'),c.req.param('id'),input.version,...actor.bindings).first()
    return result ? c.json({ ok:true }) : c.json({ error:'conflict' },409)
  })
  app.get('/api/channels',async c=>{
    const rows=await c.env.DB.prepare(`SELECT id,kind,external_id,name,state,paused,mock,agent_id,overrides,version,last_event,verified,
      CASE WHEN token_cipher IS NULL THEN 0 ELSE 1 END hasToken,
      (SELECT count(*) FROM messenger_outbox o WHERE o.brand_id=channels.brand_id AND o.connection_id=channels.id AND o.state IN ('queued','retry','working','sending')) pending,
      (SELECT count(*) FROM messenger_outbox o WHERE o.brand_id=channels.brand_id AND o.connection_id=channels.id AND o.state IN ('unknown','failed')) attention
      FROM channels WHERE brand_id=? ORDER BY name LIMIT 100`).bind(c.get('workspaceId')).all()
    return c.json({ items:rows.results.map(row=>({ ...row,overrides:JSON.parse(String(row.overrides)) })),
      encryptionReady:!!c.env.CHANNEL_ENCRYPTION_KEY,liveEnabled:c.env.STUDIO_ENV!=='staging' && c.env.MESSENGER_INGEST==='true' })
  })
  app.post('/api/channels',async c=>{
    const input=channelInput.parse(await jsonBody(c.req.raw)),brand=c.get('workspaceId'),id=crypto.randomUUID()
    if (!input.mock && !c.get('principal')?.superAdmin) return c.json({error:'forbidden'},403)
    if (!input.mock && !input.paused) return c.json({error:'channel_unverified'},409)
    if (input.kind==='messenger' && !/^\d{1,32}$/.test(input.externalId)) return c.json({ error:'invalid_input' },400)
    if (input.agentId && !await c.env.DB.prepare('SELECT 1 FROM agents WHERE brand_id=? AND id=?').bind(brand,input.agentId).first()) return c.json({ error:'missing' },404)
    if (await c.env.DB.prepare('SELECT 1 FROM channels WHERE kind=? AND external_id=? AND mock=? AND (?=0 OR brand_id=?)').bind(input.kind,input.externalId,Number(input.mock),Number(input.mock),brand).first()) return c.json({ error:'conflict' },409)
    if (input.accessToken && !c.env.CHANNEL_ENCRYPTION_KEY) return c.json({ error:'encryption_unavailable' },409)
    const cipher=input.accessToken ? await encryptToken(c.env.CHANNEL_ENCRYPTION_KEY,input.accessToken,tokenScope({ brand_id:brand,id,external_id:input.externalId })) : null
    const actor=currentActor(c.get('principal')!,c.get('demo'),input.mock ? 'brand-admin' : 'super-admin',brand)
    const created=await c.env.DB.prepare(`INSERT INTO channels(id,brand_id,kind,external_id,name,state,paused,mock,token_cipher,agent_id,overrides)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.sql} RETURNING id`)
      .bind(id,brand,input.kind,input.externalId,input.name,input.state,Number(input.paused),Number(input.mock),cipher,input.agentId,JSON.stringify(input.overrides),...actor.bindings).first()
    return created ? c.json({ id },201) : c.json({error:'forbidden'},403)
  })
  app.put('/api/channels/:id',async c=>{
    const input=channelInput.extend({ version:z.number().int().positive() }).parse(await jsonBody(c.req.raw)),brand=c.get('workspaceId'),id=c.req.param('id')
    const current=await connection(c.env.DB,brand,id)
    if (!current) return c.json({ error:'missing' },404)
    if (!!current.mock!==input.mock && !c.get('principal')?.superAdmin) return c.json({error:'forbidden'},403)
    if (current.kind!==input.kind || current.external_id!==input.externalId) return c.json({ error:'invalid_input' },400)
    if (input.agentId && !await c.env.DB.prepare('SELECT 1 FROM agents WHERE brand_id=? AND id=?').bind(brand,input.agentId).first()) return c.json({ error:'missing' },404)
    if (input.accessToken && !c.env.CHANNEL_ENCRYPTION_KEY) return c.json({ error:'encryption_unavailable' },409)
    const cipher=input.state==='disconnected' ? null : input.accessToken ? await encryptToken(c.env.CHANNEL_ENCRYPTION_KEY,input.accessToken,tokenScope(current)) : current.token_cipher
    const verified=input.mock || input.accessToken || current.state!==input.state || !!current.mock!==input.mock ? 0 : current.verified
    if (!input.mock && !input.paused && !verified) return c.json({error:'channel_unverified'},409)
    const actor=currentActor(c.get('principal')!,c.get('demo'),!!current.mock===input.mock ? 'brand-admin' : 'super-admin',brand)
    const result=await c.env.DB.prepare(`UPDATE channels SET name=?,state=?,paused=?,mock=?,token_cipher=?,agent_id=?,overrides=?,verified=?,version=version+1
      WHERE brand_id=? AND id=? AND version=? AND ${actor.sql} RETURNING id`)
      .bind(input.name,input.state,Number(input.paused),Number(input.mock),cipher,input.agentId,JSON.stringify(input.overrides),verified,brand,id,input.version,...actor.bindings).first()
    if (!result) return c.json({ error:'conflict' },409)
    await audit(c.env.DB,c.get('principal')!.id,input.state==='disconnected' ? 'channel.disconnect' : 'channel.update',id,brand)
    return c.json({ ok:true })
  })
  app.post('/api/channels/:id/verify',async c=>{
    if (!c.get('principal')?.superAdmin) return c.json({error:'forbidden'},403)
    const registered=await connection(c.env.DB,c.get('workspaceId'),c.req.param('id'))
    if (!registered) return c.json({error:'missing'},404)
    // Verification is a read-only Meta identity request; it never enables ingress or sends messages.
    if (!await verifyPageOwnership(c.env,registered)) return c.json({error:'channel_unverified'},409)
    const actor=currentActor(c.get('principal')!,c.get('demo'),'super-admin',registered.brand_id)
    const row=await c.env.DB.prepare(`UPDATE channels SET verified=1,version=version+1
      WHERE brand_id=? AND id=? AND version=? AND state='connected' AND ${actor.sql} RETURNING id`)
      .bind(registered.brand_id,registered.id,registered.version,...actor.bindings).first()
    return row ? c.json({ok:true}) : c.json({error:'conflict'},409)
  })

}
