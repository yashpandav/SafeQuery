import { z } from 'zod'
import { RiskLevel, QueryStatus, AllowedAction } from './enums'

// Structured output from the AI service — treated as untrusted input by the validator
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

// Per-table authorization decision from Cerbos (used during SQL rewriting)
export const TableAuthorizationSchema = z.object({
  table: z.string(),
  allowedActions: z.array(AllowedAction),
  rowFilter: z.string().nullable(),  // SQL predicate injected as WHERE clause
  rowCap: z.number().int().nullable(),
})
export type TableAuthorization = z.infer<typeof TableAuthorizationSchema>

// Query record stored in the database
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

// Input from the user
export const SubmitQuerySchema = z.object({
  connectionId: z.string().uuid(),
  naturalLanguage: z.string().min(1).max(2000),
})
export type SubmitQuery = z.infer<typeof SubmitQuerySchema>

// Dry-run simulation shown to a reviewer before they approve a CRITICAL query
export const SimulationResultSchema = z.object({
  type: z.enum(['explain', 'dry_run']),
  plan: z.string().optional(),                                              // EXPLAIN output (reads)
  affectedRows: z.number().int().optional(),                                // Row count from RETURNING (writes)
  previewRows: z.array(z.record(z.string(), z.unknown())).optional(),       // Sample of affected rows
  executionMs: z.number().int(),
})
export type SimulationResult = z.infer<typeof SimulationResultSchema>

// Final result returned to the user (PII already masked by TRE)
export const QueryResultSchema = z.object({
  queryLogId: z.string().uuid(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  executionMs: z.number().int(),
  maskedColumns: z.array(z.string()),  // columns where PII was substituted
  truncated: z.boolean(),              // true if row cap was hit
})
export type QueryResult = z.infer<typeof QueryResultSchema>

// Custom role permission config stored as JSONB
export const CustomRoleConfigSchema = z.object({
  allowedTables: z.array(z.string()),
  allowedColumns: z.record(z.string(), z.array(z.string())),  // { tableName: columnNames[] }
  allowedActions: z.array(AllowedAction),
  rowFilters: z.record(z.string(), z.string()),                 // { tableName: SQL_predicate }
  rowCap: z.number().int().positive().nullable(),
})
export type CustomRoleConfig = z.infer<typeof CustomRoleConfigSchema>
