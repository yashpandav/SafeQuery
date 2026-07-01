import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { verifyKeycloakToken, signSession } from '@repo/auth'
import { users, organizationMembers } from '@repo/db/schema'
import { writeAuditLog } from '@repo/audit'
import { createTRPCRouter, baseProcedure, authedProcedure } from '../init'
import { acceptPendingInvitations } from '../../lib/invitation-pipeline'
import { logoutSession } from '../../lib/auth-pipeline'
import { sessionBlocklist } from '../../lib/session-blocklist'
import { createKeycloakUser } from '../../lib/keycloak-admin'
import { env } from '../../env'

export const authRouter = createTRPCRouter({
  exchangeToken: baseProcedure
    .input(z.object({ keycloakToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let kcPayload
      try {
        kcPayload = await verifyKeycloakToken(input.keycloakToken, {
          keycloakUrl: env.KEYCLOAK_URL,
          realm: env.KEYCLOAK_REALM,
        })
      } catch {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired Keycloak token' })
      }

      const [user] = await ctx.db
        .insert(users)
        .values({
          keycloakId: kcPayload.sub,
          email: kcPayload.email,
          name: kcPayload.name ?? null,
        })
        .onConflictDoUpdate({
          target: users.keycloakId,
          set: {
            email: kcPayload.email,
            name: kcPayload.name ?? null,
            updatedAt: new Date(),
          },
        })
        .returning()

      if (!user) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

      await acceptPendingInvitations({ db: ctx.db }, user.id, user.email)

      const sessionId = randomUUID()
      const sessionToken = await signSession(
        { userId: user.id, sessionId },
        env.PASETO_LOCAL_KEY,
      )
      const memberships = await ctx.db.query.organizationMembers.findMany({
        where: eq(organizationMembers.userId, user.id),
        columns: { orgId: true },
      })
      await Promise.all(
        memberships.map((m) =>
          writeAuditLog(ctx.db, {
            orgId: m.orgId,
            actorId: user.id,
            action: 'USER_LOGIN',
            resourceType: 'user',
            resourceId: user.id,
            metadata: {},
          }),
        ),
      )

      return {
        sessionToken,
        user: { id: user.id, email: user.email, name: user.name },
      }
    }),
  register: baseProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        firstName: z.string().min(1).trim(),
        lastName: z.string().min(1).trim(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const keycloakId = await createKeycloakUser(
        input.email,
        input.password,
        input.firstName,
        input.lastName,
      )

      const [user] = await ctx.db
        .insert(users)
        .values({
          keycloakId,
          email: input.email.toLowerCase(),
          name: `${input.firstName} ${input.lastName}`.trim(),
        })
        .onConflictDoUpdate({
          target: users.keycloakId,
          set: {
            email: input.email.toLowerCase(),
            name: `${input.firstName} ${input.lastName}`.trim(),
            updatedAt: new Date(),
          },
        })
        .returning()

      if (!user) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

      await acceptPendingInvitations({ db: ctx.db }, user.id, user.email)

      const sessionId = randomUUID()
      const sessionToken = await signSession({ userId: user.id, sessionId }, env.PASETO_LOCAL_KEY)

      return {
        sessionToken,
        user: { id: user.id, email: user.email, name: user.name },
      }
    }),

  me: authedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
  })),
  logout: authedProcedure.mutation(async ({ ctx }) => {
    await logoutSession({ db: ctx.db, blocklist: sessionBlocklist }, ctx.user.id, ctx.sessionId)
    return { success: true }
  }),
})
