import { describe, it, expect } from 'vitest'
import { writeAuditLog } from '../writer'
import { verifyIntegrity } from '../verify'
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
    metadata: {},
    ...overrides,
  }
}

describe('verifyIntegrity', () => {
  it('passes on an untouched chain built through writeAuditLog', async () => {
    const { db } = createFakeAuditDb()
    await writeAuditLog(db as never, entry({ action: 'QUERY_SUBMITTED' }))
    await writeAuditLog(db as never, entry({ action: 'QUERY_EXECUTED', metadata: { rowCount: 3 } }))
    await writeAuditLog(db as never, entry({ action: 'APPROVAL_REQUESTED' }))

    const result = await verifyIntegrity(db as never, ORG_ID)
    expect(result).toEqual({ valid: true, checkedCount: 3 })
  })

  it('passes vacuously on an org with no entries', async () => {
    const { db } = createFakeAuditDb()
    const result = await verifyIntegrity(db as never, ORG_ID)
    expect(result).toEqual({ valid: true, checkedCount: 0 })
  })

  it('detects a tampered metadata field and reports the first mismatched row', async () => {
    const { db, rows } = createFakeAuditDb()
    await writeAuditLog(db as never, entry({ action: 'QUERY_SUBMITTED' }))
    await writeAuditLog(db as never, entry({ action: 'QUERY_EXECUTED', metadata: { rowCount: 3 } }))
    await writeAuditLog(db as never, entry({ action: 'APPROVAL_REQUESTED' }))

    const tamperedRow = rows[1]
    if (!tamperedRow) throw new Error('expected row 1 to exist')
    tamperedRow.metadata = { rowCount: 999 }

    const result = await verifyIntegrity(db as never, ORG_ID)
    expect(result.valid).toBe(false)
    expect(result.firstMismatchIndex).toBe(1)
    expect(result.firstMismatchId).toBe(tamperedRow.id)
    expect(result.checkedCount).toBe(2) // stops at the first mismatch, doesn't keep scanning
  })

  it('detects a hash directly overwritten to mask tampering', async () => {
    const { db, rows } = createFakeAuditDb()
    await writeAuditLog(db as never, entry())
    await writeAuditLog(db as never, entry())

    const tamperedRow = rows[0]
    if (!tamperedRow) throw new Error('expected row 0 to exist')
    tamperedRow.hash = 'deadbeef'.repeat(8)

    const result = await verifyIntegrity(db as never, ORG_ID)
    expect(result.valid).toBe(false)
    expect(result.firstMismatchIndex).toBe(0)
  })
})
