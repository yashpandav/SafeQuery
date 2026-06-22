import { describe, it, expect } from 'vitest'
import { invitations, organizationMembers, auditLogs } from '@repo/db/schema'
import {
  listInvitations,
  createInvitation,
  revokeInvitation,
  acceptPendingInvitations,
  type InvitationPrincipal,
} from '../lib/invitation-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'
const USER_ID = 'user-1'
const INVITATION_ID = 'invite-1'
const ROLE_ID = 'role-1'
const OTHER_ORG_ROLE_ID = 'role-other-org'

const admin: InvitationPrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: InvitationPrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

function createAdminOnlyCerbosClient(): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const isAdmin = req.principal.id === ADMIN_ID
      const results = req.resources.map(({ resource, actions }) => {
        const actionsMap: Record<string, boolean> = {}
        for (const action of actions) actionsMap[action] = isAdmin
        return { resourceId: resource.id, isAllowed: (action: string) => actionsMap[action] ?? false }
      })
      return {
        isAllowed({ resource, action }: { resource: { kind: string; id: string }; action: string }) {
          return results.find((r) => r.resourceId === resource.id)?.isAllowed(action)
        },
        findResult: () => undefined,
      }
    },
  }
}

describe('createInvitation', () => {
  it('persists the invitation lowercased, with a 7-day expiry, and audits it', async () => {
    const { db, insertedByTable } = createMockDb({})
    const before = Date.now()

    const result = await createInvitation({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, {
      email: 'New.Hire@Example.com',
      platformRole: 'analyst',
    })

    expect(result.email).toBe('new.hire@example.com')
    expect(result.expired).toBe(false)
    expect(result.expiresAt.getTime() - before).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(insertedByTable.get(invitations)?.[0]).toMatchObject({ orgId: ORG_ID, email: 'new.hire@example.com', platformRole: 'analyst' })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['USER_INVITED'])
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      createInvitation({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst, { email: 'x@example.com', platformRole: 'viewer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('persists a customRoleId and includes it in the audit metadata', async () => {
    const fixtures: MockDbFixtures = {
      customRoles: { id: ROLE_ID, orgId: ORG_ID, name: 'dev', description: null, config: {}, createdAt: new Date(), updatedAt: new Date() },
    }
    const { db, insertedByTable } = createMockDb(fixtures)

    const result = await createInvitation({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, {
      email: 'new.hire@example.com',
      platformRole: 'analyst',
      customRoleId: ROLE_ID,
    })

    expect(result.customRoleId).toBe(ROLE_ID)
    expect(insertedByTable.get(invitations)?.[0]).toMatchObject({ customRoleId: ROLE_ID })
    expect(insertedByTable.get(auditLogs)?.[0]).toMatchObject({ metadata: { customRoleId: ROLE_ID } })
  })

  it('rejects a customRoleId from a different org with NOT_FOUND', async () => {
    const fixtures: MockDbFixtures = { customRoles: undefined }
    const { db } = createMockDb(fixtures)

    await expect(
      createInvitation({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, {
        email: 'new.hire@example.com',
        platformRole: 'analyst',
        customRoleId: OTHER_ORG_ROLE_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('listInvitations', () => {
  it('flags invitations past their expiry as expired', async () => {
    const fixtures: MockDbFixtures = {
      invitationsList: [
        { id: 'i1', orgId: ORG_ID, email: 'a@example.com', platformRole: 'analyst', expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() },
        { id: 'i2', orgId: ORG_ID, email: 'b@example.com', platformRole: 'viewer', expiresAt: new Date(Date.now() - 60_000), createdAt: new Date() },
      ],
    }
    const { db } = createMockDb(fixtures)
    const result = await listInvitations({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)

    expect(result.find((i) => i.id === 'i1')?.expired).toBe(false)
    expect(result.find((i) => i.id === 'i2')?.expired).toBe(true)
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      listInvitations({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('revokeInvitation', () => {
  function fixtures(): MockDbFixtures {
    return { invitations: { id: INVITATION_ID, orgId: ORG_ID, email: 'a@example.com', platformRole: 'analyst', expiresAt: new Date(), createdAt: new Date() } }
  }

  it('deletes the invitation and audits it', async () => {
    const { db, deletedByTable, insertedByTable } = createMockDb(fixtures())
    const result = await revokeInvitation({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { invitationId: INVITATION_ID })

    expect(result).toEqual({ id: INVITATION_ID })
    expect(deletedByTable.get(invitations)).toHaveLength(1)
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['INVITATION_REVOKED'])
  })

  it('rejects when the invitation does not exist in this org', async () => {
    const { db } = createMockDb({ invitations: undefined })
    await expect(
      revokeInvitation({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { invitationId: INVITATION_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb(fixtures())
    await expect(
      revokeInvitation({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst, { invitationId: INVITATION_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('acceptPendingInvitations', () => {
  it('joins the user to every org with a still-valid invitation matching their email, and consumes each one', async () => {
    const fixtures: MockDbFixtures = {
      invitationsList: [
        { id: 'i1', orgId: 'org-a', email: 'me@example.com', platformRole: 'analyst', expiresAt: new Date(Date.now() + 60_000) },
        { id: 'i2', orgId: 'org-b', email: 'me@example.com', platformRole: 'viewer', expiresAt: new Date(Date.now() + 60_000) },
      ],
      organizationMembersList: [],
    }
    const { db, insertedByTable, deletedByTable } = createMockDb(fixtures)

    await acceptPendingInvitations({ db: db as never }, USER_ID, 'ME@Example.com')

    expect(insertedByTable.get(organizationMembers)).toHaveLength(2)
    expect(insertedByTable.get(organizationMembers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orgId: 'org-a', userId: USER_ID, platformRole: 'analyst' }),
        expect.objectContaining({ orgId: 'org-b', userId: USER_ID, platformRole: 'viewer' }),
      ]),
    )
    expect(deletedByTable.get(invitations)).toHaveLength(2)
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['MEMBER_ADDED', 'MEMBER_ADDED'])
  })

  it('propagates customRoleId from the invitation onto the new membership row', async () => {
    const fixtures: MockDbFixtures = {
      invitationsList: [
        { id: 'i1', orgId: 'org-a', email: 'me@example.com', platformRole: 'analyst', customRoleId: ROLE_ID, expiresAt: new Date(Date.now() + 60_000) },
      ],
      organizationMembersList: [],
    }
    const { db, insertedByTable } = createMockDb(fixtures)

    await acceptPendingInvitations({ db: db as never }, USER_ID, 'me@example.com')

    expect(insertedByTable.get(organizationMembers)).toEqual(
      expect.arrayContaining([expect.objectContaining({ orgId: 'org-a', userId: USER_ID, platformRole: 'analyst', customRoleId: ROLE_ID })]),
    )
  })

  it('ignores expired invitations', async () => {
    const fixtures: MockDbFixtures = {
      invitationsList: [{ id: 'i1', orgId: 'org-a', email: 'me@example.com', platformRole: 'analyst', expiresAt: new Date(Date.now() - 60_000) }],
      organizationMembersList: [],
    }
    const { db, insertedByTable, deletedByTable } = createMockDb(fixtures)

    await acceptPendingInvitations({ db: db as never }, USER_ID, 'me@example.com')

    expect(insertedByTable.get(organizationMembers)).toBeUndefined()
    expect(deletedByTable.get(invitations)).toBeUndefined()
  })

  it('consumes the invitation without re-inserting membership when already a member of that org', async () => {
    const fixtures: MockDbFixtures = {
      invitationsList: [{ id: 'i1', orgId: 'org-a', email: 'me@example.com', platformRole: 'analyst', expiresAt: new Date(Date.now() + 60_000) }],
      organizationMembersList: [{ orgId: 'org-a', userId: USER_ID, platformRole: 'admin' }],
    }
    const { db, insertedByTable, deletedByTable } = createMockDb(fixtures)

    await acceptPendingInvitations({ db: db as never }, USER_ID, 'me@example.com')

    expect(insertedByTable.get(organizationMembers)).toBeUndefined()
    expect(deletedByTable.get(invitations)).toHaveLength(1)
  })

  it('does nothing when there are no matching invitations', async () => {
    const { db, insertedByTable } = createMockDb({ invitationsList: [], organizationMembersList: [] })
    await acceptPendingInvitations({ db: db as never }, USER_ID, 'nobody@example.com')
    expect(insertedByTable.get(organizationMembers)).toBeUndefined()
  })
})
