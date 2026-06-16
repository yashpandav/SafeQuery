import { createTRPCRouter } from '../init'
import { authRouter } from './auth'
import { healthRouter } from './health'

export const appRouter = createTRPCRouter({
  auth: authRouter,
  health: healthRouter,
})

// Re-exported for apps/web to import the type — no runtime code crosses the boundary
export type AppRouter = typeof appRouter
