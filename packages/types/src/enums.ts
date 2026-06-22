import { z } from 'zod'

export const RiskLevel = z.enum(['SAFE', 'WARNING', 'CRITICAL', 'SECURITY_INCIDENT'])
export type RiskLevel = z.infer<typeof RiskLevel>

export const PlatformRole = z.enum(['owner', 'admin', 'reviewer', 'analyst', 'viewer'])
export type PlatformRole = z.infer<typeof PlatformRole>

export const QueryStatus = z.enum(['PENDING', 'AWAITING_ACKNOWLEDGMENT', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED'])
export type QueryStatus = z.infer<typeof QueryStatus>

export const ApprovalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'])
export type ApprovalStatus = z.infer<typeof ApprovalStatus>

export const EnvironmentType = z.enum(['development', 'staging', 'production'])
export type EnvironmentType = z.infer<typeof EnvironmentType>

export const AllowedAction = z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
export type AllowedAction = z.infer<typeof AllowedAction>

export const AuditAction = z.enum([
  'QUERY_SUBMITTED',
  'QUERY_EXECUTED',
  'QUERY_FAILED',
  'QUERY_CANCELLED',
  'QUERY_ACKNOWLEDGED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'ORGANIZATION_CREATED',
  'USER_INVITED',
  'INVITATION_REVOKED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'MEMBER_ROLE_CHANGED',
  'DB_CONNECTION_CREATED',
  'DB_CONNECTION_UPDATED',
  'DB_CONNECTION_DELETED',
  'CUSTOM_ROLE_CREATED',
  'CUSTOM_ROLE_UPDATED',
  'CUSTOM_ROLE_DELETED',
  'ENVIRONMENT_UPDATED',
  'POLICY_CREATED',
  'POLICY_UPDATED',
  'POLICY_DELETED',
  'SECURITY_INCIDENT_DETECTED',
  'RATE_LIMIT_EXCEEDED',
])
export type AuditAction = z.infer<typeof AuditAction>
