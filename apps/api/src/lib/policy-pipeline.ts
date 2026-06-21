import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { policies } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkPolicy } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import type { PlatformRole, RateLimitPolicy, UpdateRateLimitPolicy } from '@repo/types'
import { DEFAULT_RATE_LIMIT_POLICY } from '@repo/types'

const RATE_LIMIT_POLICY_TYPE = 'rate_limit'
const RATE_LIMIT_POLICY_NAME = 'Rate limits'

export interface PolicyPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface PolicyPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

function toCerbosPrincipal(p: PolicyPrincipal): CerbosPrincipal {
  return { userId: p.userId, orgId: p.orgId, platformRole: p.platformRole }
}

/**
 * Internal lookup used by submitQuery to decide whether/how hard to throttle — no Cerbos check,
 * since "what's my org's own effective rate limit" isn't an access-control decision (the caller
 * already passed orgProcedure's membership check to get here at all).
 */
export async function getRateLimitPolicy(deps: { db: DbClient }, orgId: string): Promise<RateLimitPolicy> {
  const row = await deps.db.query.policies.findFirst({
    where: and(eq(policies.orgId, orgId), eq(policies.type, RATE_LIMIT_POLICY_TYPE)),
  })
  if (!row) return DEFAULT_RATE_LIMIT_POLICY
  const config = row.config as Omit<RateLimitPolicy, 'enabled'>
  return { enabled: row.enabled, queriesPerMinutePerUser: config.queriesPerMinutePerUser, aiCallsPerDayPerOrg: config.aiCallsPerDayPerOrg }
}

export async function getRateLimitPolicyForAdmin(deps: PolicyPipelineDeps, principal: PolicyPrincipal): Promise<RateLimitPolicy> {
  const decision = await checkPolicy(deps.cerbosClient, toCerbosPrincipal(principal), { id: RATE_LIMIT_POLICY_TYPE, orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view the rate-limit policy' })
  return getRateLimitPolicy(deps, principal.orgId)
}

export async function updateRateLimitPolicy(
  deps: PolicyPipelineDeps,
  principal: PolicyPrincipal,
  input: UpdateRateLimitPolicy,
): Promise<RateLimitPolicy> {
  const decision = await checkPolicy(deps.cerbosClient, toCerbosPrincipal(principal), { id: RATE_LIMIT_POLICY_TYPE, orgId: principal.orgId }, ['update'])
  if (!decision.update) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update the rate-limit policy' })

  const existing = await deps.db.query.policies.findFirst({
    where: and(eq(policies.orgId, principal.orgId), eq(policies.type, RATE_LIMIT_POLICY_TYPE)),
  })
  const config = { queriesPerMinutePerUser: input.queriesPerMinutePerUser, aiCallsPerDayPerOrg: input.aiCallsPerDayPerOrg }

  if (existing) {
    await deps.db.update(policies).set({ config, enabled: input.enabled, updatedAt: new Date() }).where(eq(policies.id, existing.id))
  } else {
    await deps.db.insert(policies).values({
      orgId: principal.orgId,
      name: RATE_LIMIT_POLICY_NAME,
      type: RATE_LIMIT_POLICY_TYPE,
      config,
      enabled: input.enabled,
    })
  }

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'POLICY_UPDATED',
    resourceType: 'policy',
    resourceId: existing?.id ?? null,
    metadata: { type: RATE_LIMIT_POLICY_TYPE, ...config, enabled: input.enabled },
  })

  return { enabled: input.enabled, ...config }
}
