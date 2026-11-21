import {createSession} from '../worker/accounts'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runtime } from '../scripts/runtime.mjs'
import { studio } from '../worker/store'
import { signPayload, receiveBatch } from '../worker/channels'
import { hex } from '../worker/security'
import { decryptToken,encryptToken,engineStore,tokenScope,verifyPageOwnership } from '../worker/registry'

const origin='https://platform.example.test',secret='synthetic-founder-key-for-platform-tests-only'
const encryption='d'.repeat(64),password='Synthetic-test-password-04!'
let instance:Awaited<ReturnType<typeof runtime>>,owner=''
const workspaces=['nepmui'],pages=new Map<string,{id:string;externalId:string}[]>()
const members=new Map<string,{id:string;cookie:string}>()
function api(path:string,method='GET',payload?:unknown,cookie=owner,headers:Record<string,string>={}) {
  return instance.app.dispatchFetch(origin+'/api/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...headers},body:payload===undefined?undefined:JSON.stringify(payload)})
}
async function login(email:string,pass=password,address='signed-in') {
  const response=await api('session','POST',{email,password:pass},'',{'CF-Connecting-IP':address})
  expect(response.status).toBe(200)
  return response.headers.get('set-cookie')!.split(';')[0]
}
async function select(id:string) { expect((await api('workspaces/'+id+'/switch','POST')).status).toBe(200) }
async function json<T>(response:Awaited<ReturnType<typeof api>>):Promise<T> { return response.json() as Promise<T> }
const synthetic={ title:'Tài liệu định danh riêng',category:'Tổng hợp',body:'Nguồn chỉ thuộc không gian ',status:'published' as const }
beforeAll(async()=>{
  instance=await runtime({ADMIN_SECRET:secret,AUTH_PEPPER:'a'.repeat(64),STUDIO_ENV:'staging',CHANNEL_ENCRYPTION_KEY:encryption,META_APP_SECRET:'synthetic-meta-app-secret',MESSENGER_INGEST:'true',MESSENGER_OUTBOUND:'true'})
  const oldLogin=await api('session','POST',{token:secret},'')
  owner=oldLogin.headers.get('set-cookie')!.split(';')[0]
  const bootstrap=await api('bootstrap','POST',{email:'founder@example.test',name:'Synthetic Founder',password})
  expect(bootstrap.status).toBe(201)
  owner=bootstrap.headers.get('set-cookie')!.split(';')[0]
  for (const name of ['Synthetic Workspace A','Synthetic Workspace B']) {
    const response=await api('workspaces','POST',{name})
    expect(response.status).toBe(201)
    workspaces.push((await json<{id:string}>(response)).id)
  }
  const {DB}=await instance.app.getBindings<{DB:D1Database}>()
  for (const [index,workspace] of workspaces.entries()) {
    await select(workspace)
    const store=studio(DB,workspace)
    await store.create('knowledge',{...synthetic,body:synthetic.body+index},'same-record-id')
    await store.create('products',{title:'Sản phẩm tổng hợp '+index,notes:'Gỗ tổng hợp',price:100000+index,availability:'available',image:''},'same-product-id')
    const connections=[]
    for (let p=0;p<2;p++) {
      const externalId=String(9000+index*10+p)
      const response=await api('channels','POST',{name:'Page '+p,kind:'messenger',externalId,mock:true,paused:false,accessToken:'synthetic-token-'+index+'-'+p})
      expect(response.status).toBe(201)
      connections.push({id:(await json<{id:string}>(response)).id,externalId})
    }
    pages.set(workspace,connections)
  }
  await select(workspaces[1])
  for (const role of ['brand-admin','ai-trainer','customer-service','viewer']) {
    const response=await api('accounts','POST',{email:role+'@example.test',name:role,password,role})
    expect(response.status).toBe(201)
    members.set(role,{id:(await json<{id:string}>(response)).id,cookie:await login(role+'@example.test')})
  }
})
afterAll(async()=>{await instance?.app.dispose()})

describe('account and workspace authorization',()=>{
  it('closes founder bootstrap and invalidates legacy key login after account claim',async()=>{
    expect((await api('session','POST',{token:secret},'',{'CF-Connecting-IP':'legacy-after-claim'})).status).toBe(401)
    expect((await api('bootstrap','POST',{email:'attacker@example.test',name:'No',password})).status).toBe(409)
    const rows=await instance.db.prepare('SELECT email,password_hash,salt FROM accounts').all<{email:string;password_hash:string;salt:string}>()
    expect(rows.results.every(row=>!row.password_hash.includes(password)&&row.salt.length===32)).toBe(true)
    expect(new Set(rows.results.map(row=>row.password_hash)).size).toBe(rows.results.length)
  })
  it('lists only authorized workspaces and rejects switching or spoofed scope',async()=>{
    const viewer=members.get('viewer')!.cookie
    const list=await json<{items:{id:string}[]}>(await api('workspaces','GET',undefined,viewer))
    expect(list.items.map(row=>row.id)).toEqual([workspaces[1]])
    expect((await api('workspaces/'+workspaces[2]+'/switch','POST',undefined,viewer)).status).toBe(403)
    expect((await api('knowledge','GET',undefined,viewer,{'X-Workspace-ID':workspaces[2]})).status).toBe(403)
    expect((await api('knowledge/same-record-id','GET',undefined,viewer)).status).toBe(200)
    const item=await json<{data:{body:string}}>(await api('knowledge/same-record-id','GET',undefined,viewer))
    expect(item.data.body).toBe(synthetic.body+'1')
    expect((await api('platform','GET',undefined,viewer)).status).toBe(403)
    expect((await api('accounts','GET',undefined,viewer)).status).toBe(403)
  })
  it('enforces role permissions and prevents global privilege escalation',async()=>{
    const viewer=members.get('viewer')!.cookie,trainer=members.get('ai-trainer')!.cookie,service=members.get('customer-service')!.cookie,admin=members.get('brand-admin')!.cookie
    expect((await api('knowledge','POST',{...synthetic,status:'draft'},viewer)).status).toBe(403)
    expect((await api('conversations','GET',undefined,viewer)).status).toBe(403)
    const draft=await json<{id:string}>(await api('knowledge','POST',{...synthetic,status:'draft'},trainer))
    expect((await api('knowledge/'+draft.id,'PUT',{version:1,data:{...synthetic,status:'approved'}},trainer)).status).toBe(403)
    expect((await api('models','PUT',{version:0,data:{provider:'mock',model:'bad',dailyLimit:1,dailyNeurons:1}},trainer)).status).toBe(403)
    expect((await api('channels','POST',{},service)).status).toBe(403)
    expect((await api('accounts','POST',{email:'escalation@example.test',name:'No',password,role:'brand-admin',superAdmin:true},admin)).status).toBe(403)
    expect((await api('memberships/'+members.get('viewer')!.id,'PUT',{role:'super-admin'},admin)).status).toBe(400)
    expect((await api('accounts/'+members.get('viewer')!.id,'PUT',{active:true,superAdmin:true},admin)).status).toBe(403)
  })
  it('rejects foreign IDs in channel/agent configuration and workspace mutations',async()=>{
    const admin=members.get('brand-admin')!.cookie
    await select(workspaces[2])
    const agent=await json<{id:string}>(await api('agents','POST',{name:'Foreign',config:{persona:{voice:'Giọng riêng'}}}))
    expect((await api('playground','POST',{question:'Tài liệu định danh riêng',agentId:agent.id},admin)).status).toBe(404)
    expect((await api('playground','POST',{question:'Tài liệu định danh riêng',channelId:pages.get(workspaces[2])![0].id},admin)).status).toBe(404)
    expect((await api('channels','POST',{name:'No',kind:'messenger',externalId:'555555',agentId:agent.id},admin)).status).toBe(404)
    expect((await api('workspaces/'+workspaces[2],'PUT',{name:'Changed',version:1},admin)).status).toBe(403)
    expect((await api('channels/'+pages.get(workspaces[2])![0].id,'PUT',{},admin)).status).toBe(400)
  })
  it('uses current membership on every request and revokes suspended accounts',async()=>{
    await select(workspaces[1])
    const member=members.get('customer-service')!
    expect((await api('conversations','GET',undefined,member.cookie)).status).toBe(200)
    expect((await api('memberships/'+member.id,'PUT',{role:'viewer'})).status).toBe(200)
    expect((await api('conversations','GET',undefined,member.cookie)).status).toBe(403)
    expect((await api('accounts/'+member.id,'PUT',{active:false,superAdmin:false})).status).toBe(200)
    expect((await api('knowledge','GET',undefined,member.cookie)).status).toBe(401)
    expect((await api('accounts/'+member.id,'PUT',{active:true,superAdmin:false})).status).toBe(200)
  })
  it('throttles invalid account logins without leaking account existence',async()=>{
    for (let attempt=0;attempt<5;attempt++) expect((await api('session','POST',{email:'missing@example.test',password},'',{'CF-Connecting-IP':'bruteforce'})).status).toBe(401)
    expect((await api('session','POST',{email:'missing@example.test',password},'',{'CF-Connecting-IP':'bruteforce'})).status).toBe(429)
  })
})

function event(page:string,mid:string,text:string) {
  return {object:'page',entry:[{id:page,messaging:[{timestamp:Date.now(),sender:{id:'209'},recipient:{id:page},message:{mid,text}}]}]}
}
describe('multi-Page routing and credentials',()=>{
  it('isolates identical sender/event IDs across three workspaces and two Pages each',async()=>{
    for (const [index,workspace] of workspaces.entries()) {
      await select(workspace)
      for (const page of pages.get(workspace)!) {
        const payload=event(page.externalId,'identical-event','Tài liệu định danh riêng')
        const first=await json<{accepted:number;sent:number}>(await api('channels/'+page.id+'/mock','POST',payload))
        expect(first).toEqual({accepted:1,duplicate:0,sent:1})
        expect(await json(await api('channels/'+page.id+'/mock','POST',payload))).toEqual({accepted:0,duplicate:1,sent:0})
        const thread='messenger-mock/'+page.id+':209'
        const result=await json<{item:{data:{messages:{text:string}[];channelId:string}}}>(await api('conversations/'+encodeURIComponent(thread)))
        expect(result.item.data.channelId).toBe(page.id)
        expect(result.item.data.messages.at(-1)?.text).toContain(synthetic.body+index)
        for (const other of [0,1,2].filter(i=>i!==index)) expect(result.item.data.messages.at(-1)?.text).not.toContain(synthetic.body+other)
      }
    }
    await select(workspaces[1])
    const foreignThread='messenger-mock/'+pages.get(workspaces[2])![0].id+':209'
    expect((await api('conversations/'+encodeURIComponent(foreignThread))).status).toBe(404)
    expect((await api('conversations/'+encodeURIComponent(foreignThread),'PATCH',{version:1,status:'handover',paused:false})).status).toBe(404)
  })
  it('honors channel pause and keeps human takeover independent per Page',async()=>{
    await select(workspaces[1])
    const first=pages.get(workspaces[1])![0],second=pages.get(workspaces[1])![1]
    const thread='messenger-mock/'+first.id+':209'
    const row=await json<{item:{version:number}}>(await api('conversations/'+encodeURIComponent(thread)))
    expect((await api('conversations/'+encodeURIComponent(thread),'PATCH',{version:row.item.version,status:'handover',paused:true})).status).toBe(200)
    expect((await json<{sent:number}>(await api('channels/'+first.id+'/mock','POST',event(first.externalId,'paused-thread','Tài liệu định danh riêng')))).sent).toBe(0)
    expect((await json<{sent:number}>(await api('channels/'+second.id+'/mock','POST',event(second.externalId,'other-page','Tài liệu định danh riêng')))).sent).toBe(1)
    const list=await json<{items:{id:string;version:number}[]}>(await api('channels'))
    const page=list.items.find(row=>row.id===first.id)!
    expect((await api('channels/'+first.id,'PUT',{name:'Paused',kind:'messenger',externalId:first.externalId,mock:true,paused:true,version:page.version})).status).toBe(200)
    expect((await api('channels/'+first.id+'/mock','POST',event(first.externalId,'channel-paused','Hi'))).status).toBe(409)
  })
  it('never exposes token ciphertext or plaintext in admin responses, audit or bundles',async()=>{
    await select(workspaces[2])
    const list=await json<{items:{hasToken:number;id:string;version:number}[]}>(await api('channels'))
    expect(JSON.stringify(list)).not.toContain('synthetic-token')
    expect(JSON.stringify(list)).not.toContain('token_cipher')
    expect(list.items.every(page=>page.hasToken===1)).toBe(true)
    const raw=await instance.db.prepare('SELECT * FROM channels WHERE id=?').bind(pages.get(workspaces[2])![0].id).first<{id:string;brand_id:string;external_id:string;token_cipher:string}>()
    expect(raw!.token_cipher).not.toContain('synthetic-token')
    expect(await decryptToken(encryption,raw!.token_cipher,tokenScope(raw!))).toBe('synthetic-token-2-0')
    await expect(decryptToken(encryption,raw!.token_cipher,'foreign:'+tokenScope(raw!))).rejects.toThrow()
    expect(JSON.stringify(await json(await api('audit')))).not.toContain('synthetic-token')
    const page=list.items.find(row=>row.id===raw!.id)!
    expect((await api('channels/'+page.id,'PUT',{name:'Disconnected',kind:'messenger',externalId:raw!.external_id,mock:true,paused:true,state:'disconnected',version:page.version})).status).toBe(200)
    expect((await instance.db.prepare('SELECT token_cipher FROM channels WHERE id=?').bind(page.id).first<{token_cipher:string|null}>())?.token_cipher).toBeNull()
  })
  it('keeps live ingress disabled in staging even with flags and a valid signature',async()=>{
    const payload=JSON.stringify(event(pages.get(workspaces[1])![0].externalId,'live','Hi'))
    const bytes=new TextEncoder().encode(payload)
    const response=await instance.app.dispatchFetch(origin+'/api/webhooks/messenger',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+hex(await signPayload('synthetic-meta-app-secret',bytes))},body:payload})
    expect(response.status).toBe(403)
    expect((await api('webhooks/messenger?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=1','GET',undefined,'')).status).toBe(403)
  })
})

