import { Hono } from 'hono'
import { expect,it } from 'vitest'
import { runtime } from '../scripts/runtime.mjs'
import { currentActor, principal } from '../worker/accounts'
import { receiveBatch } from '../worker/channels'
import http from '../worker/http'
import { deleteThread, purge, retentionDays } from '../worker/privacy'
import { platformRoutes } from '../worker/platform'
import { registryRoutes } from '../worker/registry'
import type { Env,Variables } from '../worker/index'

const origin='https://auth-lifecycle.example.test'
const secret='synthetic-lifecycle-secret-for-disposable-db'
const founder={name:'Synthetic founder',email:'founder@lifecycle.example.test',password:'synthetic-founder-password'}
const account={name:'Synthetic account',email:'account@lifecycle.example.test',password:'synthetic-account-password',role:'viewer'}

async function fixture() {
  const test=await runtime({ADMIN_SECRET:secret,AUTH_PEPPER:'1'.repeat(64)})
  const env=await test.app.getBindings<Env>()
  const api=(path:string,method='GET',cookie='',body?:unknown)=>test.app.dispatchFetch(origin+'/api/'+path,{
    method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
  })
  const legacy=(await api('session','POST','',{token:secret})).headers.get('Set-Cookie')!.split(';')[0]
  const claim=async()=> (await api('bootstrap','POST',legacy,founder)).headers.get('Set-Cookie')!.split(';')[0]
  return {...test,env,api,legacy,claim}
}

function pausedHandler(env:Env,cookie:string,afterAdmission:()=>Promise<unknown>) {
  const app=new Hono<{Bindings:Env;Variables:Variables}>()
  app.use('*',async(c,next)=>{
    const actor=await principal(env,cookie.split('=')[1])
    expect(actor).toBeDefined()
    c.set('principal',actor)
    c.set('workspaceId',actor?.workspaceId??'')
    c.set('demo',false)
    await afterAdmission()
    await next()
  })
  platformRoutes(app)
  registryRoutes(app)
  return (path:string,method:string,body?:unknown)=>app.request(origin+'/api/'+path,{
    method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
  },env)
}

it('rechecks an admitted setup claim after logout',async()=>{
  const test=await fixture()
  try {
    const stale=pausedHandler(test.env,test.legacy,async()=>expect((await test.api('session','DELETE',test.legacy)).status).toBe(200))
    expect((await stale('bootstrap','POST',founder)).status).toBe(409)
    expect(await test.db.prepare('SELECT id FROM accounts').first()).toBeNull()
  } finally {await test.app.dispose()}
})

it('denies an admitted Super Admin account creation after that user is demoted',async()=>{
  const test=await fixture()
  try {
    const foundersCookie=await test.claim()
    const creation=await test.api('accounts','POST',foundersCookie,{...account,superAdmin:true})
    expect(creation.status).toBe(201)
    const {id}=await creation.json() as {id:string}
    const login=await test.api('session','POST','',{email:account.email,password:account.password})
    const cookie=login.headers.get('Set-Cookie')!.split(';')[0]
    const stale=pausedHandler(test.env,cookie,async()=>{
      expect((await test.api('accounts/'+id,'PUT',foundersCookie,{active:true,superAdmin:false})).status).toBe(200)
    })
    expect((await stale('accounts','POST',{...account,email:'new-admin@lifecycle.example.test',superAdmin:true})).status).toBe(403)
    expect(await test.db.prepare('SELECT id FROM accounts WHERE email=?').bind('new-admin@lifecycle.example.test').first()).toBeNull()
  } finally {await test.app.dispose()}
})

it('denies an admitted Brand Admin channel creation after membership removal',async()=>{
  const test=await fixture()
  try {
    const founderCookie=await test.claim()
    const creation=await test.api('accounts','POST',founderCookie,{...account,role:'brand-admin'})
    expect(creation.status).toBe(201)
    const {id}=await creation.json() as {id:string}
    const login=await test.api('session','POST','',{email:account.email,password:account.password})
    const cookie=login.headers.get('Set-Cookie')!.split(';')[0]
    const stale=pausedHandler(test.env,cookie,async()=>expect((await test.api('memberships/'+id,'PUT',founderCookie,{role:null})).status).toBe(200))
    expect((await stale('channels','POST',{kind:'messenger',externalId:'4477',name:'Synthetic mock',state:'connected',mock:true})).status).toBe(403)
    expect(await test.db.prepare('SELECT id FROM channels WHERE external_id=?').bind('4477').first()).toBeNull()
  } finally {await test.app.dispose()}
})

