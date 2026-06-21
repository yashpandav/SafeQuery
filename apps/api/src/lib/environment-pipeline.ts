import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { environments } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkEnvironment } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import { isWithinWriteWindow } from '@repo/sql-validator'
import type { EnvironmentType, UpdateEnvironmentType, UpdateEnvironmentWriteWindow, PlatformRole } from '@repo/types'

export interface EnvironmentPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface EnvironmentPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface EnvironmentWriteWindow {
  start: string
  end: string
  timezone: string
}

export interface EnvironmentSummary {
  id: string
  name: string
  type: EnvironmentType
  posture: string
  writeWindow: EnvironmentWriteWindow | null
  withinWriteWindowNow: boolean | null
  createdAt: Date
}

function toCerbosPrincipal(p: EnvironmentPrincipal): CerbosPrincipal {
  return { userId: p.userId, orgId: p.orgId, platformRole: p.platformRole }
}

function describePosture(type: EnvironmentType, writeWindow: EnvironmentWriteWindow | null): string {
  const base =
    type === 'production'
      ? 'Writes are always CRITICAL — dry-run + reviewer approval required, regardless of the query'
      : 'Writes require acknowledgment (WARNING) unless unfiltered destructive (no WHERE clause), which is always CRITICAL'
  if (!writeWindow) return base
  return `${base}. Writes are only permitted between ${writeWindow.start} and ${writeWindow.end} (${writeWindow.timezone}) — outside that window they're rejected as SECURITY_INCIDENT`
}

function toWriteWindow(row: typeof environments.$inferSelect): EnvironmentWriteWindow | null {
  if (!row.writeWindowStart || !row.writeWindowEnd || !row.writeWindowTimezone) return null
  return { start: row.writeWindowStart, end: row.writeWindowEnd, timezone: row.writeWindowTimezone }
}

function toSummary(row: typeof environments.$inferSelect): EnvironmentSummary {
  const writeWindow = toWriteWindow(row)
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    posture: describePosture(row.type, writeWindow),
    writeWindow,
    withinWriteWindowNow: writeWindow ? isWithinWriteWindow(new Date(), writeWindow) : null,
    createdAt: row.createdAt,
  }
}

export async function listEnvironments(deps: EnvironmentPipelineDeps, principal: EnvironmentPrincipal): Promise<EnvironmentSummary[]> {
  const decision = await checkEnvironment(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'list', orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view environments' })

  const rows = await deps.db.query.environments.findMany({ where: eq(environments.orgId, principal.orgId) })
  return rows.map(toSummary)
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

  return toSummary(updated)
}

export async function updateEnvironmentWriteWindow(
  deps: EnvironmentPipelineDeps,
  principal: EnvironmentPrincipal,
  input: UpdateEnvironmentWriteWindow,
): Promise<EnvironmentSummary> {
  const existing = await deps.db.query.environments.findFirst({
    where: and(eq(environments.id, input.environmentId), eq(environments.orgId, principal.orgId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' })

  const decision = await checkEnvironment(deps.cerbosClient, toCerbosPrincipal(principal), { id: existing.id, orgId: principal.orgId }, ['update'])
  if (!decision.update) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update environments' })

  const [updated] = await deps.db
    .update(environments)
    .set({
      writeWindowStart: input.writeWindow?.start ?? null,
      writeWindowEnd: input.writeWindow?.end ?? null,
      writeWindowTimezone: input.writeWindow?.timezone ?? null,
    })
    .where(eq(environments.id, existing.id))
    .returning()
  if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'ENVIRONMENT_UPDATED',
    resourceType: 'environment',
    resourceId: updated.id,
    metadata: { name: updated.name, previousWriteWindow: toWriteWindow(existing), newWriteWindow: toWriteWindow(updated) },
  })

  return toSummary(updated)
}