describe('shared inference limits and archival',()=>{
  it('atomically reserves workspace and platform limits without resetting historical usage',async()=>{
    const {DB}=await instance.app.getBindings<{DB:D1Database}>()
    const day='2055-04-01'
    await instance.db.prepare('UPDATE platform_limits SET calls=20,neurons=100 WHERE id=1').run()
    const results=await Promise.all(workspaces.flatMap(workspace=>Array.from({length:10},()=>studio(DB,workspace).reserve(day,20,100,10))))
    expect(results.filter(Boolean)).toHaveLength(10)
    const usage=await instance.db.prepare('SELECT brand_id,calls,reserved_neurons FROM usage WHERE day=?').bind(day).all<{brand_id:string;calls:number;reserved_neurons:number}>()
    expect(usage.results.every(row=>row.reserved_neurons<=50)).toBe(true)
    expect(usage.results.reduce((sum,row)=>sum+row.calls,0)).toBe(10)
    expect(await studio(DB,workspaces[0]).reserve(day,20,100,10)).toBe(false)
    expect(await instance.db.prepare('SELECT calls,neurons FROM platform_usage WHERE day=?').bind(day).first()).toEqual({calls:10,neurons:100})
    await instance.db.prepare('UPDATE platform_limits SET calls=100,neurons=8000 WHERE id=1').run()
  })
  it('applies workspace, reusable agent and Page override precedence without mixing sources',async()=>{
    await select(workspaces[1])
    const a=await json<{id:string}>(await api('agents','POST',{name:'Scoped agent',config:{persona:{voice:'Giọng trợ lý',language:'en'}}}))
    const page=pages.get(workspaces[1])![1]
    const row=await instance.db.prepare('SELECT version FROM channels WHERE id=?').bind(page.id).first<{version:number}>()
    expect((await api('channels/'+page.id,'PUT',{name:'Override',kind:'messenger',externalId:page.externalId,mock:true,paused:false,agentId:a.id,overrides:{persona:{voice:'Giọng Page',language:'vi'}},version:row!.version})).status).toBe(200)
    const {DB}=await instance.app.getBindings<{DB:D1Database}>()
    const store=await engineStore(DB,workspaces[1],page.id)
    expect(await store.setting('persona')).toMatchObject({voice:'Giọng Page',language:'vi'})
    expect((await store.retrieve('knowledge','Tài liệu định danh riêng')).map(row=>row.data.body)).toContain(synthetic.body+'1')
    expect((await store.retrieve('knowledge','Tài liệu định danh riêng')).map(row=>row.data.body)).not.toContain(synthetic.body+'2')
  })
  it('archives non-destructively, blocks mutation and AI, then supports reactivation',async()=>{
    const workspace=workspaces[2]
    await select(workspace)
    const existing=await json<{items:{id:string;version:number}[]}>(await api('workspaces'))
    const version=existing.items.find(row=>row.id===workspace)!.version
    expect((await api('workspaces/'+workspace,'PUT',{name:'Synthetic Workspace B',archived:true,version})).status).toBe(200)
    expect((await api('knowledge/same-record-id')).status).toBe(200)
    expect((await api('knowledge','POST',{...synthetic,status:'draft'})).status).toBe(403)
    expect((await api('playground','POST',{question:'Tài liệu định danh riêng'})).status).toBe(403)
    const {DB}=await instance.app.getBindings<{DB:D1Database}>()
    expect(await studio(DB,workspace).reserve('2055-04-02',20,100,1)).toBe(false)
    expect((await api('workspaces/'+workspace,'PUT',{name:'Synthetic Workspace B',active:true,archived:false,version:version+1})).status).toBe(200)
    expect((await api('playground','POST',{question:'Tài liệu định danh riêng'})).status).toBe(200)
  })
})

