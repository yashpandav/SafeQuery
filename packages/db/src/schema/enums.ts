import { pgEnum } from 'drizzle-orm/pg-core'

export const riskLevelEnum = pgEnum('risk_level', [
  'SAFE',
  'WARNING',
  'CRITICAL',
  'SECURITY_INCIDENT',
])

export const platformRoleEnum = pgEnum('platform_role', [
  'owner',
  'admin',
  'reviewer',
  'analyst',
  'viewer',
])

export const queryStatusEnum = pgEnum('query_status', [
  'PENDING',
  'AWAITING_ACKNOWLEDGMENT',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'CANCELLED',
])

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
])

export const environmentTypeEnum = pgEnum('environment_type', [
  'development',
  'staging',
  'production',
])
