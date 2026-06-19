import { z } from 'zod'
import { RiskLevel, QueryStatus, AllowedAction } from './enums'

export const GeneratedSqlSchema = z.object({
  sql: z.string(),
  explanation: z.string(),
  riskLevel: RiskLevel,
  riskReason: z.string(),
  affectedTables: z.array(z.string()),
  isWrite: z.boolean(),
  estimatedRowCount: z.number().int().nullable(),
})
export type GeneratedSql = z.infer<typeof GeneratedSqlSchema>

export const TableAuthorizationSchema = z.object({
  table: z.string(),
  allowedActions: z.array(AllowedAction),
  rowFilter: z.string().nullable(),
  rowCap: z.number().int().nullable(),
  maskedColumns: z.array(z.string()),
})
export type TableAuthorization = z.infer<typeof TableAuthorizationSchema>

export const QueryLogSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  connectionId: z.string().uuid(),
  naturalLanguage: z.string(),
  generatedSql: z.string(),
  riskLevel: RiskLevel,
  riskReason: z.string(),
  status: QueryStatus,
  rowCount: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  executionMs: z.number().int().nullable(),
  createdAt: z.date(),
  executedAt: z.date().nullable(),
})
export type QueryLog = z.infer<typeof QueryLogSchema>

export const SubmitQuerySchema = z.object({
  connectionId: z.string().uuid(),
  naturalLanguage: z.string().min(1).max(2000),
})
export type SubmitQuery = z.infer<typeof SubmitQuerySchema>

export const SimulationResultSchema = z.object({
  type: z.enum(['explain', 'dry_run']),
  plan: z.string().optional(),
  estimatedRowCount: z.number().int().nullable().optional(),
  affectedRows: z.number().int().optional(),
  previewRows: z.array(z.record(z.string(), z.unknown())).optional(),
  executionMs: z.number().int(),
})
export type SimulationResult = z.infer<typeof SimulationResultSchema>

export const QueryResultSchema = z.object({
  queryLogId: z.string().uuid(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  executionMs: z.number().int(),
  maskedColumns: z.array(z.string()),
  truncated: z.boolean(),
})
export type QueryResult = z.infer<typeof QueryResultSchema>

export const CustomRoleConfigSchema = z.object({
  allowedTables: z.array(z.string()),
  allowedColumns: z.record(z.string(), z.array(z.string())),
  allowedActions: z.array(AllowedAction),
  rowFilters: z.record(z.string(), z.string()),
  rowCap: z.number().int().positive().nullable(),
})
export type CustomRoleConfig = z.infer<typeof CustomRoleConfigSchema>
