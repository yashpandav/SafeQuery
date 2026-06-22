import { describe, it, expect } from 'vitest'
import { organizations, organizationMembers, auditLogs } from '@repo/db/schema'
import { listMyOrganizations, createOrganization } from '../lib/organization-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'

const USER_ID = 'user-1'
const ORG_A = 'org-a'
const ORG_B = 'org-b'

describe('listMyOrganizations', () => {
  it('returns every org the user is a member of, with their platform role per org', async () => {
    const fixtures: MockDbFixtures = {
      organizationMembersList: [
        { orgId: ORG_A, userId: USER_ID, platformRole: 'owner' },
        { orgId: ORG_B, userId: USER_ID, platformRole: 'analyst' },
      ],
      organizationsList: [
        { id: ORG_A, name: 'Acme Corp', slug: 'acme-corp' },
        { id: ORG_B, name: 'Beta Inc', slug: 'beta-inc' },
      ],
    }
    const { db } = createMockDb(fixtures)

    const result = await listMyOrganizations({ db: db as never }, USER_ID)

    expect(result).toHaveLength(2)
    expect(result).toEqual([
      { id: ORG_A, name: 'Acme Corp', slug: 'acme-corp', platformRole: 'owner' },
      { id: ORG_B, name: 'Beta Inc', slug: 'beta-inc', platformRole: 'analyst' },
    ])
  })

  it('returns an empty array when the user has no memberships, without querying organizations', async () => {
    const { db } = createMockDb({ organizationMembersList: [], organizationsList: [{ id: ORG_A, name: 'Acme Corp', slug: 'acme-corp' }] })

    const result = await listMyOrganizations({ db: db as never }, USER_ID)

    expect(result).toEqual([])
  })

  it('silently drops a membership whose organization row no longer exists (orphaned FK)', async () => {
    const fixtures: MockDbFixtures = {
      organizationMembersList: [
        { orgId: ORG_A, userId: USER_ID, platformRole: 'admin' },
        { orgId: 'deleted-org', userId: USER_ID, platformRole: 'analyst' },
      ],
      organizationsList: [{ id: ORG_A, name: 'Acme Corp', slug: 'acme-corp' }],
    }
    const { db } = createMockDb(fixtures)

    const result = await listMyOrganizations({ db: db as never }, USER_ID)

    expect(result).toEqual([{ id: ORG_A, name: 'Acme Corp', slug: 'acme-corp', platformRole: 'admin' }])
  })
})

describe('createOrganization', () => {
  it('creates the org, an owner membership for the caller, and audits both (SQ-015)', async () => {
    const { db, insertedByTable } = createMockDb({})

    const result = await createOrganization({ db: db as never }, USER_ID, { name: 'Acme Corp', slug: 'acme-corp' })

    expect(result).toMatchObject({ name: 'Acme Corp', slug: 'acme-corp', platformRole: 'owner' })
    expect(insertedByTable.get(organizations)?.[0]).toMatchObject({ name: 'Acme Corp', slug: 'acme-corp' })
    expect(insertedByTable.get(organizationMembers)?.[0]).toMatchObject({ orgId: result.id, userId: USER_ID, platformRole: 'owner' })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['ORGANIZATION_CREATED', 'MEMBER_ADDED'])
  })
})
