import { eq, and, desc, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { approvalRequests, queryLogs, databaseConnections, users } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkApproval, filterReadableApprovals } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import { JOB_NAMES, type ConnectionTarget } from '@repo/queue'
import type { PlatformRole, RiskLevel, ApprovalStatus, SimulationResult } from '@repo/types'
import type { ExecutionQueueClient } from './query-pipeline'

export interface ApprovalReadDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface ApprovalPipelineDeps extends ApprovalReadDeps {
  executionQueue: ExecutionQueueClient
  verifyReauthToken: (token: string) => Promise<{ sub: string }>
}

export interface ApprovalPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface ApprovalListItem {
  id: string
  status: ApprovalStatus
  createdAt: Date
  expiresAt: Date
  decidedAt: Date | null
  decisionNote: string | null
  simulationResult: SimulationResult | null
  queryLogId: string
  naturalLanguage: string
  generatedSql: string
  riskLevel: RiskLevel
  submittedBy: string
}

export async function listApprovals(deps: ApprovalReadDeps, principal: ApprovalPrincipal): Promise<ApprovalListItem[]> {
  const rows = await deps.db.query.approvalRequests.findMany({
    where: eq(approvalRequests.orgId, principal.orgId),
    orderBy: [desc(approvalRequests.createdAt)],
  })
  if (rows.length === 0) return []

  const logs = await deps.db.query.queryLogs.findMany({
    where: inArray(queryLogs.id, rows.map((r) => r.queryLogId)),
  })
  const logById = new Map(logs.map((l) => [l.id, l]))

  const cerbosPrincipal: CerbosPrincipal = { userId: principal.userId, orgId: principal.orgId, platformRole: principal.platformRole }
  const readable = await filterReadableApprovals(
    deps.cerbosClient,
    cerbosPrincipal,
    rows.map((r) => ({ id: r.id, orgId: r.orgId, submittedBy: logById.get(r.queryLogId)?.userId ?? '', status: r.status })),
  )

  return rows
    .filter((r) => readable.has(r.id))
    .map((r) => {
      const log = logById.get(r.queryLogId)
      return {
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
        simulationResult: r.simulationResult ?? null,
        queryLogId: r.queryLogId,
        naturalLanguage: log?.naturalLanguage ?? '',
        generatedSql: log?.generatedSql ?? '',
        riskLevel: log?.riskLevel ?? 'CRITICAL',
        submittedBy: log?.userId ?? '',
      }
    })
}

export interface DecideApprovalInput {
  approvalRequestId: string
  decision: 'APPROVED' | 'REJECTED'
  note?: string
  reauthToken: string
}

export interface DecideApprovalResult {
  approvalRequestId: string
  status: 'APPROVED' | 'REJECTED'
  executed: boolean
  rowCount: number | null
  error: string | null
}

async function assertReauthenticated(deps: ApprovalPipelineDeps, principal: ApprovalPrincipal, input: DecideApprovalInput): Promise<void> {
  async function fail(): Promise<never> {
    await writeAuditLog(deps.db, {
      orgId: principal.orgId,
      actorId: principal.userId,
      action: 'REAUTHENTICATION_FAILED',
      resourceType: 'approval_request',
      resourceId: input.approvalRequestId,
      metadata: {},
    })
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Re-authentication failed — please confirm your password to decide this request' })
  }

  let verified: { sub: string }
  try {
    verified = await deps.verifyReauthToken(input.reauthToken)
  } catch {
    return fail()
  }

  const user = await deps.db.query.users.findFirst({ where: eq(users.id, principal.userId) })
  if (!user || user.keycloakId !== verified.sub) {
    return fail()
  }
}

