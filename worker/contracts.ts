import { z } from 'zod'
import { models } from '../shared/models'

const short = z.string().trim().min(1).max(160)
const text = z.string().trim().min(1).max(4000)
const optional = z.string().trim().max(4000).default('')
const stages = z.enum(['draft', 'approved', 'published'])
export const sourceRef = z.object({ id: short, kind: z.enum(['knowledge','products']), version: z.number().int().positive(), title: short })
const message = z.object({
  role: z.enum(['user', 'assistant', 'human']), text, reason: z.string().max(80).optional(),
  latency: z.number().nonnegative().optional(), provider: z.string().optional(), sources: z.array(sourceRef).max(8).optional(), outboundId: z.string().max(256).optional(),
})
export type SourceRef = z.infer<typeof sourceRef>
export type Message = z.infer<typeof message>
export const contracts = {
  knowledge: z.object({ title: short, category: short, body: text, status: stages }),
  products: z.object({
    title: short, notes: optional, price: z.number().int().min(0).max(1_000_000_000),
    availability: z.enum(['available', 'unavailable', 'unknown']),
    image: z.string().max(1000).refine(value => !value || /^https:\/\/[^\s]+$/i.test(value)).default(''),
  }),
  persona: z.object({ prompt: text, voice: short, rules: optional, language: z.enum(['vi', 'en']) }),
  models: z.object({ provider: z.enum(['mock', 'workers-ai']), model: z.enum(models), dailyLimit: z.number().int().min(0).max(100), dailyNeurons: z.number().int().min(0).max(8000).default(0) }),
  training: z.object({ title: short, incorrect: optional, body: optional, status: stages, sources: z.array(sourceRef).max(8).optional() }),
  conversations: z.object({
    title: short, channel: z.enum(['playground', 'messenger', 'messenger-mock', 'instagram', 'website']),
    channelId: z.string().max(160).optional(),
    ownerId: z.string().max(160).optional(),
    status: z.enum(['answered', 'handover', 'resolved']), paused: z.boolean().optional(), messages: z.array(message).max(40),
  }),
}
export type Kind = keyof typeof contracts
export type Data<K extends Kind> = z.infer<(typeof contracts)[K]>
export type Entry<K extends Kind> = { id: string; data: Data<K>; version: number; updated: number }
export const settings = {
  persona: { prompt: 'Bạn là trợ lý chăm sóc khách hàng.', voice: 'Ấm áp, tinh tế', rules: 'Chuyển câu hỏi chưa có căn cứ cho nhân viên.', language: 'vi' },
  models: { provider: 'mock', model: models[0], dailyLimit: 0, dailyNeurons: 0 },
} satisfies { [K in 'persona' | 'models']: Data<K> }
export const chatInput = z.object({ question: z.string().trim().min(1).max(1000), conversationId: z.uuid().optional(), channelId: z.uuid().optional(), agentId: z.uuid().optional() })
export const conversationAction = z.object({ version: z.number().int().positive(), status: z.enum(['handover', 'resolved']), reply: optional, paused: z.boolean().optional() })
