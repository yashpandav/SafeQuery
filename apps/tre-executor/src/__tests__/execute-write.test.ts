import { describe, it, expect } from 'vitest'
import { handleExecuteWrite } from '../lib/execute-write'
import { createFakeClient } from './fake-client'
import type { ConnectionTarget, ExecuteWriteJobData } from '@repo/queue'
import type { ClientFactory } from '../lib/pg-client'

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

function fakeClientFactory(opts: Parameters<typeof createFakeClient>[0] = {}): {
  factory: ClientFactory
  queries: string[]
} {
  const { client, queries } = createFakeClient(opts)
  const factory: ClientFactory = async () => ({ client, revokeOnDone: async () => { } })
  return { factory, queries }
}

describe('handleExecuteWrite', () => {
  it('dry run: rolls back and reports committed: false, lockConflict: false', async () => {
    const { factory, queries } = fakeClientFactory({
      onQuery: (sql) => (sql.includes('RETURNING') ? { rows: [{ id: 1, status: 'inactive' }], rowCount: 1 } : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: true }), factory)

    expect(result.success).toBe(true)
    expect(result.committed).toBe(false)
    expect(result.lockConflict).toBe(false)
    expect(result.affectedRows).toBe(1)
    expect(result.previewRows).toEqual([{ id: 1, status: 'inactive' }])
    expect(queries).toContain('ROLLBACK')
    expect(queries).not.toContain('COMMIT')
  })

  it('commit: commits and reports committed: true, lockConflict: false', async () => {
    const { factory, queries } = fakeClientFactory({
      onQuery: (sql) => (sql.includes('RETURNING') ? { rows: [{ id: 1 }], rowCount: 1 } : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: false }), factory)

    expect(result.success).toBe(true)
    expect(result.committed).toBe(true)
    expect(result.lockConflict).toBe(false)
    expect(queries).toContain('COMMIT')
    expect(queries).not.toContain('ROLLBACK')
  })

  it('appends RETURNING * to the validated SQL', async () => {
    const { factory, queries } = fakeClientFactory()
    await handleExecuteWrite(baseJob(), factory)
    expect(queries.some((q) => q === `${baseJob().sql} RETURNING *`)).toBe(true)
  })

  it('rolls back and reports failure on a generic error, lockConflict: false', async () => {
    const { factory, queries } = fakeClientFactory({
      failQuery: (sql) => (sql.includes('RETURNING') ? new Error('syntax error') : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: false }), factory)

    expect(result.success).toBe(false)
    expect(result.committed).toBe(false)
    expect(result.lockConflict).toBe(false)
    expect(result.error).toContain('syntax error')
    expect(queries).toContain('ROLLBACK')
  })

  it('sets lockConflict: true when Postgres error code is 55P03 (lock_not_available)', async () => {
    const lockError = Object.assign(new Error('could not obtain lock on row in relation "customers"'), { code: '55P03' })
    const { factory } = fakeClientFactory({
      failQuery: (sql) => (sql.includes('RETURNING') ? lockError : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: false }), factory)

    expect(result.success).toBe(false)
    expect(result.lockConflict).toBe(true)
  })

  it('sets lockConflict: true when Postgres error code is 40P01 (deadlock_detected)', async () => {
    const deadlockError = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    const { factory } = fakeClientFactory({
      failQuery: (sql) => (sql.includes('RETURNING') ? deadlockError : undefined),
    })
    const result = await handleExecuteWrite(baseJob({ dryRun: false }), factory)

    expect(result.success).toBe(false)
    expect(result.lockConflict).toBe(true)
  })

  it('sets statement_timeout and lock_timeout before running the write', async () => {
    const { factory, queries } = fakeClientFactory()
    await handleExecuteWrite(baseJob(), factory)
    expect(queries.some((q) => q.includes('statement_timeout'))).toBe(true)
    expect(queries.some((q) => q.includes('lock_timeout'))).toBe(true)
  })
})
