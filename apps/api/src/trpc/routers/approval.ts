import { z } from 'zod'
import { createTRPCRouter, orgProcedure } from '../init'
import { decideApproval, listApprovals } from '../../lib/approval-pipeline'
import { executionQueue } from '../../lib/execution-queue'

export const approvalRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) => {
    return listApprovals(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
    )
  }),
  decide: orgProcedure
    .input(
      z.object({
        approvalRequestId: z.string().uuid(),
        decision: z.enum(['APPROVED', 'REJECTED']),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return decideApproval(
        { db: ctx.db, cerbosClient: ctx.cerbos, executionQueue },
        { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
        input,
      )
    }),
})
