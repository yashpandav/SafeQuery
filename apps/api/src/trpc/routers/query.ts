import { SubmitQuerySchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { submitQuery } from '../../lib/query-pipeline'
import { aiServiceClient } from '../../lib/ai-service-client'
import { executionQueue } from '../../lib/execution-queue'

export const queryRouter = createTRPCRouter({
  submit: orgProcedure.input(SubmitQuerySchema).mutation(({ ctx, input }) => {
    return submitQuery(
      { db: ctx.db, cerbosClient: ctx.cerbos, aiService: aiServiceClient, executionQueue },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
})
