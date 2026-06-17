import { initTRPC, TRPCError } from '@trpc/server'
import type { Request, Response } from 'express'
import { extractBearerToken, verifyServiceToken } from '@repo/auth'
import { env } from '../env'

export async function createTRPCContext({ req, res }: { req: Request; res: Response }) {
  const token = extractBearerToken(req.headers.authorization)

  let callerService: string | null = null
  if (token) {
    try {
      const payload = await verifyServiceToken(token, env.SERVICE_PUBLIC_KEY)
      callerService = payload.service
    } catch {
    }
  }

  return { callerService, req, res }
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>

const t = initTRPC.context<Context>().create()

export const createTRPCRouter = t.router
export const baseProcedure = t.procedure
export const serviceProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.callerService) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Valid service token required' })
  }
  return next({ ctx: { ...ctx, callerService: ctx.callerService } })
})
