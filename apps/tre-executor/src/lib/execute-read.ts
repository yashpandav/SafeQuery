import type { Client } from 'pg'
import Cursor from 'pg-cursor'
import type { ExecuteReadJobData, ExecuteReadJobResult } from '@repo/queue'
import { defaultClientFactory, type ClientFactory } from './pg-client'
import { env } from '../env'
import { logger } from '../logger'

function connectionContext(data: ExecuteReadJobData) {
  return { host: data.connection.host, port: data.connection.port, database: data.connection.database, explainOnly: Boolean(data.explainOnly) }
}

const MASK_VALUE = '***MASKED***'
export function maskRow(row: Record<string, unknown>, maskedColumns: string[]): Record<string, unknown> {
  if (maskedColumns.length === 0) return row
  const masked = { ...row }
  for (const column of maskedColumns) {
    if (column in masked) masked[column] = MASK_VALUE
  }
  return masked
}

export interface CursorLike {
  read(maxRows: number): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}
export type CursorFactory = (client: Client, sql: string) => CursorLike

const defaultCursorFactory: CursorFactory = (client, sql) => client.query(new Cursor(sql))

export async function handleExecuteRead(
  data: ExecuteReadJobData,
  clientFactory: ClientFactory = defaultClientFactory,
  cursorFactory: CursorFactory = defaultCursorFactory,
): Promise<ExecuteReadJobResult> {
  const start = Date.now()
  const client: Client = clientFactory(data.connection)
  const rowCap = data.rowCap ?? env.DEFAULT_ROW_CAP

  try {
    await client.connect()
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${env.STATEMENT_TIMEOUT_MS}`)

    if (data.explainOnly) {
      const explainResult = await client.query(`EXPLAIN (FORMAT JSON) ${data.sql}`)
      await client.query('ROLLBACK')
      const plan = extractPlanRoot(explainResult.rows[0])
      const estimatedRowCount = typeof plan?.['Plan Rows'] === 'number' ? plan['Plan Rows'] : null
      const executionMs = Date.now() - start
      logger.info({ ...connectionContext(data), estimatedRowCount, executionMs }, 'execute_read (explain) completed')
      return {
        success: true,
        error: null,
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        maskedColumns: data.maskedColumns,
        executionMs,
        plan: plan ? JSON.stringify(plan) : null,
        estimatedRowCount,
      }
    }

    const cursor = cursorFactory(client, data.sql)
    const rows = await cursor.read(rowCap + 1)
    await cursor.close()
    await client.query('ROLLBACK') // read-only — nothing was ever going to commit

    const truncated = rows.length > rowCap
    const limitedRows = truncated ? rows.slice(0, rowCap) : rows
    const maskedRows = limitedRows.map((row) => maskRow(row, data.maskedColumns))
    const columns = maskedRows[0] ? Object.keys(maskedRows[0]) : []

    const executionMs = Date.now() - start
    logger.info({ ...connectionContext(data), rowCount: maskedRows.length, truncated, executionMs }, 'execute_read completed')
    return {
      success: true,
      error: null,
      columns,
      rows: maskedRows,
      rowCount: maskedRows.length,
      truncated,
      maskedColumns: data.maskedColumns,
      executionMs,
      plan: null,
      estimatedRowCount: null,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Query execution failed'
    logger.error({ ...connectionContext(data), err: error }, 'execute_read failed')
    return {
      success: false,
      error,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      maskedColumns: data.maskedColumns,
      executionMs: Date.now() - start,
      plan: null,
      estimatedRowCount: null,
    }
  } finally {
    await client.end().catch(() => {})
  }
}

function extractPlanRoot(explainRow: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const queryPlan = explainRow?.['QUERY PLAN']
  if (!Array.isArray(queryPlan)) return null
  const entry = queryPlan[0] as { Plan?: Record<string, unknown> } | undefined
  return entry?.Plan ?? null
}
