import { describe, it, expect } from 'vitest'
import { getDashboardSummary, type DashboardPrincipal } from '../lib/dashboard-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'

const admin: DashboardPrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: DashboardPrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

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

describe('getDashboardSummary', () => {
  it('counts today\'s queries by risk level, pending approvals, and recent security incidents — all real aggregates', async () => {
    const now = new Date()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000)
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60_000)

    const fixtures: MockDbFixtures = {
      queryLogsList: [
        { id: 'q1', orgId: ORG_ID, riskLevel: 'SAFE', createdAt: now },
        { id: 'q2', orgId: ORG_ID, riskLevel: 'WARNING', createdAt: now },
        { id: 'q3', orgId: ORG_ID, riskLevel: 'CRITICAL', createdAt: now },
      ],
      approvalRequestsList: [
        { id: 'a1', orgId: ORG_ID, status: 'PENDING', createdAt: tenMinutesAgo },
        { id: 'a2', orgId: ORG_ID, status: 'PENDING', createdAt: twentyMinutesAgo },
      ],
      auditLogsList: [{ id: 'l1', orgId: ORG_ID, action: 'SECURITY_INCIDENT_DETECTED', createdAt: now }],
    }
    const { db } = createMockDb(fixtures)
    const result = await getDashboardSummary({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)

    expect(result.queriesToday).toEqual({ total: 3, safe: 1, warning: 1, critical: 1 })
    expect(result.pendingApprovals.count).toBe(2)
    expect(result.pendingApprovals.avgWaitMinutes).toBe(15) // avg of ~10 and ~20 minutes
    expect(result.securityIncidentsLast30Days).toBe(1) // only the SECURITY_INCIDENT_DETECTED row
    expect(result.auditIntegrity).toMatchObject({ valid: true })
  })

  it('reports a null average wait when there are no pending approvals', async () => {
    const { db } = createMockDb({})
    const result = await getDashboardSummary({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)
    expect(result.pendingApprovals).toEqual({ count: 0, avgWaitMinutes: null })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      getDashboardSummary({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
