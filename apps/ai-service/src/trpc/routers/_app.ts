import { createTRPCRouter } from '../init'
import { generateRouter } from './generate'
import { healthRouter } from './health'

export const appRouter = createTRPCRouter({
  ai: generateRouter,
  health: healthRouter,
})
export type AppRouter = typeof appRouter
