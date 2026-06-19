import { createTRPCRouter, orgProcedure } from '../init'
import { listAuditLog, verifyAuditIntegrity } from '../../lib/audit-pipeline'

export const auditRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) => {
    return listAuditLog(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
    )
  }),
  verifyIntegrity: orgProcedure.mutation(({ ctx }) => {
    return verifyAuditIntegrity(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
    )
  }),
})
