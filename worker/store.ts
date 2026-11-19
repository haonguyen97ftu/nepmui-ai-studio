import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { brands, records, revisions } from './schema'
import { settings, type Data, type Entry, type Kind } from './contracts'

export function studio(binding: D1Database, brand: string) {
  const db = drizzle(binding)
  const scope = (kind: Kind) => and(eq(records.brand, brand), eq(records.kind, kind))
  const key = (kind: Kind, id: string) => and(scope(kind), eq(records.id, id))
  const channelScope = (mode?: 'test' | 'live') => {
    const test = sql`json_extract(${records.data}, '$.channel') IN ('playground', 'messenger-mock')`
    return mode === 'test' ? test : mode === 'live' ? sql`NOT (${test})` : undefined
  }
  const decode = <K extends Kind>(row: typeof records.$inferSelect): Entry<K> => ({
    id: row.id, data: JSON.parse(row.data), updated: row.updated, version: row.version,
  })
  const get = async <K extends Kind>(kind: K, id: string) => {
    const row = await db.select().from(records).where(key(kind, id)).get()
    return row && decode<K>(row)
  }
  return {
    brand: () => db.select().from(brands).where(and(eq(brands.id, brand), eq(brands.active, 1))).get(),
    rename: async (name: string) => {
      const now = Date.now()
      await binding.batch([
        binding.prepare('UPDATE brands SET name=? WHERE id=? AND active=1').bind(name, brand),
        binding.prepare("INSERT INTO revisions VALUES (?, ?, 'brand', ?, 'update', json_object('name',?), ?)").bind(brand, crypto.randomUUID(), brand, name, now),
      ])
    },
    get,
    async setting<K extends 'models' | 'persona'>(kind: K): Promise<Data<K>> {
      return (await get(kind, 'config'))?.data ?? settings[kind] as Data<K>
    },
    async list<K extends Kind>(kind: K, search = '', offset = 0, status?: string, mode?: 'test' | 'live') {
      const match = search ? sql`instr(lower(${records.data}), lower(${search})) > 0` : undefined
      return (await db.select().from(records).where(and(scope(kind), match, status ? sql`json_extract(${records.data}, '$.status') = ${status}` : undefined, channelScope(mode)))
        .orderBy(desc(records.updated), records.id).limit(51).offset(offset)).map(decode<K>)
    },
    async create<K extends Kind>(kind: K, data: Data<K>, id = crypto.randomUUID() as string) {
      const [row] = await db.insert(records).values({ brand, kind, id, data: JSON.stringify(data), updated: Date.now() })
        .onConflictDoNothing().returning()
      return row && decode<K>(row)
    },
    async importDrafts(items: Data<'knowledge'>[]) {
      const now = Date.now()
      await binding.batch(items.map(item => binding.prepare('INSERT INTO records (brand_id,kind,id,data,updated) VALUES (?,?,?,?,?)')
        .bind(brand, 'knowledge', crypto.randomUUID(), JSON.stringify(item), now)))
    },
    async update<K extends Kind>(kind: K, id: string, data: Data<K>, version: number) {
      const [row] = await db.update(records).set({ data: JSON.stringify(data), version: sql`${records.version}+1`, updated: Date.now() })
        .where(and(key(kind, id), eq(records.version, version))).returning()
      return row && decode<K>(row)
    },
    async remove(kind: Kind, id: string, version: number) {
      return (await db.delete(records).where(and(key(kind, id), eq(records.version, version))).returning()).length > 0
    },
    async publishCorrection(entry: Entry<'training'>) {
      const { id, data, version } = entry
      const now = Date.now()
      const knowledge = JSON.stringify({ title: data.title, body: data.body, category: 'Huấn luyện', status: 'published' })
      const result = await binding.batch([
        binding.prepare("INSERT INTO records (brand_id,kind,id,data,updated) SELECT brand_id,'knowledge',?, ?, ? FROM records WHERE brand_id=? AND kind='training' AND id=? AND version=? AND json_extract(data,'$.status')='approved' RETURNING id")
          .bind(crypto.randomUUID(), knowledge, now, brand, id, version),
        binding.prepare("UPDATE records SET data=json_set(data,'$.status','published'), version=version+1, updated=? WHERE brand_id=? AND kind='training' AND id=? AND version=? AND json_extract(data,'$.status')='approved'")
          .bind(now, brand, id, version),
      ])
      return result[0].results.length === 1
    },
    audit: () => db.select().from(revisions).where(eq(revisions.brand, brand)).orderBy(desc(revisions.at), revisions.id).limit(50),
    async reserve(day: string, callLimit: number, neuronLimit: number, estimate: number) {
      const result = await binding.prepare(
        `INSERT INTO usage (brand_id,day,calls,reserved_neurons) SELECT ?,?,1,? WHERE ?>0 AND ?<=?
        ON CONFLICT(brand_id,day) DO UPDATE SET calls=calls+1, reserved_neurons=reserved_neurons+excluded.reserved_neurons
        WHERE calls<? AND reserved_neurons+excluded.reserved_neurons<=?`,
      ).bind(brand, day, estimate, callLimit, estimate, neuronLimit, callLimit, neuronLimit).run()
      return result.meta.changes === 1
    },
    candidates: () => binding.prepare(
      "SELECT id, json_extract(data,'$.title') title, json_extract(data,'$.body') body FROM records WHERE brand_id=? AND kind='knowledge' AND json_extract(data,'$.status')='published' ORDER BY updated DESC LIMIT 200",
    ).bind(brand).all<{ id: string; title: string; body: string }>(),
    async overview(day: string, since: number, mode: 'test' | 'live') {
      const [counts, metrics, daily, spend] = await binding.batch<Record<string, number>>([
        binding.prepare(`SELECT count(*) total,
          coalesce(sum(json_extract(data,'$.status')='handover'),0) pending
          FROM records WHERE brand_id=? AND kind='conversations' AND (json_extract(data,'$.channel') IN ('playground','messenger-mock'))=?`).bind(brand, Number(mode === 'test')),
        binding.prepare(`SELECT count(*) responses, avg(json_extract(message.value,'$.latency')) latency,
          coalesce(sum(json_extract(message.value,'$.reason')='grounded'),0) grounded
          FROM records, json_each(records.data,'$.messages') message WHERE brand_id=? AND kind='conversations'
          AND json_extract(message.value,'$.role')='assistant' AND (json_extract(records.data,'$.channel') IN ('playground','messenger-mock'))=?`).bind(brand, Number(mode === 'test')),
        binding.prepare(`SELECT date(updated/1000,'unixepoch') day, count(*) total FROM records
          WHERE brand_id=? AND kind='conversations' AND updated>=? AND (json_extract(data,'$.channel') IN ('playground','messenger-mock'))=? GROUP BY day ORDER BY day`).bind(brand, since, Number(mode === 'test')),
        binding.prepare('SELECT calls, reserved_neurons FROM usage WHERE brand_id=? AND day=?').bind(brand, day),
      ])
      return { ...counts.results[0], ...metrics.results[0], series: daily.results, calls: spend.results[0]?.calls ?? 0, reservedNeurons: spend.results[0]?.reserved_neurons ?? 0 }
    },
  }
}
export type Studio = ReturnType<typeof studio>
