import {readFile} from 'node:fs/promises'
import {Hono} from 'hono'
import {platformRoutes} from '../worker/platform'
import type {Env,Variables} from '../worker/index'
import { expect,it } from 'vitest'
import {runtime} from '../scripts/runtime.mjs'

const secret='synthetic-bootstrap-hotfix-secret-only',pepper='e'.repeat(64)
const founder={name:'Synthetic Founder',email:'founder-hotfix@example.test',password:'Synthetic-founder-password-041!'}
const normal={name:'Synthetic Viewer',email:'viewer-hotfix@example.test',password:'Synthetic-viewer-password-041!',role:'viewer'}
const origin='https://bootstrap.example.test'
async function unclaimed() {
  const instance=await runtime({ADMIN_SECRET:secret,AUTH_PEPPER:pepper})
  const request=(path:string,method='GET',data?:unknown,cookie='')=>instance.app.dispatchFetch(origin+'/api/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})
  const login=await request('session','POST',{token:secret})
  expect(login.status).toBe(200)
  const legacy=login.headers.get('set-cookie')!.split(';')[0]
  return {...instance,request,legacy}
}
it('rejects normal account creation from a legacy session before founder claim',async()=>{
  const test=await unclaimed()
  try {
    expect((await test.request('accounts','POST',normal,test.legacy)).status).toBe(403)
    expect(await test.db.prepare('SELECT 1 FROM accounts').first()).toBeNull()
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(201)
  } finally {await test.app.dispose()}
})

it.each([
  ['accounts','GET'],['accounts','POST'],['platform','GET'],['platform/limits','PUT'],
  ['workspaces','GET'],['workspaces','POST'],['knowledge','GET'],['playground','POST'],
  ['agents','POST'],['channels','POST'],['memberships/fake','PUT'],['bootstrap','GET'],['bootstrap/extra','POST'],['session','PUT'],
])('denies legacy management request %s %s without creating account state',async(path,method)=>{
  const test=await unclaimed()
  try {
    expect((await test.request(path,method,method==='GET'?undefined:{...normal,superAdmin:true},test.legacy)).status).toBe(403)
    expect(await test.db.prepare('SELECT 1 FROM accounts').first()).toBeNull()
    const session=await (await test.request('session','GET',undefined,test.legacy)).json() as {authenticated:boolean;bootstrapRequired:boolean;user:{role:string;superAdmin:boolean};brand?:unknown}
    expect(session).toMatchObject({authenticated:true,bootstrapRequired:true,user:{role:'bootstrap',superAdmin:false}})
    expect(session.brand).toBeUndefined()
  } finally {await test.app.dispose()}
})

it('allows setup session revocation and new setup login without granting management rights',async()=>{
  const test=await unclaimed()
  try {
    expect((await test.request('session','DELETE',undefined,test.legacy)).status).toBe(200)
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(401)
    const next=await test.request('session','POST',{token:secret})
    expect(next.status).toBe(200)
    const cookie=next.headers.get('set-cookie')!.split(';')[0]
    expect((await test.request('accounts','POST',{...normal,superAdmin:true},cookie)).status).toBe(403)
    expect((await test.request('bootstrap','POST',founder,cookie)).status).toBe(201)
  } finally {await test.app.dispose()}
})

it('serializes competing founder claims and rejects concurrent legacy account creation',async()=>{
  const test=await unclaimed()
  try {
    const results=await Promise.all([
      test.request('bootstrap','POST',founder,test.legacy),
      test.request('bootstrap','POST',{...founder,email:'second-founder@example.test'},test.legacy),
      ...[false,true,false,true].map((superAdmin,index)=>test.request('accounts','POST',{...normal,email:`concurrent-${index}@example.test`,superAdmin},test.legacy)),
    ])
    expect(results.slice(0,2).filter(r=>r.status===201)).toHaveLength(1)
    expect(results.slice(0,2).filter(r=>[401,409].includes(r.status))).toHaveLength(1)
    expect(results.slice(2).every(r=>[401,403].includes(r.status))).toBe(true)
    const rows=await test.db.prepare('SELECT active,super_admin FROM accounts').all<{active:number;super_admin:number}>()
    expect(rows.results).toEqual([{active:1,super_admin:1}])
    expect((await test.request('session','GET',undefined,test.legacy)).status).toBe(200)
    expect(await (await test.request('session','GET',undefined,test.legacy)).json()).toMatchObject({authenticated:false})
    expect((await test.request('accounts','POST',normal,test.legacy)).status).toBe(401)
  } finally {await test.app.dispose()}
})

it('leaves bootstrap retryable when account insertion is interrupted',async()=>{
  const test=await unclaimed()
  try {
    await test.db.prepare("CREATE TRIGGER synthetic_interrupt_account BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END").run()
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(500)
    expect(await test.db.prepare('SELECT 1 FROM accounts').first()).toBeNull()
    expect(await (await test.request('session','GET',undefined,test.legacy)).json()).toMatchObject({authenticated:true,bootstrapRequired:true})
    await test.db.prepare('DROP TRIGGER synthetic_interrupt_account').run()
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(201)
  } finally {await test.app.dispose()}
})

it('preserves account login after founder commit even when bootstrap session delivery is interrupted',async()=>{
  const test=await unclaimed()
  try {
    await test.db.prepare("CREATE TRIGGER synthetic_interrupt_session BEFORE INSERT ON account_sessions BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END").run()
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(500)
    expect(await test.db.prepare('SELECT active,super_admin FROM accounts').first()).toEqual({active:1,super_admin:1})
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(401)
    expect((await test.request('accounts','POST',normal,test.legacy)).status).toBe(401)
    await test.db.prepare('DROP TRIGGER synthetic_interrupt_session').run()
    const login=await test.request('session','POST',{email:founder.email,password:founder.password})
    expect(login.status).toBe(200)
    const accountCookie=login.headers.get('set-cookie')!.split(';')[0]
    expect((await test.request('accounts','POST',normal,accountCookie)).status).toBe(201)
    expect(await test.db.prepare('SELECT count(*) count FROM accounts WHERE active=1 AND super_admin=1').first()).toEqual({count:1})
  } finally {await test.app.dispose()}
})

it('enforces the active founder invariant for direct inserts, updates, replacement and deletion',async()=>{
  const test=await unclaimed()
  const insert=(id:string,email:string,active:number,admin:number,verb='INSERT')=>test.db.prepare(`${verb} INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES (?,?,'Synthetic DB fixture','synthetic-hash','synthetic-salt',?,?,1)`).bind(id,email,active,admin).run()
  try {
    for (const [active,admin] of [[1,0],[0,0],[0,1]]) await expect(insert('normal','db-normal@example.test',active,admin)).rejects.toThrow(/active_founder_required/)
    expect(await test.db.prepare('SELECT 1 FROM accounts').first()).toBeNull()
    await insert('founder','db-founder@example.test',1,1)
    await insert('normal','db-normal@example.test',1,0)
    await expect(insert('founder','replacement@example.test',1,0,'INSERT OR REPLACE')).rejects.toThrow(/active_founder_required/)
    await expect(insert('replacement','DB-FOUNDER@example.test',1,0,'INSERT OR REPLACE')).rejects.toThrow(/active_founder_required/)
    await expect(test.db.prepare("UPDATE OR REPLACE accounts SET email='DB-FOUNDER@example.test' WHERE id='normal'").run()).rejects.toThrow(/active_founder_required/)
    await expect(test.db.prepare("UPDATE accounts SET super_admin=0 WHERE id='founder'").run()).rejects.toThrow()
    await expect(test.db.prepare("UPDATE accounts SET active=0 WHERE id='founder'").run()).rejects.toThrow()
    await expect(test.db.prepare("DELETE FROM accounts WHERE id='founder'").run()).rejects.toThrow(/active_founder_required/)
    expect(await test.db.prepare('SELECT count(*) count FROM accounts WHERE active=1 AND super_admin=1').first()).toEqual({count:1})
    await insert('second','second-db-founder@example.test',1,1)
    await expect(test.db.prepare("UPDATE accounts SET super_admin=0 WHERE super_admin=1").run()).rejects.toThrow()
    expect(await test.db.prepare('SELECT count(*) count FROM accounts WHERE active=1 AND super_admin=1').first()).toEqual({count:2})
    await test.db.prepare("DELETE FROM accounts WHERE id='second'").run()
    expect(await test.db.prepare('SELECT count(*) count FROM accounts WHERE active=1 AND super_admin=1').first()).toEqual({count:1})
  } finally {await test.app.dispose()}
})

it('rejects a stale privileged legacy snapshot at the account handler after a founder has claimed',async()=>{
  const test=await unclaimed()
  try {
    expect((await test.request('bootstrap','POST',founder,test.legacy)).status).toBe(201)
    const env=await test.app.getBindings<Env>()
    const isolated=new Hono<{Bindings:Env;Variables:Variables}>()
    isolated.use('*',async(c,next)=>{
      // Simulate an already admitted pre-fix principal, independently of middleware.
      c.set('principal',{id:'bootstrap',email:'',legacy:true,superAdmin:true,role:'super-admin',workspaceId:'nepmui'})
      c.set('workspaceId','nepmui');c.set('demo',false)
      await next()
    })
    platformRoutes(isolated)
    const response=await isolated.request(origin+'/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...normal,superAdmin:true})},env)
    expect(response.status).toBe(403)
    expect(await test.db.prepare('SELECT count(*) count FROM accounts').first()).toEqual({count:1})
  } finally {await test.app.dispose()}
})

it('refuses an unsafe predecessor database without promoting or deleting its existing normal account',async()=>{
  const test=await runtime({},0,()=>{},3)
  try {
    await test.db.prepare("INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES ('unsafe','unsafe@example.test','Synthetic old account','synthetic-hash','synthetic-salt',1,0,1)").run()
    const before=(await test.db.prepare('SELECT * FROM accounts').all()).results
    const sql=await readFile(new URL('../migrations/0004_founder_invariant.sql',import.meta.url),'utf8')
    await expect(test.db.batch(sql.split(/^-- studio-statement$/m).filter(part=>part.trim()).map(part=>test.db.prepare(part)))).rejects.toThrow()
    expect((await test.db.prepare('SELECT * FROM accounts').all()).results).toEqual(before)
    expect(await test.db.prepare("SELECT 1 FROM sqlite_master WHERE name='founder_invariant_check'").first()).toBeNull()
  } finally {await test.app.dispose()}
})
