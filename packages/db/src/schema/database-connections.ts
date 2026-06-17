import { pgTable, uuid, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { organizations } from './organizations'
import { environments } from './environments'
import type { ColumnDefinition } from '@repo/types'

export const databaseConnections = pgTable('database_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  environmentId: uuid('environment_id')
    .notNull()
    .references(() => environments.id),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(5432),
  database: text('database').notNull(),
  ssl: boolean('ssl').notNull().default(false),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS()

export const schemaSnapshots = pgTable('schema_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => databaseConnections.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  snapshot: jsonb('snapshot').notNull().$type<Record<string, ColumnDefinition[]>>(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS()
