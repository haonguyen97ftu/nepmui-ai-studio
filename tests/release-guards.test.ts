import {spawnSync} from 'node:child_process'
import {expect,it} from 'vitest'

it.each([
  ['scripts/deploy-staging.mjs','STUDIO_PLATFORM_MIGRATION_READY','approved backup/migration/security'],
  ['scripts/backup-staging.mjs','STUDIO_STAGING_BACKUP_APPROVED','founder approves'],
])('blocks unapproved release operation %s before network access', (script,flag,message)=>{
  const marker='synthetic-credential-that-must-not-appear'
  const result=spawnSync(process.execPath,[script],{cwd:process.cwd(),env:{...process.env,[flag]:'',CLOUDFLARE_API_TOKEN:marker},encoding:'utf8'})
  expect(result.status).toBe(1)
  expect(result.stdout+result.stderr).toContain(message)
  expect(result.stdout+result.stderr).not.toContain(marker)
})

it.each(['0003_platform.sql','0004_founder_invariant.sql'])('rejects stale migration readiness marker %s before reaching deployment configuration',marker=>{
  const result=spawnSync(process.execPath,['scripts/deploy-staging.mjs'],{cwd:process.cwd(),env:{...process.env,STUDIO_PLATFORM_MIGRATION_READY:marker,STUDIO_STAGING_D1_ID:''},encoding:'utf8'})
  expect(result.status).toBe(1)
  expect(result.stdout+result.stderr).toContain('approved backup/migration/security')
  expect(result.stdout+result.stderr).not.toContain('Set STUDIO_STAGING_D1_ID')
})
