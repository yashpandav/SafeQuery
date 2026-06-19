import { eq, and, desc } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import {
  organizationMembers,
  customRoles,
  databaseConnections,
  environments,
  schemaSnapshots,
  queryLogs,
  approvalRequests,
} from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { validateSql } from '@repo/sql-validator'
import { writeAuditLog } from '@repo/audit'
import { JOB_NAMES, type ExecutionJobData, type JobResultMap, type ConnectionTarget } from '@repo/queue'
import type { CustomRoleConfig, ColumnDefinition, RiskLevel, PlatformRole, SimulationResult } from '@repo/types'
export interface AiServiceClient {
  ai: {
    generate: (input: {
      naturalLanguage: string
      schema: Record<string, ColumnDefinition[]>
      policyNotes: string[]
    }) => Promise<{
      sql: string
      explanation: string
      riskLevel: RiskLevel
      riskReason: string
      affectedTables: string[]
      isWrite: boolean
      estimatedRowCount: number | null
    }>
  }
}
export interface ExecutionQueueClient {
  run: <T extends ExecutionJobData>(data: T) => Promise<JobResultMap[T['type']]>
}

export interface ExecutionPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
  executionQueue: ExecutionQueueClient
}

export interface QueryPipelineDeps extends ExecutionPipelineDeps {
  aiService: AiServiceClient
}

export interface SubmitQueryPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface SubmitQueryInput {
  connectionId: string
  naturalLanguage: string
}

export interface QueryExecutionResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
  maskedColumns: string[]
  executionMs: number
}

export interface SubmitQueryResult {
  queryLogId: string
  riskLevel: RiskLevel
  rewrittenSql: string | null
  explanation: string
  requiresApproval: boolean
  requiresAcknowledgment: boolean
  approvalRequestId: string | null
  violations: { code: string; severity: 'error' | 'warning'; message: string }[]
  result: QueryExecutionResult | null
  simulation: SimulationResult | null
}

