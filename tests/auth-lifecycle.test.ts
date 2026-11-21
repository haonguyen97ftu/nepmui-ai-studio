import { Hono } from 'hono'
import { expect,it } from 'vitest'
import { runtime } from '../scripts/runtime.mjs'
import { principal } from '../worker/accounts'
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
