import { UpdateEnvironmentTypeSchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { listEnvironments, updateEnvironmentType } from '../../lib/environment-pipeline'

export const environmentRouter = createTRPCRouter({
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
})
