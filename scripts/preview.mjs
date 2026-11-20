import { runtime } from './runtime.mjs'
import { seedDemo } from '../tests/fixtures/demo.mjs'

const port = Number(process.env.STUDIO_DEMO_PORT || '4173')
const { app, url } = await runtime({ DEMO: 'loopback', ADMIN_SECRET: crypto.randomUUID()+crypto.randomUUID(),AUTH_PEPPER: Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('') }, port, seedDemo)
console.log(`AI Studio · demo · ${url}`)
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await app.dispose()
  process.exit(0)
})
