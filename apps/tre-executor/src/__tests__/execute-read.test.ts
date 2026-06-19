import { describe, it, expect } from 'vitest'
import { handleExecuteRead, maskRow } from '../lib/execute-read'
import { createFakeClient } from './fake-client'
import type { ConnectionTarget, ExecuteReadJobData } from '@repo/queue'

const connection: ConnectionTarget = {
  host: 'localhost',
  port: 5432,
  database: 'demo',
  ssl: false,
  encryptedCredentials: 'irrelevant-here',
}

function baseJob(overrides: Partial<ExecuteReadJobData> = {}): ExecuteReadJobData {
  return {
    type: 'execute_read',
    connection,
    sql: 'SELECT id, email FROM customers LIMIT 10',
    rowCap: 5,
    maskedColumns: [],
    ...overrides,
  }
}

function fakeCursorFactory(rows: Record<string, unknown>[]) {
  return () => ({
    read: async (maxRows: number) => rows.slice(0, maxRows),
    close: async () => {},
  })
}

describe('maskRow', () => {
  it('replaces masked columns with a sentinel value', () => {
    expect(maskRow({ id: '1', email: 'a@b.com' }, ['email'])).toEqual({ id: '1', email: '***MASKED***' })
  })

  it('leaves the row untouched when no columns are masked', () => {
    const row = { id: '1', email: 'a@b.com' }
    expect(maskRow(row, [])).toEqual(row)
  })

  it('ignores masked column names that are not present on the row', () => {
    expect(maskRow({ id: '1' }, ['ssn'])).toEqual({ id: '1' })
  })
})

describe('handleExecuteRead', () => {
  it('returns masked rows and reports no truncation when under the cap', async () => {
    const { client } = createFakeClient()
    const rows = [
      { id: '1', email: 'a@b.com' },
      { id: '2', email: 'c@d.com' },
    ]
    const result = await handleExecuteRead(baseJob({ maskedColumns: ['email'] }), () => client, fakeCursorFactory(rows))

    expect(result.success).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.rowCount).toBe(2)
    expect(result.rows.every((r) => r['email'] === '***MASKED***')).toBe(true)
  })

  it('truncates and reports it when more rows exist than the cap', async () => {
    const { client } = createFakeClient()
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i) })) // cap is 5, cursor returns 6 (cap+1)
    const result = await handleExecuteRead(baseJob({ rowCap: 5 }), () => client, fakeCursorFactory(rows))

    expect(result.truncated).toBe(true)
    expect(result.rowCount).toBe(5)
  })

  it('falls back to the default row cap when none is configured', async () => {
    const { client } = createFakeClient()
    const rows = [{ id: '1' }]
    const result = await handleExecuteRead(baseJob({ rowCap: null }), () => client, fakeCursorFactory(rows))
    expect(result.truncated).toBe(false)
    expect(result.rowCount).toBe(1)
  })

  it('runs the query inside a read-only transaction', async () => {
    const { client, queries } = createFakeClient()
    await handleExecuteRead(baseJob(), () => client, fakeCursorFactory([]))
    expect(queries.some((q) => q.includes('READ ONLY'))).toBe(true)
    expect(queries).toContain('ROLLBACK')
  })

  it('returns a failure result when the connection fails, never throwing', async () => {
    const { client } = createFakeClient({ failConnect: new Error('timeout') })
    const result = await handleExecuteRead(baseJob(), () => client, fakeCursorFactory([]))
    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
  })
})

describe('handleExecuteRead — explainOnly', () => {
  it('runs EXPLAIN instead of reading rows, and returns the estimated row count', async () => {
    const { client, queries } = createFakeClient({
      onQuery: (sql) =>
        sql.startsWith('EXPLAIN')
          ? { rows: [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan', 'Plan Rows': 42 } }] }] }
          : undefined,
    })
    const result = await handleExecuteRead(baseJob({ explainOnly: true }), () => client, fakeCursorFactory([]))

    expect(result.success).toBe(true)
    expect(result.rowCount).toBe(0)
    expect(result.rows).toEqual([])
    expect(result.estimatedRowCount).toBe(42)
    expect(result.plan).toContain('Seq Scan')
    expect(queries.some((q) => q.startsWith('EXPLAIN'))).toBe(true)
    expect(queries).toContain('ROLLBACK')
  })

  it('returns a null plan when EXPLAIN yields no rows', async () => {
    const { client } = createFakeClient()
    const result = await handleExecuteRead(baseJob({ explainOnly: true }), () => client, fakeCursorFactory([]))
    expect(result.success).toBe(true)
    expect(result.plan).toBeNull()
    expect(result.estimatedRowCount).toBeNull()
  })
})
