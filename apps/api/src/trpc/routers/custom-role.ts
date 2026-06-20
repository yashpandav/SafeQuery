import { z } from 'zod'
import { CreateCustomRoleSchema, UpdateCustomRoleSchema } from '@repo/types'
import { createTRPCRouter, orgProcedure } from '../init'
import { listCustomRoles, createCustomRole, updateCustomRole, deleteCustomRole } from '../../lib/custom-role-pipeline'

export const customRoleRouter = createTRPCRouter({
  list: orgProcedure.query(({ ctx }) => {
    return listCustomRoles({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole })
  }),
  create: orgProcedure.input(CreateCustomRoleSchema).mutation(({ ctx, input }) => {
    return createCustomRole({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole }, input)
  }),
  update: orgProcedure.input(UpdateCustomRoleSchema).mutation(({ ctx, input }) => {
    return updateCustomRole({ db: ctx.db, cerbosClient: ctx.cerbos }, { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole }, input)
  }),
  delete: orgProcedure.input(z.object({ customRoleId: z.string().uuid() })).mutation(({ ctx, input }) => {
    return deleteCustomRole(
      { db: ctx.db, cerbosClient: ctx.cerbos },
      { userId: ctx.user.id, orgId: ctx.orgId, platformRole: ctx.platformRole },
      input.customRoleId,
    )
  }),
})
