import { describe, it, expect } from 'vitest'
import { handleExecuteWrite } from '../lib/execute-write'
import { createFakeClient } from './fake-client'
import type { ConnectionTarget, ExecuteWriteJobData } from '@repo/queue'

const connection: ConnectionTarget = {
  host: 'localhost',
  port: 5432,
  database: 'demo',
  ssl: false,
  encryptedCredentials: 'irrelevant-here',
}

function baseJob(overrides: Partial<ExecuteWriteJobData> = {}): ExecuteWriteJobData {
  return {
    type: 'execute_write',
    orgId: 'org-1',
    connection,
    sql: "UPDATE customers SET status = 'inactive' WHERE id = 1",
    dryRun: true,
    ...overrides,
  }
}

describe('handleExecuteWrite', () => {
  it('dry run: rolls back and reports committed: false', async () => {
    const { client, queries } = createFakeClient({
      onQuery: (sql) => (sql.includes('RETURNING') ? { rows: [{ id: 1, status: 'inactive' }], rowCount: 1 } : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: true }), () => client)

    expect(result.success).toBe(true)
    expect(result.committed).toBe(false)
    expect(result.affectedRows).toBe(1)
    expect(result.previewRows).toEqual([{ id: 1, status: 'inactive' }])
    expect(queries).toContain('ROLLBACK')
    expect(queries).not.toContain('COMMIT')
  })

  it('commit: commits and reports committed: true', async () => {
    const { client, queries } = createFakeClient({
      onQuery: (sql) => (sql.includes('RETURNING') ? { rows: [{ id: 1 }], rowCount: 1 } : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: false }), () => client)

    expect(result.success).toBe(true)
    expect(result.committed).toBe(true)
    expect(queries).toContain('COMMIT')
    expect(queries).not.toContain('ROLLBACK')
  })

  it('appends RETURNING * to the validated SQL', async () => {
    const { client, queries } = createFakeClient()
    await handleExecuteWrite(baseJob(), () => client)
    expect(queries.some((q) => q === `${baseJob().sql} RETURNING *`)).toBe(true)
  })

  it('rolls back and reports failure on a query error, never throwing', async () => {
    const { client, queries } = createFakeClient({
      failQuery: (sql) => (sql.includes('RETURNING') ? new Error('deadlock detected') : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: false }), () => client)

    expect(result.success).toBe(false)
    expect(result.committed).toBe(false)
    expect(result.error).toContain('deadlock detected')
    expect(queries).toContain('ROLLBACK')
  })

  it('sets statement_timeout and lock_timeout before running the write', async () => {
    const { client, queries } = createFakeClient()
    await handleExecuteWrite(baseJob(), () => client)
    expect(queries.some((q) => q.includes('statement_timeout'))).toBe(true)
    expect(queries.some((q) => q.includes('lock_timeout'))).toBe(true)
  })
})
