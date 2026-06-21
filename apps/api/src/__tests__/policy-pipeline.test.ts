import { describe, it, expect } from 'vitest'
import { policies, auditLogs } from '@repo/db/schema'
import { getRateLimitPolicy, getRateLimitPolicyForAdmin, updateRateLimitPolicy, type PolicyPrincipal } from '../lib/policy-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'

const admin: PolicyPrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: PolicyPrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

// Mirrors policy.yaml: only same_org_admin gets any action.
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

describe('getRateLimitPolicy', () => {
  it('returns sane defaults when the org has never configured one', async () => {
    const { db } = createMockDb({})
    const result = await getRateLimitPolicy({ db: db as never }, ORG_ID)
    expect(result).toEqual({ enabled: true, queriesPerMinutePerUser: 20, aiCallsPerDayPerOrg: 500 })
  })

  it('returns the org-configured policy when one exists', async () => {
    const fixtures: MockDbFixtures = {
      policies: { id: 'policy-1', orgId: ORG_ID, type: 'rate_limit', enabled: false, config: { queriesPerMinutePerUser: 5, aiCallsPerDayPerOrg: 50 } },
    }
    const { db } = createMockDb(fixtures)
    const result = await getRateLimitPolicy({ db: db as never }, ORG_ID)
    expect(result).toEqual({ enabled: false, queriesPerMinutePerUser: 5, aiCallsPerDayPerOrg: 50 })
  })
})

describe('getRateLimitPolicyForAdmin', () => {
  it('returns the policy for an admin caller', async () => {
    const { db } = createMockDb({})
    const result = await getRateLimitPolicyForAdmin({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)
    expect(result.enabled).toBe(true)
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      getRateLimitPolicyForAdmin({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('updateRateLimitPolicy', () => {
  it('inserts a new policy row when the org has none yet, and audits it', async () => {
    const { db, insertedByTable } = createMockDb({})
    const result = await updateRateLimitPolicy(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { enabled: true, queriesPerMinutePerUser: 10, aiCallsPerDayPerOrg: 100 },
    )

    expect(result).toEqual({ enabled: true, queriesPerMinutePerUser: 10, aiCallsPerDayPerOrg: 100 })
    expect(insertedByTable.get(policies)).toHaveLength(1)
    expect(insertedByTable.get(policies)?.[0]).toMatchObject({ orgId: ORG_ID, type: 'rate_limit', enabled: true })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['POLICY_UPDATED'])
  })

  it('updates the existing policy row in place rather than inserting a second one', async () => {
    const fixtures: MockDbFixtures = {
      policies: { id: 'policy-1', orgId: ORG_ID, type: 'rate_limit', enabled: true, config: { queriesPerMinutePerUser: 20, aiCallsPerDayPerOrg: 500 } },
    }
    const { db, updatedByTable } = createMockDb(fixtures)
    const result = await updateRateLimitPolicy(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { enabled: false, queriesPerMinutePerUser: 1, aiCallsPerDayPerOrg: 1 },
    )

    expect(result).toEqual({ enabled: false, queriesPerMinutePerUser: 1, aiCallsPerDayPerOrg: 1 })
    expect(updatedByTable.get(policies)).toHaveLength(1)
    expect(updatedByTable.get(policies)?.[0]).toMatchObject({ enabled: false })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      updateRateLimitPolicy(
        { db: db as never, cerbosClient: createAdminOnlyCerbosClient() },
        analyst,
        { enabled: true, queriesPerMinutePerUser: 10, aiCallsPerDayPerOrg: 100 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