it('lets accounts without workspace membership revoke their own sessions',async()=>{
  const test=await fixture()
  try {
    const founderCookie=await test.claim()
    const creation=await test.api('accounts','POST',founderCookie,account)
    expect(creation.status).toBe(201)
    const {id}=await creation.json() as {id:string}
    expect((await test.api('memberships/'+id,'PUT',founderCookie,{role:null})).status).toBe(200)
    const login=await test.api('session','POST','',{email:account.email,password:account.password})
    const cookie=login.headers.get('Set-Cookie')!.split(';')[0]
    const founderId=(await test.db.prepare('SELECT id FROM accounts WHERE super_admin=1').first<{id:string}>())!.id
    expect((await test.api('accounts/'+founderId+'/revoke','POST',cookie)).status).toBe(403)
    expect((await test.api('accounts/'+id+'/revoke','POST',cookie)).status).toBe(200)
    expect(await (await test.api('session','GET',cookie)).json()).toMatchObject({authenticated:false})
  } finally {await test.app.dispose()}
})

it('rejects Brand Admin provisioning for both globally known and unused emails',async()=>{
  const test=await fixture()
  try {
    const founderCookie=await test.claim()
    const creation=await test.api('accounts','POST',founderCookie,{...account,role:'brand-admin'})
    expect(creation.status).toBe(201)
    const login=await test.api('session','POST','',{email:account.email,password:account.password})
    const cookie=login.headers.get('Set-Cookie')!.split(';')[0]
    for (const email of [founder.email,'unused@lifecycle.example.test']) {
      expect((await test.api('accounts','POST',cookie,{...account,email})).status).toBe(403)
    }
  } finally {await test.app.dispose()}
})

it('rejects a retention change when the Brand Admin loses membership before the write',async()=>{
  const test=await fixture()
  try {
    const founderCookie=await test.claim()
    const creation=await test.api('accounts','POST',founderCookie,{...account,role:'brand-admin'})
    expect(creation.status).toBe(201)
    const {id}=await creation.json() as {id:string}
    const login=await test.api('session','POST','',{email:account.email,password:account.password})
    const cookie=login.headers.get('Set-Cookie')!.split(';')[0]
    const db=test.env.DB
    let changed=false
    const wrapped=Object.create(db) as D1Database
    wrapped.prepare=(sql:string)=>{
      const stmt=db.prepare(sql)
      if (!/^INSERT INTO retention/.test(sql)) return stmt
      const wrappedStmt=Object.create(stmt) as D1PreparedStatement
      wrappedStmt.bind=(...args:unknown[])=>{
        const bound=stmt.bind(...args)
        const wrappedBound=Object.create(bound) as D1PreparedStatement
        wrappedBound.first=async<T>()=>{
          expect((await test.api('memberships/'+id,'PUT',founderCookie,{role:null})).status).toBe(200)
          changed=true
          return bound.first<T>()
        }
        return wrappedBound
      }
      return wrappedStmt
    }
    const response=await http.request(origin+'/api/privacy',{method:'PUT',headers:{Origin:origin,Cookie:cookie},body:JSON.stringify({days:1})},{...test.env,DB:wrapped})
    expect(changed).toBe(true)
    expect(response.status).toBe(403)
    expect(await retentionDays(db,'nepmui')).toBe(30)
  } finally {await test.app.dispose()}
})

it('preserves conversations, queued messages and replay state for an actor revoked after admission',async()=>{
  const test=await fixture()
  try {
    const cookie=await test.claim()
    const user=(await principal(test.env,cookie.split('=')[1]))!
    const actor=currentActor(user,false,'brand-admin','nepmui')
    const event={id:'existing-fixture',sender:'100',text:'Synthetic conversation'}
    expect(await receiveBatch(test.db,'nepmui','messenger-mock',[event],true)).toBe(1)
    await test.db.prepare("UPDATE records SET updated=0 WHERE brand_id='nepmui' AND kind='conversations'").run()
    const stored=await test.db.prepare("SELECT id,version FROM records WHERE kind='conversations'").first<{id:string;version:number}>()
    expect(stored).not.toBeNull()
    expect((await test.api('accounts/'+user.id+'/revoke','POST',cookie)).status).toBe(200)
    expect(await deleteThread(test.db,'nepmui',stored!.id,stored!.version,actor)).toBe(false)
    expect(await purge(test.db,'nepmui',actor)).toBe(0)
    expect(await receiveBatch(test.db,'nepmui','messenger-mock',[{...event,id:'denied-fixture'}],true,undefined,actor)).toBe(0)
    expect(await test.db.prepare("SELECT id FROM records WHERE kind='conversations'").first()).toEqual({id:stored!.id})
    expect(await test.db.prepare('SELECT external_id FROM messenger_outbox').all()).toMatchObject({results:[{external_id:event.id}]})
    expect(await test.db.prepare('SELECT external_id FROM deliveries').all()).toMatchObject({results:[{external_id:event.id}]})
  } finally {await test.app.dispose()}
})
