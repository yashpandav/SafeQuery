import type { ExecuteWriteJobData, ExecuteWriteJobResult } from '@repo/queue'
import { defaultClientFactory, type ClientFactory } from './pg-client'
import { env } from '../env'
import { logger } from '../logger'

const LOCK_CONFLICT_CODES = new Set([
  '55P03',
  '40P01',
])

function isLockConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    LOCK_CONFLICT_CODES.has((err as { code: unknown }).code as string)
  )
}

function connectionContext(data: ExecuteWriteJobData) {
  return { host: data.connection.host, port: data.connection.port, database: data.connection.database, dryRun: data.dryRun }
}

export async function handleExecuteWrite(
  data: ExecuteWriteJobData,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<ExecuteWriteJobResult> {
  const start = Date.now()
  const { client, revokeOnDone } = await clientFactory(data.connection, 'write')

  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${env.STATEMENT_TIMEOUT_MS}`)
    await client.query(`SET LOCAL lock_timeout = ${env.LOCK_TIMEOUT_MS}`)

    const result = await client.query(`${data.sql} RETURNING *`)
    await client.query(data.dryRun ? 'ROLLBACK' : 'COMMIT')

    const executionMs = Date.now() - start
    logger.info({ ...connectionContext(data), affectedRows: result.rowCount ?? 0, executionMs }, 'execute_write completed')
    return {
      success: true,
      error: null,
      affectedRows: result.rowCount ?? 0,
      previewRows: result.rows,
      executionMs,
      committed: !data.dryRun,
      lockConflict: false,
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { })
    const lockConflict = isLockConflict(err)
    const error = err instanceof Error ? err.message : 'Write execution failed'
    logger.error({ ...connectionContext(data), err: error, lockConflict }, 'execute_write failed')
    return {
      success: false,
      error,
      affectedRows: 0,
      previewRows: [],
      executionMs: Date.now() - start,
      committed: false,
      lockConflict,
    }
  } finally {
    await client.end().catch(() => { })
    await revokeOnDone().catch(() => { })
  }
}
