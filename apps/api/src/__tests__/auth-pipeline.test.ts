import { describe, it, expect, vi } from 'vitest'
import { auditLogs } from '@repo/db/schema'
import { logoutSession } from '../lib/auth-pipeline'
import { createMockDb } from './mock-db'
import type { SessionBlocklist } from '../lib/session-blocklist'

const USER_ID = 'user-1'
const SESSION_ID = 'session-abc-123'

function makeMockBlocklist(): { blocklist: SessionBlocklist; blocked: string[] } {
  const blocked: string[] = []
  const blocklist: SessionBlocklist = {
    block: vi.fn(async (id: string) => { blocked.push(id) }),
    isBlocked: vi.fn(async () => false),
  }
  return { blocklist, blocked }
}

describe('logoutSession', () => {
  it('blocks the session ID in the blocklist', async () => {
    const { blocklist, blocked } = makeMockBlocklist()
    const { db } = createMockDb({})

    await logoutSession({ db: db as never, blocklist }, USER_ID, SESSION_ID)

    expect(blocked).toContain(SESSION_ID)
  })

  it('writes USER_LOGOUT audit entry for each org membership', async () => {
    const { blocklist } = makeMockBlocklist()
    const { db, insertedByTable } = createMockDb({
      organizationMembersList: [{ orgId: 'org-1' }, { orgId: 'org-2' }],
    })

    await logoutSession({ db: db as never, blocklist }, USER_ID, SESSION_ID)

    const auditRows = insertedByTable.get(auditLogs) ?? []
    expect(auditRows.filter((r) => r.action === 'USER_LOGOUT')).toHaveLength(2)
    expect(auditRows.every((r) => r.action === 'USER_LOGOUT')).toBe(true)
  })

  it('writes no audit entries when the user has no org memberships', async () => {
    const { blocklist } = makeMockBlocklist()
    const { db, insertedByTable } = createMockDb({ organizationMembersList: [] })

    await logoutSession({ db: db as never, blocklist }, USER_ID, SESSION_ID)

    expect(insertedByTable.get(auditLogs) ?? []).toHaveLength(0)
  })

  it('always blocks before writing audit entries (blocklist is called first)', async () => {
    const callOrder: string[] = []
    const blocklist: SessionBlocklist = {
      block: vi.fn(async () => { callOrder.push('block') }),
      isBlocked: vi.fn(async () => false),
    }
    const { db } = createMockDb({ organizationMembersList: [{ orgId: 'org-1' }] })

    await logoutSession({ db: db as never, blocklist }, USER_ID, SESSION_ID)

    expect(callOrder[0]).toBe('block')
  })
})
