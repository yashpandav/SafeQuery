import type { Client } from 'pg'
import type { ExecuteWriteJobData, ExecuteWriteJobResult } from '@repo/queue'
import { defaultClientFactory, type ClientFactory } from './pg-client'
import { env } from '../env'
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

    return {
      success: true,
      error: null,
      affectedRows: result.rowCount ?? 0,
      previewRows: result.rows,
      executionMs: Date.now() - start,
      committed: !data.dryRun,
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Write execution failed',
      affectedRows: 0,
      previewRows: [],
      executionMs: Date.now() - start,
      committed: false,
    }
  } finally {
    await client.end().catch(() => {})
  }
}
