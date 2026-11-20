import type { Miniflare } from 'miniflare'
export function runtime(bindings?: Record<string, string>, port?: number, initialization?: (db: Awaited<ReturnType<Miniflare['getD1Database']>>) => void | Promise<void>, migrationLimit?: number): Promise<{
  app: Miniflare
  db: Awaited<ReturnType<Miniflare['getD1Database']>>
  url: URL
}>
