import { readdir, lstat, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { privatePath, requireGate } from './governance.mjs'

export async function expireRecovery(directory, now = Date.now()) {
  requireGate((await privatePath(directory)).isDirectory(), 'Private recovery directory is required.')
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{32}\.aes256gcm$/.test(entry.name)) continue
    const path = join(directory, entry.name)
    const file = await lstat(path)
    if (file.isFile() && now - file.mtimeMs >= 6 * 86400000) await unlink(path)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  expireRecovery(process.env.STAGING_RECOVERY_DIR).catch(() => {
    console.error('Recovery retention maintenance failed.')
    process.exitCode = 1
  })
}
