import { z } from 'zod'
import { AuditAction } from './enums'

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  actorId: z.string().uuid(),
  action: AuditAction,
  resourceType: z.string(),
  resourceId: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  prevHash: z.string().nullable(),
  hash: z.string(),
  createdAt: z.date(),
})
export type AuditLog = z.infer<typeof AuditLogSchema>

export const WriteAuditLogSchema = AuditLogSchema.omit({
  id: true,
  prevHash: true,
  hash: true,
  createdAt: true,
})
export type WriteAuditLog = z.infer<typeof WriteAuditLogSchema>
