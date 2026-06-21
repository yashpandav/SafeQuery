import type { RiskLevel } from '@repo/types'
import type { DbTableAction } from '@repo/policy-client'

export type StatementType = DbTableAction

export type EnvironmentType = 'development' | 'staging' | 'production'

export interface WriteWindow {
  start: string
  end: string
  timezone: string
}

export type ViolationCode =
  | 'PARSE_ERROR'
  | 'MULTI_STATEMENT'
  | 'COMMENT_DETECTED'
  | 'FORBIDDEN_STATEMENT_TYPE'
  | 'FORBIDDEN_TABLE'
  | 'UNAUTHORIZED_TABLE'
  | 'UNAUTHORIZED_COLUMN'
  | 'ROW_FILTER_INVALID'
  | 'MISSING_LIMIT'
  | 'EXCESSIVE_JOINS'
  | 'UNFILTERED_DESTRUCTIVE_WRITE'
  | 'OUTSIDE_WRITE_WINDOW'

export interface ValidationViolation {
  code: ViolationCode
  severity: 'error' | 'warning'
  message: string
  table?: string
}

export interface ValidatorOutput {
  valid: boolean
  rewrittenSql: string | null
  statementType: StatementType | null
  tables: string[]
  riskLevel: RiskLevel
  requiresApproval: boolean
  violations: ValidationViolation[]
  maskedColumns: string[]
  rowCap: number | null
}
