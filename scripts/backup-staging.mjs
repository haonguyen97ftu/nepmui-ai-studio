import {mkdtemp,writeFile,chmod} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

// This helper is intentionally not invoked by CI or deploy:staging.
if (process.env.STUDIO_STAGING_BACKUP_APPROVED!=='NM-AI-04') throw new Error('Run only after the founder approves the staging backup/migration release.')
const account=process.env.CLOUDFLARE_ACCOUNT_ID,database=process.env.STUDIO_STAGING_D1_ID,token=process.env.CLOUDFLARE_API_TOKEN
if (!account || !/^[a-f0-9]{32}$/i.test(account) || !database || !/^[a-f0-9-]{36}$/i.test(database) || !token || database===process.env.STUDIO_D1_ID) throw new Error('Private staging account, distinct database ID and scoped Cloudflare token are required.')
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`
async function request(path,body) {
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)})
  if (!response.ok) throw new Error('Staging recovery point request failed (HTTP '+response.status+').')
  const data=await response.json()
  if (!data.success) throw new Error('Staging recovery point request was rejected.')
  return data.result
}
const before=await request('/time_travel/bookmark')
const tables=['brands','records','revisions','usage','deliveries','messenger_outbox','retention']
const counts=await request('/query',{sql:tables.map(table=>`SELECT '${table}' table_name,count(*) rows FROM ${table}`).join(' UNION ALL '),params:[]})
if (!Array.isArray(counts) || counts[0]?.success===false || counts[0]?.results?.length!==tables.length) throw new Error('Staging baseline counts could not be verified.')
const after=await request('/time_travel/bookmark')
if (typeof before.bookmark!=='string' || !before.bookmark || before.bookmark!==after.bookmark) throw new Error('The database changed during backup verification. Quiesce staging writes and request a new recovery point.')
const directory=await mkdtemp(join(tmpdir(),'studio-staging-recovery-'))
await chmod(directory,0o700)
const filename=join(directory,'recovery-point.json')
await writeFile(filename,JSON.stringify({database,account,created:new Date().toISOString(),bookmark:before.bookmark,counts},null,2),{mode:0o600})
console.log('Verified staging recovery point saved privately: '+filename)
console.log('This references D1 Time Travel, not a portable SQL export. Preserve it in approved private storage before migration.')
