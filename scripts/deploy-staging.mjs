import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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
  const data = JSON.parse(readFileSync(secretFile, 'utf8'))
  if (Object.keys(data).length !== 1 || !/^[a-f\d]{64}$/i.test(data.ADMIN_SECRET)) throw new Error()
} catch {
  console.error('The private JSON file must contain only ADMIN_SECRET as 32 random bytes encoded in hex.')
  process.exit(1)
}

const env = { ...process.env }
delete env.ADMIN_SECRET // cf gives inherited variables precedence over the secrets file.
const result = spawnSync('cf', ['deploy', '--mode', 'staging', '--no-provision', '--secrets-file', secretFile], { stdio: 'inherit', env })
process.exit(result.status ?? 1)