it('preserves pre-platform records, settings, revisions, usage and pending delivery on disposable D1 migration',async()=>{
  const old=await runtime({ADMIN_SECRET:secret},0,()=>{},2)
  try {
    const store=studio(old.db,'nepmui')
    // Old runtime has no new quota tables; populate its legacy usage directly.
    await store.create('knowledge',synthetic,'preserved')
    await store.create('persona',{prompt:'Legacy prompt',voice:'Legacy voice',rules:'Legacy rules',language:'vi'},'config')
    await old.db.prepare("INSERT INTO usage VALUES ('nepmui','2055-01-01',3,99)").run()
    await old.db.prepare("INSERT INTO records(brand_id,kind,id,data,updated) VALUES ('nepmui','conversations','messenger:209',?,?)").bind(JSON.stringify({title:'Synthetic pending',channel:'messenger',status:'handover',messages:[{role:'user',text:'Synthetic only'}]}),Date.now()).run()
    await old.db.prepare("INSERT INTO deliveries(brand_id,channel,external_id,at,thread_id) VALUES ('nepmui','messenger','legacy-mid',?,'messenger:209')").bind(Date.now()).run()
    await old.db.prepare("INSERT INTO messenger_outbox(brand_id,channel,external_id,thread_id,recipient,question,received,due) VALUES ('nepmui','messenger','legacy-mid','messenger:209','209','Synthetic only',?,?)").bind(Date.now(),Date.now()).run()
    const pending=await old.db.prepare('SELECT brand_id,channel,external_id,thread_id,recipient,question,received,due,state,attempts FROM messenger_outbox').all()
    const before=await old.db.prepare("SELECT * FROM records WHERE brand_id='nepmui' ORDER BY kind,id").all()
    const history=await old.db.prepare('SELECT * FROM revisions ORDER BY id').all()
    const migration=await readFile(new URL('../migrations/0003_platform.sql',import.meta.url),'utf8')
    await old.db.batch(migration.split(/^-- studio-statement$/m).filter(sql=>sql.trim()).map(sql=>old.db.prepare(sql)))
    expect((await old.db.prepare("SELECT * FROM records WHERE brand_id='nepmui' ORDER BY kind,id").all()).results).toEqual(before.results)
    expect((await old.db.prepare('SELECT * FROM revisions ORDER BY id').all()).results).toEqual(history.results)
    expect(await old.db.prepare("SELECT calls,neurons FROM platform_usage WHERE day='2055-01-01'").first()).toEqual({calls:3,neurons:99})
    expect((await old.db.prepare('SELECT brand_id,channel,external_id,thread_id,recipient,question,received,due,state,attempts FROM messenger_outbox').all()).results).toEqual(pending.results)
    expect((await store.retrieve('knowledge',synthetic.title))[0].id).toBe('preserved')
    expect(await old.db.prepare("SELECT name FROM sqlite_master WHERE name='one_active_brand'").first()).toBeNull()
    await old.db.prepare("INSERT INTO brands VALUES ('second','Second synthetic',1)").run()
    expect(await old.db.prepare('PRAGMA foreign_key_check').all()).toMatchObject({results:[]})
  } finally { await old.app.dispose() }
})

