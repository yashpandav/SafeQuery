import { UpdateRateLimitPolicySchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { getRateLimitPolicyForAdmin, updateRateLimitPolicy } from '../../lib/policy-pipeline'

export const policyRouter = createTRPCRouter({
  getRateLimits: orgProcedure.query(({ ctx }) => {
    return getRateLimitPolicyForAdmin({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole })
  }),
  updateRateLimits: orgProcedure.input(UpdateRateLimitPolicySchema).mutation(({ ctx, input }) => {
    return updateRateLimitPolicy(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
})
