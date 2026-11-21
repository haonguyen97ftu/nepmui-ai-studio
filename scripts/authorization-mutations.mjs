/** Isolated source mutation experiment. Restores bytes even when a mutant survives. No network. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
const path='worker/http.ts',original=await readFile(path,'utf8')
const authPath='worker/accounts.ts',authOriginal=await readFile(authPath,'utf8')
const mutants=[
 {id:'endpoint-role-guard',from:'if (!permitted(user.role,c.req.method,url.pathname))',to:'if (false)'},
 {id:'knowledge-list-publication',from:"kind==='knowledge' && ['viewer','customer-service'].includes(c.get('principal')!.role) ? 'published'",to:"false ? 'published'"},
 {id:'trainer-current-state',from:"(data.status!=='draft' || ('status' in current.data && current.data.status!=='draft'))",to:"data.status!=='draft'"},
]
mutants.push({id:'current-super-admin-authority',path:authPath,from:"  const privileges = {",to:"  return {sql:'1',bindings:[] as (string|null)[]}\n  const privileges = {",test:'tests/auth-lifecycle.test.ts'})
const results=[]
function run(args){return spawnSync('npm',args,{encoding:'utf8',maxBuffer:4*1024*1024})}
try{
 for(const mutant of mutants){
  const source=mutant.path===authPath?authOriginal:original
  if(!source.includes(mutant.from))throw new Error('mutation anchor missing: '+mutant.id)
  await writeFile(path,original)
  await writeFile(authPath,authOriginal)
  await writeFile(mutant.path??path,source.replace(mutant.from,mutant.to))
  const build=run(['run','build:worker'])
  if(build.status!==0)throw new Error('mutant build failed: '+mutant.id+'\n'+build.stdout+build.stderr)
  const test=run(['exec','--','vitest','run',mutant.test??'tests/authorization-matrix.test.ts'])
  const output=test.stdout+test.stderr
  const killed=test.status!==0 && output.includes('AssertionError')
  results.push({id:mutant.id,killed})
  await mkdir('security-results',{recursive:true})
  await writeFile('security-results/'+mutant.id+'.log',output)
  process.stdout.write(mutant.id+': '+(killed?'killed':'SURVIVED or invalid run')+'\n')
 }
}finally{
 await writeFile(path,original)
 await writeFile(authPath,authOriginal)
 const build=run(['run','build:worker'])
 if(build.status!==0)throw new Error('restored build failed')
 await mkdir('security-results',{recursive:true})
 await writeFile('security-results/authorization-mutations.json',JSON.stringify({results},null,2)+'\n')
}
if(results.length!==mutants.length||results.some(result=>!result.killed))process.exitCode=1
