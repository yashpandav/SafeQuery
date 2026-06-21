import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { databaseConnections, environments, schemaSnapshots } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkDatabaseConnection } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import { JOB_NAMES } from '@repo/queue'
import type { CreateDatabaseConnection, DatabaseConnectionMetadata, PlatformRole } from '@repo/types'
import type { ExecutionQueueClient } from './query-pipeline'

export interface ConnectionPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
  executionQueue: ExecutionQueueClient
}

export interface ConnectionPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

function toCerbosPrincipal(principal: ConnectionPrincipal): CerbosPrincipal {
  return { userId: principal.userId, orgId: principal.orgId, platformRole: principal.platformRole }
}

function toMetadata(row: typeof databaseConnections.$inferSelect): DatabaseConnectionMetadata {
  return {
    id: row.id,
    orgId: row.orgId,
    environmentId: row.environmentId,
    name: row.name,
    host: row.host,
    port: row.port,
    database: row.database,
    ssl: row.ssl,
    createdAt: row.createdAt,
  }
}
export async function createConnection(
  deps: ConnectionPipelineDeps,
  principal: ConnectionPrincipal,
  input: CreateDatabaseConnection,
): Promise<DatabaseConnectionMetadata> {
  const allowed = await checkDatabaseConnection(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'new', orgId: principal.orgId }, [
    'create',
  ])
  if (!allowed.create) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to create database connections' })
  }

  const environment = await deps.db.query.environments.findFirst({
    where: and(eq(environments.id, input.environmentId), eq(environments.orgId, principal.orgId)),
  })
  if (!environment) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' })
  }

  const testResult = await deps.executionQueue.run({
    type: JOB_NAMES.TEST_CONNECTION,
    host: input.host,
    port: input.port,
    database: input.database,
    ssl: input.ssl,
    username: input.username,
    password: input.password,
  })

  if (!testResult.success || !testResult.encryptedCredentials) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Connectivity test failed: ${testResult.error ?? 'unknown error'}` })
  }

  const [connection] = await deps.db
    .insert(databaseConnections)
    .values({
      orgId: principal.orgId,
      environmentId: input.environmentId,
      name: input.name,
      host: input.host,
      port: input.port,
      database: input.database,
      ssl: input.ssl,
      encryptedCredentials: testResult.encryptedCredentials,
    })
    .returning()
  if (!connection) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'DB_CONNECTION_CREATED',
    resourceType: 'database_connection',
    resourceId: connection.id,
    metadata: { name: input.name },
  })

  return toMetadata(connection)
}
export async function listConnections(deps: ConnectionPipelineDeps, principal: ConnectionPrincipal): Promise<DatabaseConnectionMetadata[]> {
  const rows = await deps.db.query.databaseConnections.findMany({
    where: eq(databaseConnections.orgId, principal.orgId),
  })
  return rows.map(toMetadata)
}

export interface CaptureSchemaResult {
  tableCount: number
}
export async function captureSchema(
  deps: ConnectionPipelineDeps,
  principal: ConnectionPrincipal,
  connectionId: string,
): Promise<CaptureSchemaResult> {
  const allowed = await checkDatabaseConnection(deps.cerbosClient, toCerbosPrincipal(principal), { id: connectionId, orgId: principal.orgId }, [
    'read',
  ])
  if (!allowed.read) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to capture schema for this connection' })
  }

  const connection = await deps.db.query.databaseConnections.findFirst({
    where: and(eq(databaseConnections.id, connectionId), eq(databaseConnections.orgId, principal.orgId)),
  })
  if (!connection) throw new TRPCError({ code: 'NOT_FOUND', message: 'Database connection not found' })

  const result = await deps.executionQueue.run({
    type: JOB_NAMES.CAPTURE_SCHEMA,
    connection: {
      host: connection.host,
      port: connection.port,
      database: connection.database,
      ssl: connection.ssl,
      encryptedCredentials: connection.encryptedCredentials,
    },
  })

  if (!result.success || !result.snapshot) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Schema discovery failed: ${result.error ?? 'unknown error'}` })
  }

  await deps.db.insert(schemaSnapshots).values({
    connectionId,
    orgId: principal.orgId,
    snapshot: result.snapshot,
  })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'DB_CONNECTION_UPDATED',
    resourceType: 'database_connection',
    resourceId: connectionId,
    metadata: { tableCount: Object.keys(result.snapshot).length },
  })

  return { tableCount: Object.keys(result.snapshot).length }
}
