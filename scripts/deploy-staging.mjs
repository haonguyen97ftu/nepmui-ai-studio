import { resolve,relative,isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync,statSync } from 'node:fs'

// Schema 0003 must be approved, backed up, applied and checked separately first.
if (process.env.STUDIO_PLATFORM_MIGRATION_READY !== '0003_platform.sql') {
  console.error('Platform staging deploy is gated: complete the approved backup/migration/security runbook first.')
  process.exit(1)
}
const id = process.env.STUDIO_STAGING_D1_ID
const secretFile = process.env.STUDIO_STAGING_SECRETS_FILE
const placeholder = '11111111-1111-4111-8111-111111111111'

if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) ||
  id === placeholder || id.toLowerCase() === process.env.STUDIO_D1_ID?.toLowerCase()) {
  console.error('Set STUDIO_STAGING_D1_ID to the separate staged database UUID.')
  process.exit(1)
}
if (!secretFile) {
  console.error('Set STUDIO_STAGING_SECRETS_FILE to the private staging secret JSON file.')
  process.exit(1)
}
try {
  const privatePath=resolve(secretFile),location=relative(process.cwd(),privatePath)
  if (!isAbsolute(secretFile) || (!location.startsWith('..') && !isAbsolute(location)) || (statSync(privatePath).mode & 0o077)!==0) throw new Error()
  const data = JSON.parse(readFileSync(secretFile, 'utf8'))
  if (typeof data.ADMIN_SECRET!=='string' || typeof data.AUTH_PEPPER!=='string' || Object.keys(data).some(key=>!['ADMIN_SECRET','AUTH_PEPPER','CHANNEL_ENCRYPTION_KEY'].includes(key)) || !/^[a-f\d]{64}$/i.test(data.ADMIN_SECRET) || !/^[a-f\d]{64}$/i.test(data.AUTH_PEPPER) || data.AUTH_PEPPER===data.ADMIN_SECRET ||
    (data.CHANNEL_ENCRYPTION_KEY!==undefined && (typeof data.CHANNEL_ENCRYPTION_KEY!=='string' || !/^[a-f\d]{64}$/i.test(data.CHANNEL_ENCRYPTION_KEY) || [data.ADMIN_SECRET,data.AUTH_PEPPER].includes(data.CHANNEL_ENCRYPTION_KEY)))) throw new Error()
} catch {
  console.error('The mode-0600 JSON file outside the repository must contain distinct ADMIN_SECRET and AUTH_PEPPER, and optionally a distinct CHANNEL_ENCRYPTION_KEY, each 32 random bytes encoded in hex.')
  process.exit(1)
}

const env = { ...process.env }
delete env.AUTH_PEPPER
delete env.CHANNEL_ENCRYPTION_KEY
delete env.ADMIN_SECRET // cf gives inherited variables precedence over the secrets file.
const result = spawnSync('cf', ['deploy', '--mode', 'staging', '--no-provision', '--secrets-file', secretFile], { stdio: 'inherit', env })
process.exit(result.status ?? 1)