export interface AcknowledgeQueryInput {
  queryLogId: string
}
function filterSchemaForRole(
  snapshot: Record<string, ColumnDefinition[]>,
  customRole: CustomRoleConfig,
): Record<string, ColumnDefinition[]> {
  const filtered: Record<string, ColumnDefinition[]> = {}
  for (const table of customRole.allowedTables) {
    const columns = snapshot[table]
    if (!columns) continue // role references a table no longer in the schema snapshot
    const restriction = customRole.allowedColumns[table]
    filtered[table] = restriction && restriction.length > 0 ? columns.filter((c) => restriction.includes(c.column)) : columns
  }
  return filtered
}
export async function submitQuery(
  deps: QueryPipelineDeps,
  principal: SubmitQueryPrincipal,
  input: SubmitQueryInput,
): Promise<SubmitQueryResult> {
  const membership = await deps.db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.userId, principal.userId)),
  })
  if (!membership?.customRoleId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No custom role assigned — cannot submit queries' })
  }

  const customRole = await deps.db.query.customRoles.findFirst({
    where: and(eq(customRoles.id, membership.customRoleId), eq(customRoles.orgId, principal.orgId)),
  })
  if (!customRole) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Assigned custom role no longer exists' })
  }

  const connection = await deps.db.query.databaseConnections.findFirst({
    where: and(eq(databaseConnections.id, input.connectionId), eq(databaseConnections.orgId, principal.orgId)),
  })
  if (!connection) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Database connection not found' })
  }

  const environment = await deps.db.query.environments.findFirst({
    where: eq(environments.id, connection.environmentId),
  })
  if (!environment) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Connection references a missing environment' })
  }

  const snapshot = await deps.db.query.schemaSnapshots.findFirst({
    where: eq(schemaSnapshots.connectionId, input.connectionId),
    orderBy: [desc(schemaSnapshots.capturedAt)],
  })
  if (!snapshot) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No schema snapshot captured for this connection yet' })
  }

  const filteredSchema = filterSchemaForRole(snapshot.snapshot, customRole.config)
  const policyNotes = [
    `This is a ${environment.type} database.`,
    customRole.config.rowCap ? `Results are capped at ${customRole.config.rowCap} rows.` : null,
  ].filter((n): n is string => n !== null)

  const generated = await deps.aiService.ai.generate({
    naturalLanguage: input.naturalLanguage,
    schema: filteredSchema,
    policyNotes,
  })

  const cerbosPrincipal: CerbosPrincipal = {
    userId: principal.userId,
    orgId: principal.orgId,
    platformRole: principal.platformRole,
  }
  if (generated.riskLevel === 'SECURITY_INCIDENT') {
    return persistRejected(deps, principal, input, generated.sql, generated.riskReason)
  }

  const validated = await validateSql({
    sql: generated.sql,
    cerbosClient: deps.cerbosClient,
    principal: cerbosPrincipal,
    customRole: customRole.config,
    environment: environment.type,
  })

  if (!validated.valid) {
    const reason = validated.violations.map((v) => v.message).join('; ') || 'Validation rejected the generated SQL'
    return persistRejected(deps, principal, input, generated.sql, reason)
  }

  const riskReason = validated.violations.length > 0 ? validated.violations.map((v) => v.message).join('; ') : generated.riskReason
  const target: ConnectionTarget = {
    host: connection.host,
    port: connection.port,
    database: connection.database,
    ssl: connection.ssl,
    encryptedCredentials: connection.encryptedCredentials,
  }
  const sql = validated.rewrittenSql ?? generated.sql

  const [queryLog] = await deps.db
    .insert(queryLogs)
    .values({
      orgId: principal.orgId,
      userId: principal.userId,
      connectionId: input.connectionId,
      naturalLanguage: input.naturalLanguage,
      generatedSql: sql,
      riskLevel: validated.riskLevel,
      riskReason,
      status: 'PENDING',
      maskedColumns: validated.maskedColumns,
      rowCap: customRole.config.rowCap,
    })
    .returning()
  if (!queryLog) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'QUERY_SUBMITTED',
    resourceType: 'query_log',
    resourceId: queryLog.id,
    metadata: { riskLevel: validated.riskLevel, connectionId: input.connectionId },
  })

  let approvalRequestId: string | null = null
  let executionResult: QueryExecutionResult | null = null
  let simulation: SimulationResult | null = null
  let requiresAcknowledgment = false

  if (validated.riskLevel === 'SAFE') {
    const jobResult = await deps.executionQueue.run({
      type: JOB_NAMES.EXECUTE_READ,
      connection: target,
      sql,
      rowCap: customRole.config.rowCap,
      maskedColumns: validated.maskedColumns,
    })
    if (jobResult.success) {
      executionResult = {
        columns: jobResult.columns,
        rows: jobResult.rows,
        rowCount: jobResult.rowCount,
        truncated: jobResult.truncated,
        maskedColumns: jobResult.maskedColumns,
        executionMs: jobResult.executionMs,
      }
      await deps.db
        .update(queryLogs)
        .set({ status: 'EXECUTED', rowCount: jobResult.rowCount, executionMs: jobResult.executionMs, executedAt: new Date() })
        .where(eq(queryLogs.id, queryLog.id))
      await writeAuditLog(deps.db, {
        orgId: principal.orgId,
        actorId: principal.userId,
        action: 'QUERY_EXECUTED',
        resourceType: 'query_log',
        resourceId: queryLog.id,
        metadata: { rowCount: jobResult.rowCount },
      })
    } else {
      await deps.db
        .update(queryLogs)
        .set({ status: 'FAILED', errorMessage: jobResult.error })
        .where(eq(queryLogs.id, queryLog.id))
      await writeAuditLog(deps.db, {
        orgId: principal.orgId,
        actorId: principal.userId,
        action: 'QUERY_FAILED',
        resourceType: 'query_log',
        resourceId: queryLog.id,
        metadata: { error: jobResult.error },
      })
    }
  } else if (validated.riskLevel === 'WARNING') {
    const explainJob = await deps.executionQueue.run({
      type: JOB_NAMES.EXECUTE_READ,
      connection: target,
      sql,
      rowCap: customRole.config.rowCap,
      maskedColumns: validated.maskedColumns,
      explainOnly: true,
    })
    if (explainJob.success) {
      simulation = {
        type: 'explain',
        plan: explainJob.plan ?? undefined,
        estimatedRowCount: explainJob.estimatedRowCount,
        executionMs: explainJob.executionMs,
      }
      requiresAcknowledgment = true
      await deps.db
        .update(queryLogs)
        .set({ status: 'AWAITING_ACKNOWLEDGMENT', simulationResult: simulation })
        .where(eq(queryLogs.id, queryLog.id))
    } else {
      await deps.db
        .update(queryLogs)
        .set({ status: 'FAILED', errorMessage: explainJob.error })
        .where(eq(queryLogs.id, queryLog.id))
      await writeAuditLog(deps.db, {
        orgId: principal.orgId,
        actorId: principal.userId,
        action: 'QUERY_FAILED',
        resourceType: 'query_log',
        resourceId: queryLog.id,
        metadata: { error: explainJob.error },
      })
    }
  } else if (validated.riskLevel === 'CRITICAL') {
    const dryRun = await deps.executionQueue.run({ type: JOB_NAMES.EXECUTE_WRITE, connection: target, sql, dryRun: true })
    if (dryRun.success) {
      simulation = {
        type: 'dry_run',
        affectedRows: dryRun.affectedRows,
        previewRows: dryRun.previewRows,
        executionMs: dryRun.executionMs,
      }
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const [approval] = await deps.db
      .insert(approvalRequests)
      .values({ queryLogId: queryLog.id, orgId: principal.orgId, status: 'PENDING', expiresAt, simulationResult: simulation })
      .returning()
    if (approval) {
      approvalRequestId = approval.id
      await writeAuditLog(deps.db, {
        orgId: principal.orgId,
        actorId: principal.userId,
        action: 'APPROVAL_REQUESTED',
        resourceType: 'approval_request',
        resourceId: approval.id,
        metadata: { queryLogId: queryLog.id, dryRunSucceeded: dryRun.success },
      })
    }
  }

  return {
    queryLogId: queryLog.id,
    riskLevel: validated.riskLevel,
    rewrittenSql: validated.rewrittenSql,
    explanation: generated.explanation,
    requiresApproval: validated.requiresApproval,
    requiresAcknowledgment,
    approvalRequestId,
    violations: validated.violations,
    result: executionResult,
    simulation,
  }
}

