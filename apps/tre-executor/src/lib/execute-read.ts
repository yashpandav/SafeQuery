import type { Client } from 'pg'
import Cursor from 'pg-cursor'
import type { ExecuteReadJobData, ExecuteReadJobResult } from '@repo/queue'
import { defaultClientFactory, type ClientFactory } from './pg-client'
import { env } from '../env'

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

    const cursor = cursorFactory(client, data.sql)
    const rows = await cursor.read(rowCap + 1)
    await cursor.close()
    await client.query('ROLLBACK') // read-only — nothing was ever going to commit

    const truncated = rows.length > rowCap
    const limitedRows = truncated ? rows.slice(0, rowCap) : rows
    const maskedRows = limitedRows.map((row) => maskRow(row, data.maskedColumns))
    const columns = maskedRows[0] ? Object.keys(maskedRows[0]) : []

    return {
      success: true,
      error: null,
      columns,
      rows: maskedRows,
      rowCount: maskedRows.length,
      truncated,
      maskedColumns: data.maskedColumns,
      executionMs: Date.now() - start,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Query execution failed',
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      maskedColumns: data.maskedColumns,
      executionMs: Date.now() - start,
    }
  } finally {
    await client.end().catch(() => {})
  }
}
