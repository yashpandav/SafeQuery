import { createTRPCRouter } from '../init'
import { authRouter } from './auth'
import { healthRouter } from './health'
import { queryRouter } from './query'
import { databaseConnectionRouter } from './database-connection'
import { approvalRouter } from './approval'
import { organizationRouter } from './organization'

export const appRouter = createTRPCRouter({
  auth: authRouter,
  health: healthRouter,
  query: queryRouter,
  databaseConnection: databaseConnectionRouter,
  approval: approvalRouter,
  organization: organizationRouter,
})
export type AppRouter = typeof appRouter
