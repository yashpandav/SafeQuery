import { describe, it, expect } from 'vitest'
import { organizationMembers, auditLogs } from '@repo/db/schema'
import {
  listMembers,
  updateMemberRole,
  removeMember,
  type MemberPrincipal,
} from '../lib/member-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'
const MEMBER_ID = 'member-1'
const ROLE_ID = 'role-1'
const OTHER_ORG_ROLE_ID = 'role-other-org'

const admin: MemberPrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: MemberPrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

// Mirrors organization_member.yaml: only same_org_admin gets any action.
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
        findResult(resource: { kind: string; id: string }): CerbosCheckResourceResult | undefined {
          const match = results.find((r) => r.resourceId === resource.id)
          return match ? { outputs: [] } : undefined
        },
      }
    },
  }
}

describe('listMembers', () => {
  it('returns members joined with user email/name and custom role name', async () => {
    const fixtures: MockDbFixtures = {
      organizationMembersList: [
        { orgId: ORG_ID, userId: 'u1', platformRole: 'admin', customRoleId: ROLE_ID, createdAt: new Date('2024-01-01') },
        { orgId: ORG_ID, userId: 'u2', platformRole: 'analyst', customRoleId: null, createdAt: new Date('2024-01-02') },
      ],
      usersList: [
        { id: 'u1', email: 'alice@example.com', name: 'Alice' },
        { id: 'u2', email: 'bob@example.com', name: 'Bob' },
      ],
      customRolesList: [{ id: ROLE_ID, orgId: ORG_ID, name: 'dev', description: null, config: {}, createdAt: new Date(), updatedAt: new Date() }],
    }
    const { db } = createMockDb(fixtures)
    const result = await listMembers({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)

    expect(result).toHaveLength(2)
    const alice = result.find((m) => m.userId === 'u1')
    expect(alice).toMatchObject({ email: 'alice@example.com', name: 'Alice', platformRole: 'admin', customRoleId: ROLE_ID, customRoleName: 'dev' })
    const bob = result.find((m) => m.userId === 'u2')
    expect(bob).toMatchObject({ email: 'bob@example.com', name: 'Bob', platformRole: 'analyst', customRoleId: null, customRoleName: null })
    // sorted by email ascending
    expect(result.map((m) => m.email)).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      listMembers({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('updateMemberRole', () => {
  function fixtures(overrides: Partial<{ platformRole: string; customRoleId: string | null }> = {}): MockDbFixtures {
    return {
      organizationMembers: {
        orgId: ORG_ID,
        userId: MEMBER_ID,
        platformRole: overrides.platformRole ?? 'analyst',
        customRoleId: overrides.customRoleId ?? null,
        createdAt: new Date('2024-01-01'),
      },
      usersList: [{ id: MEMBER_ID, email: 'member@example.com', name: 'Member' }],
      customRoles: { id: ROLE_ID, orgId: ORG_ID, name: 'dev', description: null, config: {}, createdAt: new Date(), updatedAt: new Date() },
      customRolesList: [{ id: ROLE_ID, orgId: ORG_ID, name: 'dev', description: null, config: {}, createdAt: new Date(), updatedAt: new Date() }],
    }
  }

  it('successfully changes platformRole', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(fixtures())
    const result = await updateMemberRole(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { userId: MEMBER_ID, platformRole: 'reviewer' },
    )

    expect(result.platformRole).toBe('reviewer')
    expect(updatedByTable.get(organizationMembers)?.[0]).toMatchObject({ platformRole: 'reviewer' })
    const auditEntry = insertedByTable.get(auditLogs)?.[0]
    expect(auditEntry?.action).toBe('MEMBER_ROLE_CHANGED')
    expect(auditEntry?.metadata).toMatchObject({ previousPlatformRole: 'analyst', newPlatformRole: 'reviewer' })
  })

  it('successfully reassigns customRoleId', async () => {
    const { db } = createMockDb(fixtures())
    const result = await updateMemberRole(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { userId: MEMBER_ID, customRoleId: ROLE_ID },
    )

    expect(result.customRoleId).toBe(ROLE_ID)
    expect(result.customRoleName).toBe('dev')
  })

  it('successfully clears customRoleId when set to null explicitly', async () => {
    const { db } = createMockDb(fixtures({ customRoleId: ROLE_ID }))
    const result = await updateMemberRole(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { userId: MEMBER_ID, customRoleId: null },
    )

    expect(result.customRoleId).toBeNull()
    expect(result.customRoleName).toBeNull()
  })

  it('rejects a customRoleId belonging to a different org with NOT_FOUND', async () => {
    // The mock db's findFirst doesn't filter by `where` — simulate "role belongs to a
    // different org" the same way updateCustomRole's own NOT_FOUND test does: the
    // org-scoped lookup simply finds nothing.
    const { db } = createMockDb({ ...fixtures(), customRoles: undefined })
    await expect(
      updateMemberRole(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
        admin,
        { userId: MEMBER_ID, customRoleId: OTHER_ORG_ROLE_ID },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects demoting the sole remaining owner with CONFLICT', async () => {
    const { db } = createMockDb({
      ...fixtures({ platformRole: 'owner' }),
      organizationMembersList: [{ orgId: ORG_ID, userId: MEMBER_ID, platformRole: 'owner', customRoleId: null, createdAt: new Date() }],
    })
    await expect(
      updateMemberRole(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
        admin,
        { userId: MEMBER_ID, platformRole: 'admin' },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('allows demoting an owner when a second owner exists', async () => {
    const { db } = createMockDb({
      ...fixtures({ platformRole: 'owner' }),
      organizationMembersList: [
        { orgId: ORG_ID, userId: MEMBER_ID, platformRole: 'owner', customRoleId: null, createdAt: new Date() },
        { orgId: ORG_ID, userId: ADMIN_ID, platformRole: 'owner', customRoleId: null, createdAt: new Date() },
      ],
    })
    const result = await updateMemberRole(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { userId: MEMBER_ID, platformRole: 'admin' },
    )
    expect(result.platformRole).toBe('admin')
  })

  it('returns NOT_FOUND when the membership does not exist', async () => {
    const { db } = createMockDb({ organizationMembers: undefined })
    await expect(
      updateMemberRole(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
        admin,
        { userId: MEMBER_ID, platformRole: 'admin' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb(fixtures())
    await expect(
      updateMemberRole(
        { db: db as never, cerbosClient: createAdminOnlyCerbosClient() },
        analyst,
        { userId: MEMBER_ID, platformRole: 'admin' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('removeMember', () => {
  function fixtures(platformRole = 'analyst'): MockDbFixtures {
    return {
      organizationMembers: { orgId: ORG_ID, userId: MEMBER_ID, platformRole, customRoleId: null, createdAt: new Date() },
    }
  }

  it('successfully removes a member and audits it', async () => {
    const { db, deletedByTable, insertedByTable } = createMockDb(fixtures())
    const result = await removeMember({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { userId: MEMBER_ID })

    expect(result).toEqual({ userId: MEMBER_ID })
    expect(deletedByTable.get(organizationMembers)).toHaveLength(1)
    const auditEntry = insertedByTable.get(auditLogs)?.[0]
    expect(auditEntry?.action).toBe('MEMBER_REMOVED')
    expect(auditEntry?.metadata).toMatchObject({ platformRole: 'analyst' })
  })

  it('rejects removing the sole remaining owner with CONFLICT', async () => {
    const { db } = createMockDb({
      ...fixtures('owner'),
      organizationMembersList: [{ orgId: ORG_ID, userId: MEMBER_ID, platformRole: 'owner', customRoleId: null, createdAt: new Date() }],
    })
    await expect(
      removeMember({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { userId: MEMBER_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('allows removing an owner when a second owner exists', async () => {
    const { db, deletedByTable } = createMockDb({
      ...fixtures('owner'),
      organizationMembersList: [
        { orgId: ORG_ID, userId: MEMBER_ID, platformRole: 'owner', customRoleId: null, createdAt: new Date() },
        { orgId: ORG_ID, userId: ADMIN_ID, platformRole: 'owner', customRoleId: null, createdAt: new Date() },
      ],
    })
    const result = await removeMember({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { userId: MEMBER_ID })
    expect(result).toEqual({ userId: MEMBER_ID })
    expect(deletedByTable.get(organizationMembers)).toHaveLength(1)
  })

  it('returns NOT_FOUND when the membership does not exist', async () => {
    const { db } = createMockDb({ organizationMembers: undefined })
    await expect(
      removeMember({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { userId: MEMBER_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb(fixtures())
    await expect(
      removeMember({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst, { userId: MEMBER_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
