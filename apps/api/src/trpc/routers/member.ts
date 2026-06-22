import { UpdateMemberRoleSchema, RemoveMemberSchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { listMembers, updateMemberRole, removeMember } from '../../lib/member-pipeline'

export const memberRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) => {
    return listMembers({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole })
  }),
  updateRole: orgProcedure.input(UpdateMemberRoleSchema).mutation(({ ctx, input }) => {
    return updateMemberRole({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole }, input)
  }),
  remove: orgProcedure.input(RemoveMemberSchema).mutation(({ ctx, input }) => {
    return removeMember({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole }, input)
  }),
})
