import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { organizations } from './organizations'
import { users } from './users'

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  // AuditAction string — kept as text (not enum) so new actions don't need an ALTER TYPE
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  metadata: jsonb('metadata').notNull().default('{}'),
  // Hash chain: prevHash is the `hash` field of the immediately preceding row for this org
  prevHash: text('prev_hash'),
  // SHA-256(prevHash ?? '' + canonical JSON of this row's content fields)
  hash: text('hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS()
