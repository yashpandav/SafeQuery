import { z } from 'zod'
import { ApprovalStatus } from './enums'
import { SimulationResultSchema } from './query'

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  queryLogId: z.string().uuid(),
  orgId: z.string().uuid(),
  reviewerId: z.string().uuid().nullable(),
  status: ApprovalStatus,
  simulationResult: SimulationResultSchema.nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.date().nullable(),
  expiresAt: z.date(),
  createdAt: z.date(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(1000).optional(),
})
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>