it('routes valid signed multi-Page events using the registry, never the runtime brand ID',async()=>{
  const appSecret='synthetic-signed-routing-key'
  const routed=await runtime({ADMIN_SECRET:secret,BRAND_ID:'wrong-runtime-tenant',META_APP_SECRET:appSecret,MESSENGER_INGEST:'true',MESSENGER_OUTBOUND:'false'},0,async db=>{
    await db.prepare('UPDATE replay_policy SET live_not_before=0 WHERE id=1').run()
    await db.batch([
      db.prepare("INSERT INTO brands VALUES ('route-b','Synthetic routing B',1)"),
      db.prepare("INSERT INTO workspace_profiles(brand_id) VALUES ('route-b')"),
      db.prepare("INSERT INTO channels(id,brand_id,kind,external_id,name,mock,paused,verified,token_cipher) VALUES ('signed-a','nepmui','messenger','8100','A',0,0,1,'synthetic-encrypted-fixture')"),
      db.prepare("INSERT INTO channels(id,brand_id,kind,external_id,name,mock,paused,verified,token_cipher) VALUES ('signed-b','route-b','messenger','8200','B',0,0,1,'synthetic-encrypted-fixture')"),
    ])
  })
  try {
    const payload={object:'page',entry:[...event('8100','shared-mid','For A').entry,...event('8200','shared-mid','For B').entry,...event('8300','shared-mid','Unknown').entry]}
    const bytes=new TextEncoder().encode(JSON.stringify(payload))
    const signature='sha256='+hex(await signPayload(appSecret,bytes))
    const deliver=(signatureValue:string)=>routed.app.dispatchFetch(origin+'/api/webhooks/messenger',{method:'POST',headers:{'X-Hub-Signature-256':signatureValue},body:JSON.stringify(payload)})
    expect((await deliver('sha256='+'0'.repeat(64))).status).toBe(403)
    expect((await deliver(signature)).status).toBe(200)
    expect((await deliver(signature)).status).toBe(200)
    const threads=await routed.db.prepare("SELECT brand_id,id,data FROM records WHERE kind='conversations' ORDER BY brand_id").all<{brand_id:string;id:string;data:string}>()
    expect(threads.results).toHaveLength(2)
    for (const row of threads.results) {
      const messages=JSON.parse(row.data).messages
      expect(messages).toHaveLength(1)
      expect(messages[0].text).toBe(row.brand_id==='nepmui'?'For A':'For B')
      expect(row.id).toContain(row.brand_id==='nepmui'?'signed-a':'signed-b')
    }
    expect((await routed.db.prepare('SELECT * FROM messenger_outbox').all()).results).toHaveLength(2)
    await routed.db.prepare("UPDATE channels SET paused=1 WHERE id='signed-a'").run()
    const blocked=event('8100','blocked-after-pause','No processing')
    const raw=JSON.stringify(blocked)
    const response=await routed.app.dispatchFetch(origin+'/api/webhooks/messenger',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+hex(await signPayload(appSecret,new TextEncoder().encode(raw)))},body:raw})
    expect(response.status).toBe(200)
    expect(await routed.db.prepare("SELECT 1 FROM deliveries WHERE external_id='blocked-after-pause'").first()).toBeNull()
  } finally { await routed.app.dispose() }
})

