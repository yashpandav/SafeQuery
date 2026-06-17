import type { PlatformRole } from '@repo/types'

export interface CerbosPrincipal {
  userId: string
  platformRole: PlatformRole
  orgId: string
}


export interface QueryResourceAttrs {
  id: string
  orgId: string
  riskLevel: string
  environment: string
  submittedBy: string
}

export interface ApprovalResourceAttrs {
  id: string
  orgId: string
  submittedBy: string
  status: string
}

export interface DatabaseConnectionResourceAttrs {
  id: string
  orgId: string
}

export interface AuditLogResourceAttrs {
  id: string
  orgId: string
  actorId: string
}

export interface DbTableResourceAttrs {
  table: string
  orgId: string
}

export interface DbTablePrincipalAttrs {
  tableScope: string[]
  capabilities: DbTableAction[]
  rowFilter: string | null
  maskedColumns: string[]
}

export type QueryAction =
  | 'submit'
  | 'read_results'
  | 'approve'
  | 'reject'
  | 'execute_write'

export type ApprovalAction = 'read' | 'approve' | 'reject'

export type DatabaseConnectionAction =
  | 'create'
  | 'read'
  | 'read_metadata'
  | 'read_credentials'
  | 'update'
  | 'delete'
  | 'test_connection'

export type AuditLogAction = 'read' | 'verify_integrity' | 'delete' | 'update'

export type DbTableAction = 'select' | 'insert' | 'update' | 'delete'

export type DecisionMap<T extends string> = Record<T, boolean>

export interface DbTableDecision {
  allowed: DecisionMap<DbTableAction>
  rowFilter: string | null
  maskedColumns: string[]
}
