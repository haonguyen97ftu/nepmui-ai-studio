import { getCookie } from 'hono/cookie'

const encoder = new TextEncoder()
export const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
export async function equalSecret(a: string, b: string) {
  const [left, right] = await Promise.all([a, b].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const l = new Uint8Array(left)
  const r = new Uint8Array(right)
  let diff = 0
  for (let i = 0; i < l.length; i++) diff |= l[i] ^ r[i]
  return diff === 0
}

async function signature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))))
}

export const sessionCookie = '__Host-studio'
export const sessionAge = 8 * 60 * 60
export async function newSession(secret: string, brand: string) {
  const expires = Math.floor(Date.now() / 1000) + sessionAge
  const payload = `${expires}.${crypto.randomUUID()}`
  return `${payload}.${await signature(secret, `${brand}:${payload}`)}`
}
export async function authorized(secret: string | undefined, brand: string, value: ReturnType<typeof getCookie> | undefined) {
  if (!secret || secret.length < 32 || typeof value !== 'string') return false
  const parts = /^(\d{10})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(value)
  if (!parts || Number(parts[1]) <= Date.now() / 1000) return false
  return equalSecret(await signature(secret, `${brand}:${parts[1]}.${parts[2]}`), parts[3])
}

export async function bodyBytes(request: Pick<Request,'body'>, limit = 160_000) {
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (!reader) return new Uint8Array()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new RangeError('body_limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
export async function jsonBody(request: Request) {
  return JSON.parse(new TextDecoder().decode(await bodyBytes(request)))
}