it('changes a member password, revokes copied sessions, and records the actor without credentials',async()=>{
  const member=members.get('viewer')!
  const copied=member.cookie
  const response=await api('account/password','POST',{currentPassword:password,password:'New-synthetic-password-04!'},copied)
  expect(response.status).toBe(200)
  expect((await api('knowledge','GET',undefined,copied)).status).toBe(401)
  const fresh=await login('viewer@example.test','New-synthetic-password-04!','password-check')
  expect((await api('knowledge','GET',undefined,fresh)).status).toBe(200)
  expect((await api('accounts/'+member.id+'/revoke','POST')).status).toBe(200)
  expect((await api('knowledge','GET',undefined,fresh)).status).toBe(401)
  const auditRows=await instance.db.prepare("SELECT * FROM platform_audit WHERE actor=? AND action='account.password'").bind(member.id).all()
  expect(auditRows.results).toHaveLength(1)
  expect(JSON.stringify(auditRows.results)).not.toContain('synthetic-password')
})

it('prevents archived Brand Admin reactivation and applies workspace language to engine defaults',async()=>{
  await select(workspaces[1])
  let workspace=(await json<{items:{id:string;version:number}[]}>(await api('workspaces'))).items.find(w=>w.id===workspaces[1])!
  expect((await api('workspaces/'+workspace.id,'PUT',{name:'Synthetic Workspace A',language:'en',version:workspace.version})).status).toBe(200)
  expect(await (await engineStore(instance.db,workspace.id)).setting('persona')).toMatchObject({language:'en'})
  workspace={...workspace,version:workspace.version+1}
  expect((await api('workspaces/'+workspace.id,'PUT',{name:'Synthetic Workspace A',archived:true,version:workspace.version})).status).toBe(200)
  expect((await api('workspaces/'+workspace.id,'PUT',{name:'Synthetic Workspace A',archived:false,active:true,version:workspace.version+1},members.get('brand-admin')!.cookie)).status).toBe(409)
  expect((await api('accounts','POST',{email:'archived-member@example.test',name:'No',password,role:'viewer'},members.get('brand-admin')!.cookie)).status).toBe(403)
  expect((await instance.db.prepare('SELECT active FROM brands WHERE id=?').bind(workspace.id).first<{active:number}>())?.active).toBe(0)
  expect((await api('workspaces/'+workspace.id,'PUT',{name:'Synthetic Workspace A',language:'vi',active:true,archived:false,version:workspace.version+1})).status).toBe(200)
})

