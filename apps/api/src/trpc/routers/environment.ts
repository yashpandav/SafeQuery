import { CreateEnvironmentSchema, UpdateEnvironmentTypeSchema, UpdateEnvironmentWriteWindowSchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { createEnvironment, listEnvironments, updateEnvironmentType, updateEnvironmentWriteWindow } from '../../lib/environment-pipeline'

export const environmentRouter = createTRPCRouter({
  create: orgProcedure.input(CreateEnvironmentSchema).mutation(({ ctx, input }) => {
    return createEnvironment({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole }, input)
  }),
  list: orgProcedure.query(({ ctx }) => {
    return listEnvironments({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole })
  }),
  updateType: orgProcedure.input(UpdateEnvironmentTypeSchema).mutation(({ ctx, input }) => {
    return updateEnvironmentType(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
  updateWriteWindow: orgProcedure.input(UpdateEnvironmentWriteWindowSchema).mutation(({ ctx, input }) => {
    return updateEnvironmentWriteWindow(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
})
