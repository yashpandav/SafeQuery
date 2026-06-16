import { pgTable, uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { riskLevelEnum, queryStatusEnum, approvalStatusEnum } from './enums'
import { organizations } from './organizations'
import { users } from './users'
import { databaseConnections } from './database-connections'
import type { SimulationResult } from '@repo/types'

export const queryLogs = pgTable('query_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => databaseConnections.id),
  naturalLanguage: text('natural_language').notNull(),
  generatedSql: text('generated_sql').notNull(),
  riskLevel: riskLevelEnum('risk_level').notNull(),
  riskReason: text('risk_reason').notNull(),
  status: queryStatusEnum('query_status').notNull().default('PENDING'),
  rowCount: integer('row_count'),
  errorMessage: text('error_message'),
  executionMs: integer('execution_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }),
}).enableRLS()

export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryLogId: uuid('query_log_id')
    .notNull()
    .unique()
    .references(() => queryLogs.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  status: approvalStatusEnum('approval_status').notNull().default('PENDING'),
  // EXPLAIN output (reads) or transactional dry-run result (writes) — shown to reviewer
  simulationResult: jsonb('simulation_result').$type<SimulationResult>(),
  decisionNote: text('decision_note'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS()