it('separates mock identities from Super Admin verified live Page bindings',async()=>{
  await select(workspaces[1])
  const input={name:'Unverified Page',kind:'messenger',externalId:pages.get(workspaces[1])![0].externalId,mock:false,paused:true,accessToken:'synthetic-ownership-token'}
  expect((await api('channels','POST',input,members.get('brand-admin')!.cookie)).status).toBe(403)
  const created=await api('channels','POST',input)
  expect(created.status).toBe(201) // An existing mock cannot reserve the live identity.
  const {id}=await json<{id:string}>(created)
  expect((await api('channels/'+id,'PUT',{...input,accessToken:undefined,paused:false,version:1})).status).toBe(409)
  expect((await api('channels/'+id+'/verify','POST',undefined,members.get('brand-admin')!.cookie)).status).toBe(403)
  const registered=await instance.db.prepare('SELECT * FROM channels WHERE id=?').bind(id).first<import('../worker/registry').Connection>()
  expect(registered!.verified).toBe(0)
  const env={DB:instance.db,CHANNEL_ENCRYPTION_KEY:encryption,META_GRAPH_VERSION:'v27.0'}
  expect(await verifyPageOwnership(env,registered!,async(_url,init)=>{
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-ownership-token')
    return Response.json({id:registered!.external_id})
  })).toBe(true)
  expect(await verifyPageOwnership(env,registered!,async()=>Response.json({id:'wrong-page'}))).toBe(false)
  const ciphertext=await encryptToken(encryption,'synthetic-extra-token','scope-a')
  await expect(decryptToken(encryption,ciphertext,'scope-b')).rejects.toThrow()
})

