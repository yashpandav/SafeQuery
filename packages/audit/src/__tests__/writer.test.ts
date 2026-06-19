import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { writeAuditLog } from '../writer'
import { createFakeAuditDb } from './fake-db'
import type { WriteAuditLog } from '@repo/types'

const ORG_ID = 'org-1'
const USER_ID = 'user-1'

function entry(overrides: Partial<WriteAuditLog> = {}): WriteAuditLog {
  return {
    orgId: ORG_ID,
    actorId: USER_ID,
    action: 'QUERY_SUBMITTED',
    resourceType: 'query_log',
    resourceId: 'query-1',
    metadata: { riskLevel: 'SAFE' },
    ...overrides,
  }
}

function canonicalOf(e: WriteAuditLog): string {
  return JSON.stringify({
    orgId: e.orgId,
    actorId: e.actorId,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId ?? null,
    metadata: e.metadata,
  })
}

describe('writeAuditLog', () => {
  it('the first entry in an org chains from null — hash = sha256("" + canonical(entry))', async () => {
    const { db, rows } = createFakeAuditDb()
    const e = entry()
    await writeAuditLog(db as never, e)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.prevHash).toBeNull()
    expect(rows[0]?.hash).toBe(createHash('sha256').update(canonicalOf(e)).digest('hex'))
  })

  it('a second entry chains its prevHash from the first entry\'s hash', async () => {
    const { db, rows } = createFakeAuditDb()
    await writeAuditLog(db as never, entry({ action: 'QUERY_SUBMITTED' }))
    const second = entry({ action: 'QUERY_EXECUTED', metadata: { rowCount: 5 } })
    await writeAuditLog(db as never, second)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash)
    expect(rows[1]?.hash).toBe(createHash('sha256').update((rows[0]?.hash ?? '') + canonicalOf(second)).digest('hex'))
    expect(rows[1]?.hash).not.toBe(rows[0]?.hash)
  })

  it('two entries with identical fields still produce different hashes once chained (prevHash differs)', async () => {
    const { db, rows } = createFakeAuditDb()
    const repeated = entry()
    await writeAuditLog(db as never, repeated)
    await writeAuditLog(db as never, repeated)

    expect(rows[0]?.hash).not.toBe(rows[1]?.hash)
  })

  it('persists resourceId as null when the entry has none', async () => {
    const { db, rows } = createFakeAuditDb()
    await writeAuditLog(db as never, entry({ resourceId: null }))
    expect(rows[0]?.resourceId).toBeNull()
  })
})