export async function acknowledgeQuery(
  deps: ExecutionPipelineDeps,
  principal: SubmitQueryPrincipal,
  input: AcknowledgeQueryInput,
): Promise<SubmitQueryResult> {
  const queryLog = await deps.db.query.queryLogs.findFirst({
    where: and(eq(queryLogs.id, input.queryLogId), eq(queryLogs.orgId, principal.orgId)),
  })
  if (!queryLog) throw new TRPCError({ code: 'NOT_FOUND', message: 'Query log not found' })
  if (queryLog.userId !== principal.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the submitter can acknowledge this query' })
  }
  if (queryLog.status !== 'AWAITING_ACKNOWLEDGMENT') {
    throw new TRPCError({ code: 'CONFLICT', message: `Query is not awaiting acknowledgment (status: ${queryLog.status})` })
  }

  const connection = await deps.db.query.databaseConnections.findFirst({
    where: and(eq(databaseConnections.id, queryLog.connectionId), eq(databaseConnections.orgId, principal.orgId)),
  })
  if (!connection) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Connection no longer exists' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'QUERY_ACKNOWLEDGED',
    resourceType: 'query_log',
    resourceId: queryLog.id,
    metadata: {},
  })

  const target: ConnectionTarget = {
    host: connection.host,
    port: connection.port,
    database: connection.database,
    ssl: connection.ssl,
    encryptedCredentials: connection.encryptedCredentials,
  }
  const jobResult = await deps.executionQueue.run({
    type: JOB_NAMES.EXECUTE_READ,
    connection: target,
    sql: queryLog.generatedSql,
    rowCap: queryLog.rowCap,
    maskedColumns: queryLog.maskedColumns,
  })

  let executionResult: QueryExecutionResult | null = null
  if (jobResult.success) {
    executionResult = {
      columns: jobResult.columns,
      rows: jobResult.rows,
      rowCount: jobResult.rowCount,
      truncated: jobResult.truncated,
      maskedColumns: jobResult.maskedColumns,
      executionMs: jobResult.executionMs,
    }
    await deps.db
      .update(queryLogs)
      .set({ status: 'EXECUTED', rowCount: jobResult.rowCount, executionMs: jobResult.executionMs, executedAt: new Date() })
      .where(eq(queryLogs.id, queryLog.id))
    await writeAuditLog(deps.db, {
      orgId: principal.orgId,
      actorId: principal.userId,
      action: 'QUERY_EXECUTED',
      resourceType: 'query_log',
      resourceId: queryLog.id,
      metadata: { rowCount: jobResult.rowCount },
    })
  } else {
    await deps.db
      .update(queryLogs)
      .set({ status: 'FAILED', errorMessage: jobResult.error })
      .where(eq(queryLogs.id, queryLog.id))
    await writeAuditLog(deps.db, {
      orgId: principal.orgId,
      actorId: principal.userId,
      action: 'QUERY_FAILED',
      resourceType: 'query_log',
      resourceId: queryLog.id,
      metadata: { error: jobResult.error },
    })
  }

  return {
    queryLogId: queryLog.id,
    riskLevel: queryLog.riskLevel,
    rewrittenSql: queryLog.generatedSql,
    explanation: '',
    requiresApproval: false,
    requiresAcknowledgment: false,
    approvalRequestId: null,
    violations: [],
    result: executionResult,
    simulation: queryLog.simulationResult ?? null,
  }
}

async function persistRejected(
  deps: QueryPipelineDeps,
  principal: SubmitQueryPrincipal,
  input: SubmitQueryInput,
  attemptedSql: string,
  reason: string,
): Promise<SubmitQueryResult> {
  const [queryLog] = await deps.db
    .insert(queryLogs)
    .values({
      orgId: principal.orgId,
      userId: principal.userId,
      connectionId: input.connectionId,
      naturalLanguage: input.naturalLanguage,
      generatedSql: attemptedSql || '(no SQL generated)',
      riskLevel: 'SECURITY_INCIDENT',
      riskReason: reason,
      status: 'FAILED',
      errorMessage: reason,
    })
    .returning()
  if (!queryLog) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'QUERY_SUBMITTED',
    resourceType: 'query_log',
    resourceId: queryLog.id,
    metadata: { riskLevel: 'SECURITY_INCIDENT', connectionId: input.connectionId },
  })
  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'SECURITY_INCIDENT_DETECTED',
    resourceType: 'query_log',
    resourceId: queryLog.id,
    metadata: { reason },
  })

  return {
    queryLogId: queryLog.id,
    riskLevel: 'SECURITY_INCIDENT',
    rewrittenSql: null,
    explanation: '',
    requiresApproval: false,
    requiresAcknowledgment: false,
    approvalRequestId: null,
    violations: [{ code: 'REJECTED', severity: 'error', message: reason }],
    result: null,
    simulation: null,
  }
}
