import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import app,{authorizeRequest} from '../worker/http'
import {Hono} from 'hono'
import type {Env,Variables} from '../worker/index'
import {policies,permitted} from '../worker/permissions'
import {createSession,type Role} from '../worker/accounts'
import {runtime} from '../scripts/runtime.mjs'
import {studio} from '../worker/store'

const roles=['super-admin','brand-admin','ai-trainer','customer-service','viewer','bootstrap','unauthenticated'] as const
const origin='https://matrix.example.test'
let instance:Awaited<ReturnType<typeof runtime>>,env:Env
const guardApp=new Hono<{Bindings:Env;Variables:Variables}>()
guardApp.use('/api/*',authorizeRequest)
guardApp.all('/api/*',c=>c.json({authorized:true}))
const cookies=new Map<string,string>()
const workspace='nepmui'
const data={title:'SYNTHETIC unpublished canary',body:'SYNTHETIC private draft body',category:'Policy',status:'draft' as const}
async function request(path:string,method:string,role:string,payload?:unknown){
 return instance.app.dispatchFetch(origin+path,{method,headers:{Origin:origin,Cookie:cookies.get(role)??'','Content-Type':'application/json'},body:payload===undefined||method==='GET'||method==='HEAD'?undefined:JSON.stringify(payload)})
}
beforeAll(async()=>{
 instance=await runtime({ADMIN_SECRET:'synthetic-matrix-bootstrap-key-04-only',AUTH_PEPPER:'b'.repeat(64),STUDIO_ENV:'staging'})
 env=await instance.app.getBindings<Env>()
 const {DB}=env
 // Seed through the database invariant: first account is always an active Super Admin.
 for(const [i,role] of roles.slice(0,5).entries()){
  const id='matrix-'+role
  await DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,super_admin,active,created) VALUES(?,?,?,?,?,?,1,?)').bind(id,role+'@example.test',role,'synthetic','synthetic',Number(i===0),Date.now()).run()
  await DB.prepare('INSERT INTO memberships(account_id,brand_id,role) VALUES(?,?,?)').bind(id,workspace,i===0?'brand-admin':role).run()
  cookies.set(role,'__Host-studio='+await createSession(DB,id,workspace))
 }
 for(const brand of ['matrix-two','matrix-three']){
  await DB.prepare('INSERT INTO brands(id,name,active) VALUES(?,?,1)').bind(brand,brand).run()
  await studio(DB,brand).create('knowledge',{...data,status:'published'},'foreign')
 }
 const store=studio(DB,workspace)
 for(const state of ['draft','approved','published'] as const) await store.create('knowledge',{...data,status:state},state)
},60000)
afterAll(async()=>{await instance?.app.dispose()})

describe('explicit endpoint permission inventory',()=>{
 it('covers every registered method/path exactly, with no orphan policy',()=>{
  const actual=app.routes.filter(route=>route.method!=='ALL').map(route=>route.method+' '+route.path).sort()
  const expected=policies.map(policy=>policy.method+' '+policy.path).sort()
  expect(new Set(expected).size).toBe(expected.length)
  expect(actual).toEqual(expected)
 })
 it('denies unregistered methods and endpoint suffixes',()=>{
  for(const role of roles){expect(permitted(role as Role,'TRACE','/api/accounts')).toBe(false);expect(permitted(role as Role,'GET','/api/knowledge/x/secrets')).toBe(false)}
 })
 for(const policy of policies){
  describe(policy.id,()=>{
   for(const role of roles){
    it(role+' policy '+(policy.roles.includes(role)?'allow':'deny'),async()=>{
     expect(permitted(role as Role,policy.method,policy.path.replace(/:[^/]+/g,'matrix-id'))).toBe(policy.roles.includes(role))
     if(role!=='bootstrap' && policy.scope!=='integration'){
      const gate=await guardApp.request(origin+policy.path.replace(/:[^/]+/g,'matrix-id'),{method:policy.method,headers:{Origin:origin,Cookie:cookies.get(role)??''}},env)
      expect(gate.status).toBe(policy.roles.includes(role)?200:role==='unauthenticated'?401:403)
     }
     // Exercise actual denial before parsing, lookups, or side effects. Bootstrap is tested in its separate lifecycle suite.
     if(policy.roles.includes(role)||role==='bootstrap'||policy.scope==='integration')return
     const response=await request(policy.path.replace(/:[^/]+/g,'matrix-id'),policy.method,role,{})
     expect(response.status).toBe(role==='unauthenticated'?401:403)
    })
   }
  })
 }
})

