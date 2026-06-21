import { z } from 'zod'
import { SubmitQuerySchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { submitQuery, acknowledgeQuery } from '../../lib/query-pipeline'
import { aiServiceClient } from '../../lib/ai-service-client'
import { executionQueue } from '../../lib/execution-queue'
import { rateLimiter } from '../../lib/rate-limiter'

export const queryRouter = createTRPCRouter({
  submit: orgProcedure.input(SubmitQuerySchema).mutation(({ ctx, input }) => {
    return submitQuery(
      { db: ctx.db, cerbosClient: ctx.cerbos, aiService: aiServiceClient, executionQueue, rateLimiter },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
  acknowledge: orgProcedure.input(z.object({ queryLogId: z.string().uuid() })).mutation(({ ctx, input }) => {
    return acknowledgeQuery(
      { db: ctx.db, cerbosClient: ctx.cerbos, executionQueue },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
})
