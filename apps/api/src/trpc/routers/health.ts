import { createTRPCRouter, baseProcedure } from '../init'

export const healthRouter = createTRPCRouter({
  check: baseProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
    service: 'safequery-api',
  })),
})