export async function decideApproval(
  deps: ApprovalPipelineDeps,
  principal: ApprovalPrincipal,
  input: DecideApprovalInput,
): Promise<DecideApprovalResult> {
  await assertReauthenticated(deps, principal, input)

  const approval = await deps.db.query.approvalRequests.findFirst({
    where: and(eq(approvalRequests.id, input.approvalRequestId), eq(approvalRequests.orgId, principal.orgId)),
  })
  if (!approval) throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval request not found' })
  if (approval.status !== 'PENDING') {
    throw new TRPCError({ code: 'CONFLICT', message: `Approval request is already ${approval.status}` })
  }

  const queryLog = await deps.db.query.queryLogs.findFirst({ where: eq(queryLogs.id, approval.queryLogId) })
  if (!queryLog) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Linked query log no longer exists' })

  const action = input.decision === 'APPROVED' ? 'approve' : 'reject'
  const cerbosPrincipal: CerbosPrincipal = { userId: principal.userId, orgId: principal.orgId, platformRole: principal.platformRole }
  const decision = await checkApproval(
    deps.cerbosClient,
    cerbosPrincipal,
    { id: approval.id, orgId: principal.orgId, submittedBy: queryLog.userId, status: approval.status },
    [action],
  )
  if (!decision[action]) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Not authorized to ${action} this request (reviewers cannot ${action} their own submission)`,
    })
  }

  if (input.decision === 'REJECTED') {
    await deps.db
      .update(approvalRequests)
      .set({ status: 'REJECTED', reviewerId: principal.userId, decisionNote: input.note ?? null, decidedAt: new Date() })
      .where(eq(approvalRequests.id, approval.id))
    await deps.db.update(queryLogs).set({ status: 'CANCELLED' }).where(eq(queryLogs.id, queryLog.id))

    await writeAuditLog(deps.db, {
      orgId: principal.orgId,
      actorId: principal.userId,
      action: 'APPROVAL_REJECTED',
      resourceType: 'approval_request',
      resourceId: approval.id,
      metadata: { queryLogId: queryLog.id, note: input.note ?? null },
    })

    return { approvalRequestId: approval.id, status: 'REJECTED', executed: false, rowCount: null, error: null }
  }

  const connection = await deps.db.query.databaseConnections.findFirst({ where: eq(databaseConnections.id, queryLog.connectionId) })
  if (!connection) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Connection no longer exists' })

  const target: ConnectionTarget = {
    host: connection.host,
    port: connection.port,
    database: connection.database,
    ssl: connection.ssl,
    encryptedCredentials: connection.encryptedCredentials,
  }
  const writeResult = await deps.executionQueue.run({
    type: JOB_NAMES.EXECUTE_WRITE,
    orgId: principal.orgId,
    connection: target,
    sql: queryLog.generatedSql,
    dryRun: false,
  })

  await deps.db
    .update(approvalRequests)
    .set({ status: 'APPROVED', reviewerId: principal.userId, decisionNote: input.note ?? null, decidedAt: new Date() })
    .where(eq(approvalRequests.id, approval.id))

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'APPROVAL_APPROVED',
    resourceType: 'approval_request',
    resourceId: approval.id,
    metadata: { queryLogId: queryLog.id },
  })

  if (writeResult.success) {
    await deps.db
      .update(queryLogs)
      .set({ status: 'EXECUTED', rowCount: writeResult.affectedRows, executionMs: writeResult.executionMs, executedAt: new Date() })
      .where(eq(queryLogs.id, queryLog.id))
    await writeAuditLog(deps.db, {
      orgId: principal.orgId,
      actorId: principal.userId,
      action: 'QUERY_EXECUTED',
      resourceType: 'query_log',
      resourceId: queryLog.id,
      metadata: { rowCount: writeResult.affectedRows },
    })
  } else {
    await deps.db.update(queryLogs).set({ status: 'FAILED', errorMessage: writeResult.error }).where(eq(queryLogs.id, queryLog.id))
    await writeAuditLog(deps.db, {
      orgId: principal.orgId,
      actorId: principal.userId,
      action: writeResult.lockConflict ? 'LOCK_CONFLICT' : 'QUERY_FAILED',
      resourceType: 'query_log',
      resourceId: queryLog.id,
      metadata: { error: writeResult.error, lockConflict: writeResult.lockConflict },
    })
  }

  return {
    approvalRequestId: approval.id,
    status: 'APPROVED',
    executed: writeResult.success,
    rowCount: writeResult.success ? writeResult.affectedRows : null,
    error: writeResult.success ? null : writeResult.error,
  }
}
