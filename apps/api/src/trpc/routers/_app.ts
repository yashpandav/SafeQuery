import { createTRPCRouter } from '../init'
import { authRouter } from './auth'
import { healthRouter } from './health'
import { queryRouter } from './query'
import { databaseConnectionRouter } from './database-connection'
import { approvalRouter } from './approval'
import { organizationRouter } from './organization'
import { auditRouter } from './audit'
import { customRoleRouter } from './custom-role'
import { environmentRouter } from './environment'
import { dashboardRouter } from './dashboard'
import { policyRouter } from './policy'

export const appRouter = createTRPCRouter({
  auth: authRouter,
  health: healthRouter,
  query: queryRouter,
  databaseConnection: databaseConnectionRouter,
  approval: approvalRouter,
  organization: organizationRouter,
  audit: auditRouter,
  customRole: customRoleRouter,
  environment: environmentRouter,
  dashboard: dashboardRouter,
  policy: policyRouter,
})
export type AppRouter = typeof appRouter
