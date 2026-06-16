import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { verifyKeycloakToken, signSession } from '@repo/auth'
import { users, organizationMembers } from '@repo/db/schema'
import { writeAuditLog } from '@repo/audit'
import { createTRPCRouter, baseProcedure, authedProcedure } from '../init'
import { env } from '../../env'

export const authRouter = createTRPCRouter({
  // ── exchangeToken ──────────────────────────────────────────────────────────
  // The web app calls this after the user completes Keycloak OIDC login.
  // Validates the Keycloak access token, upserts the user record, and returns
  // a PASETO v4.local session token that the client uses for all subsequent calls.
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

      const sessionId = randomUUID()
      const sessionToken = await signSession(
        { userId: user.id, sessionId },
        env.PASETO_LOCAL_KEY,
      )

      // Write USER_LOGIN to every org the user belongs to so each org's audit
      // chain reflects the login event. New users with no memberships skip this.
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

  // ── me ────────────────────────────────────────────────────────────────────
  // Returns the currently authenticated user.
  me: authedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
  })),

  // ── logout ────────────────────────────────────────────────────────────────
  // P2: will delete the session from Redis to prevent token reuse.
  // For now the client simply discards the token.
  logout: authedProcedure.mutation(() => {
    // TODO(P2): ctx.db exec "DELETE FROM sessions WHERE id = ctx.sessionId" in Redis
    return { success: true }
  }),
})
