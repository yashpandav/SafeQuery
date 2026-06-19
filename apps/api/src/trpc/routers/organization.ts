import { createTRPCRouter, authedProcedure } from '../init'
import { listMyOrganizations } from '../../lib/organization-pipeline'

export const organizationRouter = createTRPCRouter({
  list: authedProcedure.query(({ ctx }) => listMyOrganizations({ db: ctx.db }, ctx.user.id)),
})