it('rechecks Page pause and workspace archive atomically at event admission',async()=>{
  const workspace=workspaces[0],page=pages.get(workspace)![1]
  await instance.db.prepare('UPDATE channels SET paused=1,version=version+1 WHERE id=?').bind(page.id).run()
  const inbound=[{id:'blocked-admission',sender:'209',text:'Synthetic only'}]
  expect(await receiveBatch(instance.db,workspace,'messenger-mock',inbound,true,page.id)).toBe(0)
  await instance.db.prepare('UPDATE channels SET paused=0 WHERE id=?').bind(page.id).run()
  expect(await receiveBatch(instance.db,workspace,'messenger-mock',[{...inbound[0],id:'benign-rename'}],true,page.id)).toBe(1)
  await instance.db.prepare('UPDATE brands SET active=0 WHERE id=?').bind(workspace).run()
  expect(await receiveBatch(instance.db,workspace,'messenger-mock',inbound,true)).toBe(0)
  expect(await instance.db.prepare("SELECT 1 FROM deliveries WHERE external_id='blocked-admission'").first()).toBeNull()
  await instance.db.prepare('UPDATE brands SET active=1 WHERE id=?').bind(workspace).run()
})

it('rejects an in-flight login snapshot after credential/session generation changes',async()=>{
  const id=members.get('ai-trainer')!.id
  const before=await instance.db.prepare('SELECT auth_version FROM accounts WHERE id=?').bind(id).first<{auth_version:number}>()
  expect((await api('accounts/'+id+'/revoke','POST')).status).toBe(200)
  expect(await createSession(instance.db,id,workspaces[1],before!.auth_version)).toBeUndefined()
  const fresh=await login('ai-trainer@example.test',password,'new-generation')
  expect((await api('knowledge','GET',undefined,fresh)).status).toBe(200)
})

