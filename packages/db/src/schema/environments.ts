import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { environmentTypeEnum } from './enums'
import { organizations } from './organizations'

export const environments = pgTable('environments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: environmentTypeEnum('type').notNull(),
  writeWindowStart: text('write_window_start'),
  writeWindowEnd: text('write_window_end'),
  writeWindowTimezone: text('write_window_timezone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS()
