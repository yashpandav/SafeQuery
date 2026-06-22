import { z } from 'zod'
import { ApprovalDecisionSchema } from '@repo/types'
import { verifyKeycloakToken } from '@repo/auth'
import { createTRPCRouter, orgProcedure } from '../init'
import { decideApproval, listApprovals } from '../../lib/approval-pipeline'
import { executionQueue } from '../../lib/execution-queue'
import { env } from '../../env'

export const approvalRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) => {
    return listApprovals(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
    )
  }),
  decide: orgProcedure
    .input(ApprovalDecisionSchema.extend({ approvalRequestId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return decideApproval(
        {
          db: ctx.db,
          cerbosClient: ctx.cerbos,
          executionQueue,
          verifyReauthToken: (token) => verifyKeycloakToken(token, { keycloakUrl: env.KEYCLOAK_URL, realm: env.KEYCLOAK_REALM }),
        },
        { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
        input,
      )
    }),
})
