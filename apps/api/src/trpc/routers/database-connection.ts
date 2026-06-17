import { z } from 'zod'
import { CreateDatabaseConnectionSchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { createConnection, listConnections, captureSchema } from '../../lib/connection-pipeline'
import { executionQueue } from '../../lib/execution-queue'

export const databaseConnectionRouter = createTRPCRouter({
  create: orgProcedure.input(CreateDatabaseConnectionSchema).mutation(({ ctx, input }) => {
    return createConnection(
      { db: ctx.db, cerbosClient: ctx.cerbos, executionQueue },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),

  list: orgProcedure.query(({ ctx }) => {
    return listConnections(
      { db: ctx.db, cerbosClient: ctx.cerbos, executionQueue },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
    )
  }),

  captureSchema: orgProcedure.input(z.object({ connectionId: z.string().uuid() })).mutation(({ ctx, input }) => {
    return captureSchema(
      { db: ctx.db, cerbosClient: ctx.cerbos, executionQueue },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input.connectionId,
    )
  }),
})
