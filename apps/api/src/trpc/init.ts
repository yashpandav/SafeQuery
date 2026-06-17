import { initTRPC, TRPCError } from '@trpc/server'
import type { Request, Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { extractBearerToken, verifySession } from '@repo/auth'
import { users, organizationMembers } from '@repo/db/schema'
import { db } from '../lib/db'
import { cerbos } from '../lib/cerbos'
import { env } from '../env'

export async function createTRPCContext({ req, res }: { req: Request; res: Response }) {
  const token = extractBearerToken(req.headers.authorization)

  let user: typeof users.$inferSelect | null = null
  let sessionId: string | null = null

  if (token) {
    try {
      const payload = await verifySession(token, env.PASETO_LOCAL_KEY)
      user = await db.query.users.findFirst({ where: eq(users.id, payload.userId) }) ?? null
      sessionId = payload.sessionId
    } catch {
    }
  }
  const orgIdHeader = req.headers['x-org-id']
  const orgId = typeof orgIdHeader === 'string' && orgIdHeader ? orgIdHeader : null

  return { user, sessionId, orgId, db, cerbos, req, res }
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>

const t = initTRPC.context<Context>().create()

export const createTRPCRouter = t.router
export const baseProcedure = t.procedure
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.sessionId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return next({ ctx: { ...ctx, user: ctx.user, sessionId: ctx.sessionId } })
})
export const orgProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.orgId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'X-Org-Id header is required for this endpoint',
    })
  }

  const membership = await ctx.db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.orgId, ctx.orgId),
      eq(organizationMembers.userId, ctx.user.id),
    ),
  })

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' })
  }

  return next({
    ctx: { ...ctx, orgId: ctx.orgId, platformRole: membership.platformRole },
  })
})
