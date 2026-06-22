import { CreateOrganizationSchema } from '@repo/types'
import { createTRPCRouter, authedProcedure } from '../init'
import { listMyOrganizations, createOrganization } from '../../lib/organization-pipeline'

export const organizationRouter = createTRPCRouter({
  list: authedProcedure.query(({ ctx }) => listMyOrganizations({ db: ctx.db }, ctx.user.id)),
  create: authedProcedure.input(CreateOrganizationSchema).mutation(({ ctx, input }) => {
    return createOrganization({ db: ctx.db }, ctx.user.id, input)
  }),
})
