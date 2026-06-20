import { createTRPCRouter, orgProcedure } from '../init'
import { getDashboardSummary } from '../../lib/dashboard-pipeline'

export const dashboardRouter = createTRPCRouter({
  summary: orgProcedure.query(({ ctx }) => {
    return getDashboardSummary({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole })
  }),
})
