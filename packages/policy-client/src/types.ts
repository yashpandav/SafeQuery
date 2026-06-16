import type { PlatformRole } from '@repo/types'

// ── Principal ─────────────────────────────────────────────────────────────────
// Resolved once per request from the PASETO session + DB membership lookup.
// Passed to every Cerbos check — never cached in a token.
export interface CerbosPrincipal {
  userId: string
  platformRole: PlatformRole
  orgId: string
}

// ── Resource attribute shapes ─────────────────────────────────────────────────
// Must match the attribute names referenced in infra/docker/cerbos/policies/*.yaml

export interface QueryResourceAttrs {
  id: string
  orgId: string
  riskLevel: string          // SAFE | WARNING | CRITICAL | SECURITY_INCIDENT
  environment: string        // development | staging | production
  submittedBy: string        // userId of the analyst who submitted
}

export interface ApprovalResourceAttrs {
  id: string
  orgId: string
  submittedBy: string
  status: string             // PENDING | APPROVED | REJECTED | EXPIRED
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

// ── Action sets (keep in sync with Cerbos policy files) ──────────────────────
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

// Generic decision result: action → allowed
export type DecisionMap<T extends string> = Record<T, boolean>