it('drains no-connection legacy mock jobs after bootstrap using the bounded scheduler',async()=>{
  await select(workspaces[2])
  const legacy=event('100','legacy-after-bootstrap','Tài liệu định danh riêng')
  // Append three distinct events; the inline drain limit leaves at least one queued.
  const entries=legacy.entry[0].messaging
  legacy.entry[0].messaging=[...entries,...entries.map(e=>({...e,message:{...e.message,mid:'legacy-after-bootstrap-2'}})),...entries.map(e=>({...e,message:{...e.message,mid:'legacy-after-bootstrap-3'}}))]
  expect((await api('integrations/messenger/mock','POST',legacy)).status).toBe(200)
  for (let tick=0;tick<3;tick++) await (await instance.app.getWorker()).scheduled({cron:'*/2 * * * *'})
  const rows=await instance.db.prepare("SELECT state FROM messenger_outbox WHERE brand_id=? AND connection_id IS NULL AND external_id LIKE 'legacy-after-bootstrap%'").bind(workspaces[2]).all<{state:string}>()
  expect(rows.results).toHaveLength(3)
  expect(rows.results.every(row=>row.state==='sent')).toBe(true)
})

it('keeps the founder bootstrap open but refuses account creation without a protected auth pepper',async()=>{
  const incomplete=await runtime({ADMIN_SECRET:secret})
  try {
    const login=await incomplete.app.dispatchFetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:secret})})
    expect(login.status).toBe(200)
    const response=await incomplete.app.dispatchFetch(origin+'/api/bootstrap',{method:'POST',headers:{Origin:origin,Cookie:login.headers.get('set-cookie')!.split(';')[0],'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic Founder',email:'missing-pepper@example.test',password})})
    expect(response.status).toBe(409)
    expect(await incomplete.db.prepare('SELECT 1 FROM accounts').first()).toBeNull()
  } finally {await incomplete.app.dispose()}
})
