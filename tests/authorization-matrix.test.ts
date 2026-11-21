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
