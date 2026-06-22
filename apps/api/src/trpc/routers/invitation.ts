import { CreateInvitationSchema, RevokeInvitationSchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { listInvitations, createInvitation, revokeInvitation } from '../../lib/invitation-pipeline'

export const invitationRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) => {
    return listInvitations({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole })
  }),
  create: orgProcedure.input(CreateInvitationSchema).mutation(({ ctx, input }) => {
    return createInvitation(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
  revoke: orgProcedure.input(RevokeInvitationSchema).mutation(({ ctx, input }) => {
    return revokeInvitation(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input,
    )
  }),
})
