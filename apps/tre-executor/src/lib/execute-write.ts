import type { Client } from 'pg'
import type { ExecuteWriteJobData, ExecuteWriteJobResult } from '@repo/queue'
import { defaultClientFactory, type ClientFactory } from './pg-client'
import { env } from '../env'
import { logger } from '../logger'

function connectionContext(data: ExecuteWriteJobData) {
  return { host: data.connection.host, port: data.connection.port, database: data.connection.database, dryRun: data.dryRun }
}

export async function handleExecuteWrite(
  data: ExecuteWriteJobData,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<ExecuteWriteJobResult> {
  const start = Date.now()
  const client: Client = clientFactory(data.connection)

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
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const error = err instanceof Error ? err.message : 'Write execution failed'
    logger.error({ ...connectionContext(data), err: error }, 'execute_write failed')
    return {
      success: false,
      error,
      affectedRows: 0,
      previewRows: [],
      executionMs: Date.now() - start,
      committed: false,
    }
  } finally {
    await client.end().catch(() => {})
  }
}