describe('knowledge visibility across states and access paths',()=>{
 for(const role of ['viewer','customer-service']){
  it(role+' cannot enumerate drafts through search/pagination/detail/history',async()=>{
   for(const query of ['', '?q=SYNTHETIC','?page=1','?q=private&page=0']){
    const response=await request('/api/knowledge'+query,'GET',role)
    expect(response.status).toBe(200)
    const json=await response.json() as {items:{data:{status:string}}[]}
    expect(json.items.every(item=>item.data.status==='published')).toBe(true)
   }
   for(const state of ['draft','approved','published']){
    expect((await request('/api/knowledge/'+state,'GET',role)).status).toBe(state==='published'?200:404)
    expect((await request('/api/knowledge/'+state+'/history','GET',role)).status).toBe(403)
   }
   for(const id of ['foreign','deleted','unknown'])expect((await request('/api/knowledge/'+id,'GET',role)).status).toBe(404)
   for(const path of ['persona','models','agents','channels','training','accounts','audit','privacy']) expect((await request('/api/'+path,'GET',role)).status).toBe(403)
  })
 }
 for(const state of ['draft','approved','published'] as const){
  it('trainer cannot withdraw/delete/restore '+state+' except owned draft workflow',async()=>{
   const response=await request('/api/knowledge/'+state,'PUT','ai-trainer',{data:{...data,status:'draft'},version:1})
   expect(response.status).toBe(state==='draft'?200:403)
   if(state!=='draft'){
    expect((await request('/api/knowledge/'+state+'?version=1','DELETE','ai-trainer')).status).toBe(403)
    expect((await request('/api/knowledge/'+state+'/restore','POST','ai-trainer',{revision:'synthetic',version:1})).status).toBe(403)
   }
  })
 }
 it('trainer can read all current states but not deleted history',async()=>{
  for(const state of ['draft','approved','published']) expect((await request('/api/knowledge/'+state,'GET','ai-trainer')).status).toBe(200)
  expect((await request('/api/knowledge/deleted/history','GET','ai-trainer')).status).toBe(404)
 })
})

it('filters before pagination, including FTS, and hides retained deleted revisions',async()=>{
 const store=studio(env.DB,workspace)
 for(let i=0;i<51;i++){
  await store.create('knowledge',{...data,title:'PaginationCanary '+i,status:'published'},'page-public-'+i)
  await store.create('knowledge',{...data,title:'PaginationCanary '+i,status:i%2?'draft':'approved'},'page-private-'+i)
 }
 for(const role of ['viewer','customer-service']){
  const first=await (await request('/api/knowledge?q=PaginationCanary&page=0','GET',role)).json() as {items:{id:string}[];more:boolean}
  const second=await (await request('/api/knowledge?q=PaginationCanary&page=1','GET',role)).json() as {items:{id:string}[];more:boolean}
  expect(first.items).toHaveLength(50);expect(first.more).toBe(true)
  expect(second.items).toHaveLength(1);expect(second.more).toBe(false)
  expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(51)
  expect([...first.items,...second.items].every(item=>item.id.startsWith('page-public-'))).toBe(true)
 }
 const deleted=await store.create('knowledge',data,'actually-deleted')
 expect(await store.remove('knowledge',deleted.id,deleted.version)).toBe(true)
 expect((await request('/api/knowledge/actually-deleted/history','GET','ai-trainer')).status).toBe(404)
})

