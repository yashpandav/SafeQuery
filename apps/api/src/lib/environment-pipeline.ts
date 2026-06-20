import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { environments } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkEnvironment } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import type { EnvironmentType, UpdateEnvironmentType, PlatformRole } from '@repo/types'

export interface EnvironmentPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface EnvironmentPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface EnvironmentSummary {
  id: string
  name: string
  type: EnvironmentType
  posture: string
  createdAt: Date
}

function toCerbosPrincipal(p: EnvironmentPrincipal): CerbosPrincipal {
  return { userId: p.userId, orgId: p.orgId, platformRole: p.platformRole }
}

function describePosture(type: EnvironmentType): string {
  if (type === 'production') return 'Writes are always CRITICAL — dry-run + reviewer approval required, regardless of the query'
  return 'Writes require acknowledgment (WARNING) unless unfiltered destructive (no WHERE clause), which is always CRITICAL'
}

export async function listEnvironments(deps: EnvironmentPipelineDeps, principal: EnvironmentPrincipal): Promise<EnvironmentSummary[]> {
  const decision = await checkEnvironment(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'list', orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view environments' })

  const rows = await deps.db.query.environments.findMany({ where: eq(environments.orgId, principal.orgId) })
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, posture: describePosture(r.type), createdAt: r.createdAt }))
}

export async function updateEnvironmentType(
  deps: EnvironmentPipelineDeps,
  principal: EnvironmentPrincipal,
  input: UpdateEnvironmentType,
): Promise<EnvironmentSummary> {
  const existing = await deps.db.query.environments.findFirst({
    where: and(eq(environments.id, input.environmentId), eq(environments.orgId, principal.orgId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' })

  const decision = await checkEnvironment(deps.cerbosClient, toCerbosPrincipal(principal), { id: existing.id, orgId: principal.orgId }, ['update'])
  if (!decision.update) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update environments' })

  const [updated] = await deps.db.update(environments).set({ type: input.type }).where(eq(environments.id, existing.id)).returning()
  if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'ENVIRONMENT_UPDATED',
    resourceType: 'environment',
    resourceId: updated.id,
    metadata: { name: updated.name, previousType: existing.type, newType: updated.type },
  })

  return { id: updated.id, name: updated.name, type: updated.type, posture: describePosture(updated.type), createdAt: updated.createdAt }
}
