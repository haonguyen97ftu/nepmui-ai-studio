import type { Miniflare } from 'miniflare'
export function runtime(bindings?: Record<string, string>, port?: number): Promise<{
  app: Miniflare
  db: Awaited<ReturnType<Miniflare['getD1Database']>>
  url: URL
}>
