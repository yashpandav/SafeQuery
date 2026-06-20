import { describe, it, expect } from 'vitest'
import { customRoles, auditLogs } from '@repo/db/schema'
import type { CustomRoleConfig } from '@repo/types'
import {
  listCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  type CustomRolePrincipal,
} from '../lib/custom-role-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'
const ROLE_ID = 'role-1'

const admin: CustomRolePrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: CustomRolePrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

const sampleConfig: CustomRoleConfig = {
  allowedTables: ['customers'],
  allowedColumns: {},
  allowedActions: ['SELECT'],
  rowFilters: {},
  rowCap: 1000,
  maskPii: true,
}

// Mirrors custom_role.yaml: only same_org_admin gets any action.
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

describe('listCustomRoles', () => {
  it('returns each role with its live member count, computed from organization_members', async () => {
    const fixtures: MockDbFixtures = {
      customRolesList: [
        { id: 'role-dev', orgId: ORG_ID, name: 'dev', description: null, config: sampleConfig, createdAt: new Date(), updatedAt: new Date() },
        { id: 'role-marketing', orgId: ORG_ID, name: 'marketing', description: null, config: sampleConfig, createdAt: new Date(), updatedAt: new Date() },
      ],
      organizationMembersList: [
        { orgId: ORG_ID, userId: 'u1', customRoleId: 'role-dev' },
        { orgId: ORG_ID, userId: 'u2', customRoleId: 'role-dev' },
        { orgId: ORG_ID, userId: 'u3', customRoleId: null },
      ],
    }
    const { db } = createMockDb(fixtures)
    const result = await listCustomRoles({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)

    expect(result.find((r) => r.id === 'role-dev')?.memberCount).toBe(2)
    expect(result.find((r) => r.id === 'role-marketing')?.memberCount).toBe(0)
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      listCustomRoles({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('createCustomRole', () => {
  it('persists the role, audits it, and starts with zero members', async () => {
    const { db, insertedByTable } = createMockDb({})
    const result = await createCustomRole(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { name: 'finance-readonly', allowedTables: ['invoices'], allowedColumns: {}, allowedActions: ['SELECT'], rowFilters: {}, rowCap: 500, maskPii: true },
    )

    expect(result).toMatchObject({ name: 'finance-readonly', memberCount: 0 })
    expect(result.config.maskPii).toBe(true)
    expect(insertedByTable.get(customRoles)).toHaveLength(1)
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['CUSTOM_ROLE_CREATED'])
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      createCustomRole(
        { db: db as never, cerbosClient: createAdminOnlyCerbosClient() },
        analyst,
        { name: 'x', allowedTables: [], allowedColumns: {}, allowedActions: ['SELECT'], rowFilters: {}, rowCap: null, maskPii: true },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('updateCustomRole', () => {
  function fixtures(): MockDbFixtures {
    return {
      customRoles: { id: ROLE_ID, orgId: ORG_ID, name: 'dev', description: null, config: sampleConfig, createdAt: new Date(), updatedAt: new Date() },
      organizationMembersList: [{ orgId: ORG_ID, userId: 'u1', customRoleId: ROLE_ID }],
    }
  }

  it('updates the role config and audits the change', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(fixtures())
    const result = await updateCustomRole(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { customRoleId: ROLE_ID, name: 'dev-extended', allowedTables: ['customers', 'orders'], allowedColumns: {}, allowedActions: ['SELECT', 'UPDATE'], rowFilters: {}, rowCap: 2000, maskPii: false },
    )

    expect(result).toMatchObject({ name: 'dev-extended', memberCount: 1 })
    expect(result.config.allowedTables).toEqual(['customers', 'orders'])
    expect(result.config.maskPii).toBe(false)
    expect(updatedByTable.get(customRoles)?.[0]).toMatchObject({ name: 'dev-extended' })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['CUSTOM_ROLE_UPDATED'])
  })

  it('rejects when the role does not exist in this org', async () => {
    const { db } = createMockDb({ ...fixtures(), customRoles: undefined })
    await expect(
      updateCustomRole(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
        admin,
        { customRoleId: ROLE_ID, name: 'x', allowedTables: [], allowedColumns: {}, allowedActions: ['SELECT'], rowFilters: {}, rowCap: null, maskPii: true },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb(fixtures())
    await expect(
      updateCustomRole(
        { db: db as never, cerbosClient: createAdminOnlyCerbosClient() },
        analyst,
        { customRoleId: ROLE_ID, name: 'x', allowedTables: [], allowedColumns: {}, allowedActions: ['SELECT'], rowFilters: {}, rowCap: null, maskPii: true },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('deleteCustomRole', () => {
  it('deletes the role and audits it', async () => {
    const fixtures: MockDbFixtures = {
      customRoles: { id: ROLE_ID, orgId: ORG_ID, name: 'dev', description: null, config: sampleConfig, createdAt: new Date(), updatedAt: new Date() },
    }
    const { db, deletedByTable, insertedByTable } = createMockDb(fixtures)
    const result = await deleteCustomRole({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, ROLE_ID)

    expect(result).toEqual({ id: ROLE_ID })
    expect(deletedByTable.get(customRoles)).toHaveLength(1)
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['CUSTOM_ROLE_DELETED'])
  })

  it('rejects when the role does not exist in this org', async () => {
    const { db } = createMockDb({ customRoles: undefined })
    await expect(
      deleteCustomRole({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, ROLE_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
