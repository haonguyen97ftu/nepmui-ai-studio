import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { brands, records, revisions } from './schema'
import { settings, type Data, type Entry, type Kind, type SourceRef } from './contracts'
import type { Principal } from './accounts'
import { matchExpression, retrievalExpression } from './retrieval'

export function studio(binding: D1Database, brand: string, context: { channelId?: string; persona?: Data<'persona'>; model?: Data<'models'>['model']; authorization?: {sql:string;bindings:(string|null)[]}; conversationActor?: Pick<Principal, 'id' | 'role'> } = {}) {
  const db = drizzle(binding)
  const authorization=context.authorization
  const predicate = (condition: { sql: string; bindings: (string | null)[] }) =>
    sql.join(condition.sql.split('?').flatMap((part, index) => index < condition.bindings.length
      ? [sql.raw(part), sql`${condition.bindings[index]}`] : [sql.raw(part)]), sql.raw(''))
  const guard = authorization && predicate(authorization)
  const actor = context.conversationActor
  const visibility = actor && actor.role !== 'super-admin' && actor.role !== 'brand-admin'
    ? { sql: "(json_extract(data,'$.channel') <> 'playground' OR json_extract(data,'$.ownerId') = ?)", bindings: [actor.id] }
    : { sql: '1', bindings: [] }
  const visible = (kind: Kind) => kind === 'conversations' ? predicate(visibility) : undefined
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
    const row = await db.select().from(records).where(and(key(kind, id), visible(kind))).get()
    return row && decode<K>(row)
  }
  return {
    brand: () => db.select().from(brands).where(and(eq(brands.id, brand), eq(brands.active, 1))).get(),
    rename: async (name: string) => {
      const now = Date.now()
      await binding.batch([
        binding.prepare(`UPDATE brands SET name=? WHERE id=? AND active=1 AND ${authorization?.sql??'1'}`).bind(name, brand,...(authorization?.bindings??[])),
        binding.prepare("INSERT INTO revisions SELECT ?, ?, 'brand', ?, 'update', json_object('name',?), ? WHERE changes()=1").bind(brand, crypto.randomUUID(), brand, name, now),
      ])
    },
    get,
    async setting<K extends 'models' | 'persona'>(kind: K): Promise<Data<K>> {
      const data = (await get(kind, 'config'))?.data ?? settings[kind] as Data<K>
      if (kind==='persona' && context.persona) return context.persona as Data<K>
      if (kind==='models' && context.model) return { ...data,model:context.model } as Data<K>
      return data
    },
    async list<K extends Kind>(kind: K, search = '', offset = 0, status?: string, mode?: 'test' | 'live') {
      const terms = matchExpression(search)
      const match = search && kind === 'knowledge'
        ? terms ? sql`${records.id} IN (SELECT record_id FROM studio_search WHERE studio_search MATCH ${terms} AND brand_id=${brand} AND kind='knowledge')` : sql`0`
        : search ? sql`instr(lower(${records.data}), lower(${search})) > 0` : undefined
      return (await db.select().from(records).where(and(scope(kind), visible(kind), match, status ? sql`json_extract(${records.data}, '$.status') = ${status}` : undefined, channelScope(mode)))
        .orderBy(desc(records.updated), records.id).limit(51).offset(offset)).map(decode<K>)
    },
    async create<K extends Kind>(kind: K, data: Data<K>, id = crypto.randomUUID() as string) {
      const row=await binding.prepare(`INSERT INTO records(brand_id,kind,id,data,updated) SELECT ?,?,?,?,? WHERE ${authorization?.sql??'1'} ON CONFLICT DO NOTHING RETURNING brand_id AS brand,kind,id,data,updated,version`)
        .bind(brand,kind,id,JSON.stringify(data),Date.now(),...(authorization?.bindings??[])).first<typeof records.$inferSelect>()
      if (!row) throw new RangeError('write_conflict')
      return decode<K>(row)
    },
    async createConversationTraining(source: Pick<Entry<'conversations'>, 'id' | 'version'>, data: Data<'training'>) {
      const row = await binding.prepare(`INSERT INTO records(brand_id,kind,id,data,updated)
        SELECT brand_id,'training',?,?,? FROM records
        WHERE brand_id=? AND kind='conversations' AND id=? AND version=?
        AND ${visibility.sql} AND ${authorization?.sql ?? '1'}
        RETURNING brand_id AS brand,kind,id,data,updated,version`)
        .bind(crypto.randomUUID(), JSON.stringify(data), Date.now(), brand, source.id, source.version,
          ...visibility.bindings, ...(authorization?.bindings ?? [])).first<typeof records.$inferSelect>()
      return row && decode<'training'>(row)
    },
    async importDrafts(items: Data<'knowledge'>[]) {
      const now = Date.now()
      await binding.batch(items.map(item => binding.prepare(`INSERT INTO records (brand_id,kind,id,data,updated) SELECT ?,?,?,?,? WHERE ${authorization?.sql??'1'}`)
        .bind(brand, 'knowledge', crypto.randomUUID(), JSON.stringify(item), now,...(authorization?.bindings??[]))))
    },
    async update<K extends Kind>(kind: K, id: string, data: Data<K>, version: number) {
      const [row] = await db.update(records).set({ data: JSON.stringify(data), version: sql`${records.version}+1`, updated: Date.now() })
        .where(and(key(kind, id), eq(records.version, version), visible(kind), guard)).returning()
      return row && decode<K>(row)
    },
    async savePlayground(data: Data<'conversations'>, refs: SourceRef[], previous?: Pick<Entry<'conversations'>, 'id' | 'version'>) {
      const current = `EXISTS(SELECT 1 FROM brands WHERE id=? AND active=1)
        AND NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(
          SELECT 1 FROM records source WHERE source.brand_id=?
          AND source.id=json_extract(ref.value,'$.id') AND source.kind=json_extract(ref.value,'$.kind')
          AND source.version=json_extract(ref.value,'$.version')
          AND (source.kind='products' OR json_extract(source.data,'$.status')='published'))) AND ${authorization?.sql??'1'}`
      const guard = [brand, JSON.stringify(refs), brand,...(authorization?.bindings??[])]
      const payload = JSON.stringify(data)
      const now = Date.now()
      const query = previous
        ? binding.prepare(`UPDATE records SET data=?,updated=?,version=version+1
          WHERE brand_id=? AND kind='conversations' AND id=? AND version=? AND ${current} RETURNING *`)
          .bind(payload, now, brand, previous.id, previous.version, ...guard)
        : binding.prepare(`INSERT INTO records(brand_id,kind,id,data,updated)
          SELECT ?,'conversations',?,?,? WHERE ${current} RETURNING *`)
          .bind(brand, crypto.randomUUID(), payload, now, ...guard)
      const row = await query.first<{ id: string; data: string; version: number; updated: number }>()
      return row ? { id: row.id, version: row.version, updated: row.updated, data: JSON.parse(row.data) as Data<'conversations'> } : undefined
    },
    async remove(kind: Kind, id: string, version: number) {
      return (await db.delete(records).where(and(key(kind, id), eq(records.version, version), visible(kind), guard)).returning()).length > 0
    },
    async publishCorrection(entry: Entry<'training'>) {
      const { id, data, version } = entry
      const now = Date.now()
      const knowledge = JSON.stringify({ title: data.title, body: data.body, category: 'Huấn luyện', status: 'published' })
      const result = await binding.batch([
        binding.prepare(`INSERT INTO records (brand_id,kind,id,data,updated) SELECT brand_id,'knowledge',?, ?, ? FROM records WHERE brand_id=? AND kind='training' AND id=? AND version=? AND json_extract(data,'$.status')='approved' AND ${authorization?.sql??'1'} RETURNING id`)
          .bind(crypto.randomUUID(), knowledge, now, brand, id, version,...(authorization?.bindings??[])),
        binding.prepare("UPDATE records SET data=json_set(data,'$.status','published'), version=version+1, updated=? WHERE brand_id=? AND kind='training' AND id=? AND version=? AND json_extract(data,'$.status')='approved' AND changes()=1")
          .bind(now, brand, id, version),
      ])
      return result[0].results.length === 1
    },
    audit: () => db.select().from(revisions).where(eq(revisions.brand, brand)).orderBy(desc(revisions.at), revisions.id).limit(50),
    async reserve(day: string, callLimit: number, neuronLimit: number, estimate: number, requireCurrentConfig = false) {
      // A single serialized D1 statement plus trigger reserves all three counters.
      // Each workspace is capped at half the account allocation, including channel overrides.
      const result = await binding.prepare(`INSERT INTO inference_reservations(brand_id,channel_id,day,neurons)
        SELECT ?,?,?,? FROM platform_limits p
        LEFT JOIN records config ON config.brand_id=? AND config.kind='models' AND config.id='config'
        WHERE p.id=1 AND ?>0 AND ?>=0
        AND (?=0 OR json_extract(config.data,'$.provider')='workers-ai')
        AND EXISTS(SELECT 1 FROM brands WHERE id=? AND active=1)
        AND coalesce((SELECT calls FROM usage WHERE brand_id=? AND day=?),0)<min(?,coalesce(json_extract(config.data,'$.dailyLimit'),?),p.calls/2)
        AND coalesce((SELECT reserved_neurons FROM usage WHERE brand_id=? AND day=?),0)+?<=min(?,coalesce(json_extract(config.data,'$.dailyNeurons'),?),p.neurons/2)
        AND coalesce((SELECT calls FROM platform_usage WHERE day=?),0)<p.calls
        AND coalesce((SELECT neurons FROM platform_usage WHERE day=?),0)+?<=p.neurons AND ${authorization?.sql??'1'} RETURNING id`)
        .bind(brand,context.channelId??'playground',day,estimate,brand,callLimit,estimate,Number(requireCurrentConfig),brand,
          brand,day,callLimit,callLimit,brand,day,estimate,neuronLimit,neuronLimit,day,day,estimate,...(authorization?.bindings??[])).all()
      return result.results.length===1
    },
    async retrieve<K extends 'products' | 'knowledge'>(kind: K, query: string, browse = false) {
      const terms = retrievalExpression(query)
      const conditions = kind === 'knowledge'
        ? "AND json_extract(r.data,'$.status')='published'" : browse ? "AND json_extract(r.data,'$.availability')='available'" : ''
      if (!terms && !browse) return []
      const match = binding.prepare(`SELECT r.* FROM studio_search s JOIN records r
        ON r.brand_id=s.brand_id AND r.kind=s.kind AND r.id=s.record_id
        WHERE studio_search MATCH ? AND r.brand_id=? AND r.kind=? ${conditions}
        ORDER BY CASE WHEN s.rowid IN (
          SELECT rowid FROM studio_search WHERE studio_search MATCH ? AND brand_id=? AND kind=?
        ) THEN 0 ELSE 1 END, r.id LIMIT 8`).bind(terms, brand, kind, 'title : (' + terms + ')', brand, kind)
      const fallback = binding.prepare(`SELECT r.* FROM records r WHERE r.brand_id=? AND r.kind=? ${conditions}
        ORDER BY r.updated DESC, r.id LIMIT 8`).bind(brand, kind)
      const matched = terms ? (await match.all<{ id: string; data: string; version: number; updated: number }>()).results : []
      const rows = matched.length || !browse ? matched : (await fallback.all<typeof matched[number]>()).results
      return rows.map(row => ({ id: row.id, data: JSON.parse(row.data) as Data<K>, version: row.version, updated: row.updated }))
    },
    history: (id: string) => db.select().from(revisions).where(and(eq(revisions.brand, brand),
      eq(revisions.kind, 'knowledge'), eq(revisions.recordId,id))).orderBy(desc(revisions.at), revisions.id).limit(100),
    async snapshot(id: string, revision: string) {
      return db.select().from(revisions).where(and(eq(revisions.brand, brand), eq(revisions.kind, 'knowledge'),
        eq(revisions.recordId,id), eq(revisions.id,revision))).get()
    },
    async overview(day: string, since: number, mode: 'test' | 'live') {
      const [counts, metrics, daily, spend] = await binding.batch<Record<string, number>>([
        binding.prepare(`SELECT count(*) total,
          coalesce(sum(json_extract(data,'$.status')='handover'),0) pending
          FROM records WHERE brand_id=? AND kind='conversations' AND (json_extract(data,'$.channel') IN ('playground','messenger-mock'))=? AND ${visibility.sql}`).bind(brand, Number(mode === 'test'), ...visibility.bindings),
        binding.prepare(`SELECT count(*) responses, avg(json_extract(message.value,'$.latency')) latency,
          coalesce(sum(json_extract(message.value,'$.reason')='grounded'),0) grounded
          FROM records, json_each(records.data,'$.messages') message WHERE brand_id=? AND kind='conversations'
          AND json_extract(message.value,'$.role')='assistant' AND (json_extract(records.data,'$.channel') IN ('playground','messenger-mock'))=? AND ${visibility.sql}`).bind(brand, Number(mode === 'test'), ...visibility.bindings),
        binding.prepare(`SELECT date(updated/1000,'unixepoch') day, count(*) total FROM records
          WHERE brand_id=? AND kind='conversations' AND updated>=? AND (json_extract(data,'$.channel') IN ('playground','messenger-mock'))=? AND ${visibility.sql} GROUP BY day ORDER BY day`).bind(brand, since, Number(mode === 'test'), ...visibility.bindings),
        binding.prepare('SELECT calls, reserved_neurons FROM usage WHERE brand_id=? AND day=?').bind(brand, day),
      ])
      return { ...counts.results[0], ...metrics.results[0], series: daily.results, calls: spend.results[0]?.calls ?? 0, reservedNeurons: spend.results[0]?.reserved_neurons ?? 0 }
    },
  }
}
export type Studio = ReturnType<typeof studio>
