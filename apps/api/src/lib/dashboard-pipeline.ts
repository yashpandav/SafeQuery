import { eq, and, gte } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { queryLogs, approvalRequests, auditLogs } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkDashboard } from '@repo/policy-client'
import { verifyIntegrity } from '@repo/audit'
import type { PlatformRole } from '@repo/types'

export interface DashboardPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface DashboardPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface DashboardSummary {
  queriesToday: { total: number; safe: number; warning: number; critical: number }
  pendingApprovals: { count: number; avgWaitMinutes: number | null }
  securityIncidentsLast30Days: number
  auditIntegrity: { valid: boolean; checkedCount: number }
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

export async function getDashboardSummary(deps: DashboardPipelineDeps, principal: DashboardPrincipal): Promise<DashboardSummary> {
  const cerbosPrincipal: CerbosPrincipal = { userId: principal.userId, orgId: principal.orgId, platformRole: principal.platformRole }
  const decision = await checkDashboard(deps.cerbosClient, cerbosPrincipal, { orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view the workspace dashboard' })

  const todaysQueries = await deps.db.query.queryLogs.findMany({
    where: and(eq(queryLogs.orgId, principal.orgId), gte(queryLogs.createdAt, startOfToday())),
  })
  const queriesToday = {
    total: todaysQueries.length,
    safe: todaysQueries.filter((q) => q.riskLevel === 'SAFE').length,
    warning: todaysQueries.filter((q) => q.riskLevel === 'WARNING').length,
    critical: todaysQueries.filter((q) => q.riskLevel === 'CRITICAL').length,
  }

  const pending = await deps.db.query.approvalRequests.findMany({
    where: and(eq(approvalRequests.orgId, principal.orgId), eq(approvalRequests.status, 'PENDING')),
  })
  const now = Date.now()
  const avgWaitMinutes =
    pending.length === 0 ? null : Math.round(pending.reduce((sum, p) => sum + (now - p.createdAt.getTime()), 0) / pending.length / 60_000)

  const recentIncidents = await deps.db.query.auditLogs.findMany({
    where: and(
      eq(auditLogs.orgId, principal.orgId),
      eq(auditLogs.action, 'SECURITY_INCIDENT_DETECTED'),
      gte(auditLogs.createdAt, daysAgo(30)),
    ),
  })

  const integrity = await verifyIntegrity(deps.db, principal.orgId)

  return {
    queriesToday,
    pendingApprovals: { count: pending.length, avgWaitMinutes },
    securityIncidentsLast30Days: recentIncidents.length,
    auditIntegrity: { valid: integrity.valid, checkedCount: integrity.checkedCount },
  }
}
