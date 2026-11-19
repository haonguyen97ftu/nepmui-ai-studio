import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const brands = sqliteTable('brands', {
  id: text().primaryKey().notNull(), name: text().notNull(), active: integer().notNull(),
})
const brand = () => text('brand_id').notNull().references(() => brands.id)
export const records = sqliteTable('records', {
  brand: brand(), kind: text().notNull(), id: text().notNull(), data: text().notNull(),
  version: integer().notNull().default(1), updated: integer().notNull(),
}, table => [primaryKey({ columns: [table.brand, table.kind, table.id] })])
export const revisions = sqliteTable('revisions', {
  brand: brand(), id: text().notNull(), kind: text().notNull(), recordId: text('record_id').notNull(),
  action: text().notNull(), data: text().notNull(), at: integer().notNull(),
}, table => [primaryKey({ columns: [table.brand, table.id] })])
export const usage = sqliteTable('usage', {
  brand: brand(), day: text().notNull(), calls: integer().notNull(), reservedNeurons: integer('reserved_neurons').notNull(),
}, table => [primaryKey({ columns: [table.brand, table.day] })])
export const deliveries = sqliteTable('deliveries', {
  brand: brand(), channel: text().notNull(), externalId: text('external_id').notNull(), at: integer().notNull(),
}, table => [primaryKey({ columns: [table.brand, table.channel, table.externalId] })])
