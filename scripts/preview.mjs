import { runtime } from './runtime.mjs'
import { seedDemo } from '../tests/fixtures/demo.mjs'

const port = Number(process.env.STUDIO_DEMO_PORT || '4173')
const { app, url } = await runtime({ DEMO: 'loopback' }, port, seedDemo)
console.log(`NẾP MÙI AI Studio · demo · ${url}`)
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await app.dispose()
  process.exit(0)
})
