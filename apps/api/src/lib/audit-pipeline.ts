import { eq, desc, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { auditLogs, users } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { filterReadableAuditLogs, checkAuditLog } from '@repo/policy-client'
import { verifyIntegrity, type IntegrityResult } from '@repo/audit'
import type { AuditAction, PlatformRole } from '@repo/types'

export interface AuditReadDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface AuditPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface AuditLogListItem {
  id: string
  action: AuditAction
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  prevHash: string | null
  hash: string
  createdAt: Date
  actorId: string
  actorName: string | null
  actorEmail: string | null
}

const LIST_LIMIT = 200

export async function listAuditLog(deps: AuditReadDeps, principal: AuditPrincipal): Promise<AuditLogListItem[]> {
  const rows = await deps.db.query.auditLogs.findMany({
    where: eq(auditLogs.orgId, principal.orgId),
    orderBy: [desc(auditLogs.createdAt)],
    limit: LIST_LIMIT,
  })
  if (rows.length === 0) return []

  const actors = await deps.db.query.users.findMany({
    where: inArray(users.id, [...new Set(rows.map((r) => r.actorId))]),
  })
  const actorById = new Map(actors.map((a) => [a.id, a]))

  const cerbosPrincipal: CerbosPrincipal = { userId: principal.userId, orgId: principal.orgId, platformRole: principal.platformRole }
  const readable = await filterReadableAuditLogs(
    deps.cerbosClient,
    cerbosPrincipal,
    rows.map((r) => ({ id: r.id, orgId: r.orgId, actorId: r.actorId })),
  )

  return rows
    .filter((r) => readable.has(r.id))
    .map((r) => {
      const actor = actorById.get(r.actorId)
      return {
        id: r.id,
        action: r.action as AuditAction,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        metadata: r.metadata as Record<string, unknown>,
        prevHash: r.prevHash,
        hash: r.hash,
        createdAt: r.createdAt,
        actorId: r.actorId,
        actorName: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
      }
    })
}

/**
 * Recomputes the org's hash chain from genesis and reports the first mismatched row, if any.
 * `verify_integrity` is restricted to `same_org_admin` in `audit_log.yaml` — unlike `read`, reviewers
 * and "see my own entries" don't get this action, since recomputing the whole chain reveals whether
 * *other people's* entries were tampered with, not just the caller's own.
 */
export async function verifyAuditIntegrity(deps: AuditReadDeps, principal: AuditPrincipal): Promise<IntegrityResult> {
  const cerbosPrincipal: CerbosPrincipal = { userId: principal.userId, orgId: principal.orgId, platformRole: principal.platformRole }
  const decision = await checkAuditLog(
    deps.cerbosClient,
    cerbosPrincipal,
    { id: 'integrity-check', orgId: principal.orgId, actorId: principal.userId },
    ['verify_integrity'],
  )
  if (!decision.verify_integrity) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to verify audit log integrity' })
  }
  return verifyIntegrity(deps.db, principal.orgId)
}
