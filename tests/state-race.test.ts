import {expect,it,vi} from 'vitest'
import * as stores from '../worker/store'
import {createSession} from '../worker/accounts'
import http from '../worker/http'
import {runtime} from '../scripts/runtime.mjs'
import type {Env} from '../worker/index'

it('binds Trainer edit, delete and restore to the exact state version that was validated',async()=>{
 const test=await runtime()
 try{
  const env=await test.app.getBindings<Env>(),db=env.DB
  for(const [id,superAdmin] of [['race-founder',1],['race-trainer',0]] as const){
   await db.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES(?,?,?,?,?,1,?,?)').bind(id,id+'@example.test','Synthetic','synthetic','synthetic',superAdmin,Date.now()).run()
  }
  await db.prepare("INSERT INTO memberships VALUES('race-trainer','nepmui','ai-trainer')").run()
  const cookie='__Host-studio='+await createSession(db,'race-trainer','nepmui')
  const original=stores.studio,base=original(db,'nepmui')
  const data={title:'Synthetic race',body:'Approved source must survive',category:'Synthetic',status:'draft' as const}
  for(const method of ['PUT','DELETE','RESTORE']){
   const entry=await base.create('knowledge',data)
   const revision=(await base.history(entry.id))[0].id
   let interleaved=false
   const spy=vi.spyOn(stores,'studio').mockImplementation((...args)=>{
    const store=original(...args)
    const get:typeof store.get=async(kind,id)=>{
     const row=await store.get(kind,id)
     if(kind==='knowledge'&&id===entry.id&&!interleaved){
      interleaved=true
      expect(await base.update('knowledge',id,{...data,status:'approved'},1)).toBeTruthy()
     }
     return row
    }
    return {...store,get}
   })
   try{
    const path='/api/knowledge/'+entry.id+(method==='DELETE'?'?version=2':method==='RESTORE'?'/restore':'')
    const response=await http.request('https://race.example.test'+path,{method:method==='RESTORE'?'POST':method,headers:{Origin:'https://race.example.test',Cookie:cookie},body:method==='DELETE'?undefined:JSON.stringify(method==='RESTORE'?{revision,version:2}:{data,version:2})},env)
    expect(interleaved).toBe(true)
    expect(response.status).toBe(409)
    expect(await base.get('knowledge',entry.id)).toMatchObject({version:2,data:{status:'approved'}})
   }finally{spy.mockRestore()}
  }
 }finally{await test.app.dispose()}
})