it('does not let a Brand Admin import an account from another tenant by known ID',async()=>{
 await env.DB.prepare("INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES('foreign-user','foreign@example.test','Synthetic','synthetic','synthetic',1,0,?)").bind(Date.now()).run()
 await env.DB.prepare("INSERT INTO memberships VALUES('foreign-user','matrix-two','viewer')").run()
 expect((await request('/api/memberships/foreign-user','PUT','brand-admin',{role:'brand-admin'})).status).toBe(403)
 expect(await env.DB.prepare("SELECT 1 FROM memberships WHERE account_id='foreign-user' AND brand_id='nepmui'").first()).toBeNull()
})

describe('conversation ownership across inbox operations', () => {
 const base = '/api/conversations'
 const owner = 'customer-service'
 const coworker = 'conversation-coworker'
 const outsider = 'conversation-outsider'
 const sample = { title: 'Synthetic conversation', status: 'handover', messages: [
  { role: 'user', text: 'Synthetic customer question' },
  { role: 'assistant', text: 'Synthetic assistant answer', reason: 'grounded', latency: 5 },
 ] } as const

 beforeAll(async () => {
  for (const [id, brand] of [[coworker, workspace], [outsider, 'matrix-two']]) {
   await env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES(?,?,?,?,?,1,0,?)')
    .bind(id, id + '@example.test', id, 'synthetic', 'synthetic', Date.now()).run()
   await env.DB.prepare("INSERT INTO memberships(account_id,brand_id,role) VALUES(?,?,'customer-service')").bind(id, brand).run()
   cookies.set(id, '__Host-studio=' + await createSession(env.DB, id, brand))
  }
  const store = studio(env.DB, workspace)
  const thread = { ...sample, messages: [...sample.messages] }
  await store.create('conversations', { ...thread, channel: 'playground', ownerId: 'matrix-customer-service' }, 'owned-playground')
  await store.create('conversations', { ...thread, channel: 'playground' }, 'legacy-playground')
  await store.create('conversations', { ...thread, channel: 'messenger' }, 'customer-thread')
  await studio(env.DB, 'matrix-two').create('conversations', { ...thread, channel: 'messenger' }, 'foreign-thread')
 })

 const cases = [
  [owner, 'owned-playground', true],
  [coworker, 'owned-playground', false],
  ['brand-admin', 'owned-playground', true],
  ['super-admin', 'owned-playground', true],
  [outsider, 'owned-playground', false],
  [owner, 'legacy-playground', false],
  ['brand-admin', 'legacy-playground', true],
  [coworker, 'customer-thread', true],
  [outsider, 'customer-thread', false],
  ['brand-admin', 'foreign-thread', false],
  [outsider, 'foreign-thread', true],
 ] as const

 it.each(cases)('%s visibility and operations on %s (allowed: %s)', async (role, id, allowed) => {
  const list = await request(base + '?q=Synthetic conversation', 'GET', role)
  expect(list.status).toBe(200)
  expect((await list.json() as { items: { id: string }[] }).items.some(item => item.id === id)).toBe(allowed)
  const detail = await request(base + '/' + id, 'GET', role)
  expect(detail.status).toBe(allowed ? 200 : 404)
  const before = allowed ? (await detail.json() as { item: { version: number; data: { ownerId?: string; messages: unknown[] } } }).item : undefined
  const patched = await request(base + '/' + id, 'PATCH', role, { status: 'handover', reply: 'Synthetic internal note', version: before?.version ?? 1 })
  expect(patched.status).toBe(allowed ? 200 : 404)
  if (before) {
   const saved = await patched.json() as typeof before
   expect(saved.data.ownerId).toBe(before.data.ownerId)
   expect(saved).toMatchObject({ version: before.version + 1, data: {
    messages: [...before.data.messages, { role: 'human', text: 'Synthetic internal note' }],
   } })
   expect((await request(base + '/' + id, 'PATCH', role, { status: 'resolved', version: before.version })).status).toBe(409)
  }
  const count = () => env.DB.prepare("SELECT count(*) AS total FROM records WHERE kind='training'").first('total')
  const prior = Number(await count())
  const training = await request(base + '/' + id + '/training', 'POST', role)
  expect(training.status).toBe(allowed ? 201 : 404)
  expect(await count()).toBe(prior + Number(allowed))
  if (allowed) expect(await training.json()).toMatchObject({ data: { title: 'Synthetic customer question', status: 'draft' } })
 })

 it('counts only visible conversations in dashboard aggregates', async () => {
  for (const [role, total] of [[owner, 1], [coworker, 0], ['brand-admin', 2], [outsider, 0]] as const) {
   const result = await request('/api/overview?mode=test', 'GET', role)
   expect(result.status).toBe(200)
   const overview = await result.json() as { total: number; pending: number; responses: number; series: { total: number }[] }
   expect(overview).toMatchObject({ total, pending: total, responses: total })
   expect(overview.series.reduce((sum, day) => sum + day.total, 0)).toBe(total)
  }
 })

 it('filters interleaved hidden threads before search, mode, status and page boundaries', async () => {
  const entries = Array.from({ length: 51 }, (_, i) => [`visible-${i}`, `hidden-${i}`]).flat()
  const now = Date.now()
  await env.DB.batch(entries.map((id, i) => env.DB.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES(?,'conversations',?,?,?)")
   .bind(workspace, id, JSON.stringify({
    title: 'Synthetic pagination conversation', channel: 'playground',
    ownerId: id.startsWith('visible-') ? 'matrix-customer-service' : coworker,
    status: 'handover', messages: [],
   }), now - i)))
  const query = '?q=Synthetic pagination&mode=test&status=handover&page='
  const expected = entries.filter(id => id.startsWith('visible-'))
  for (const [page, items, more] of [[0, expected.slice(0, 50), true], [1, expected.slice(50), false], [2, [], false]] as const) {
   const result = await request(base + query + page, 'GET', owner)
   expect(result.status).toBe(200)
   const data = await result.json() as { items: { id: string }[]; more: boolean }
   expect(data.items.map(item => item.id)).toEqual(items)
   expect(data.more).toBe(more)
  }
  const empty = await request(base + '?q=Synthetic pagination&mode=live', 'GET', owner)
  expect(await empty.json()).toEqual({ items: [], more: false })
 })

 it('keeps deletion administrator-only and scoped to the selected workspace', async () => {
  await studio(env.DB, workspace).create('conversations', {
   title: 'Synthetic deletion', channel: 'playground', status: 'resolved', messages: [], ownerId: 'matrix-customer-service',
  }, 'delete-playground')
  const path = base + '/delete-playground?version=1'
  expect((await request(path, 'DELETE', owner)).status).toBe(403)
  expect((await request(base + '/foreign-thread?version=1', 'DELETE', 'brand-admin')).status).toBe(409)
  expect((await request(path, 'DELETE', 'brand-admin')).status).toBe(200)
  expect((await request(base + '/delete-playground', 'GET', owner)).status).toBe(404)
  expect((await request(base + '/delete-playground/training', 'POST', 'brand-admin')).status).toBe(404)
 })
})

it('keeps authorized conversation reads available in archived workspaces and blocks writes', async () => {
 const db = env.DB
 const store = studio(db, 'matrix-two')
 const entry = await store.create('conversations', { title: 'Synthetic archived', channel: 'messenger', status: 'handover', messages: [] })
 const url = '/api/conversations/' + entry.id
 await db.prepare("UPDATE brands SET active=0 WHERE id='matrix-two'").run()
 try {
  expect((await request(url, 'GET', 'conversation-outsider')).status).toBe(200)
  expect((await request(url, 'PATCH', 'conversation-outsider', { status: 'resolved', version: entry.version })).status).toBe(403)
  expect((await request(url + '/training', 'POST', 'conversation-outsider')).status).toBe(403)
 } finally {
  await db.prepare("UPDATE brands SET active=1 WHERE id='matrix-two'").run()
 }
})
