import { describe, it, expect } from 'vitest'
import { listAuditLog, verifyAuditIntegrity, type AuditPrincipal } from '../lib/audit-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'
const OTHER_ANALYST_ID = 'analyst-2'

const admin: AuditPrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: AuditPrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

function createAuditCerbosClient(adminUserIds: string[]): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const isAdmin = adminUserIds.includes(req.principal.id)
      const results = req.resources.map(({ resource, actions }) => {
        const isOwnEntry = resource.attr?.['actor_id'] === req.principal.id
        const actionsMap: Record<string, boolean> = {}
        for (const action of actions) {
          actionsMap[action] = action === 'verify_integrity' ? isAdmin : isAdmin || isOwnEntry
        }
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

function logRow(id: string, actorId: string, action: string) {
  return {
    id,
    orgId: ORG_ID,
    actorId,
    action,
    resourceType: 'query_log',
    resourceId: 'query-1',
    metadata: {},
    prevHash: null,
    hash: 'hash-' + id,
    createdAt: new Date(),
  }
}

describe('listAuditLog', () => {
  function fixtures(): MockDbFixtures {
    return {
      auditLogsList: [
        logRow('log-1', ADMIN_ID, 'QUERY_SUBMITTED'),
        logRow('log-2', ANALYST_ID, 'QUERY_EXECUTED'),
      ],
      usersList: [
        { id: ADMIN_ID, name: 'Admin User', email: 'admin@example.com' },
        { id: ANALYST_ID, name: 'Analyst User', email: 'analyst@example.com' },
      ],
    }
  }

  it('admin: sees every entry in the org, with the actor name/email joined in', async () => {
    const { db } = createMockDb(fixtures())
    const result = await listAuditLog({ db: db as never, cerbosClient: createAuditCerbosClient([ADMIN_ID]) }, admin)

    expect(result).toHaveLength(2)
    expect(result.find((r) => r.id === 'log-2')).toMatchObject({
      actorId: ANALYST_ID,
      actorName: 'Analyst User',
      actorEmail: 'analyst@example.com',
      action: 'QUERY_EXECUTED',
    })
  })

  it('analyst: only sees entries where they are the recorded actor', async () => {
    const { db } = createMockDb(fixtures())
    const result = await listAuditLog({ db: db as never, cerbosClient: createAuditCerbosClient([ADMIN_ID]) }, analyst)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'log-2', actorId: ANALYST_ID })
  })

  it("a different analyst with no entries of their own sees nothing", async () => {
    const { db } = createMockDb(fixtures())
    const otherAnalyst: AuditPrincipal = { userId: OTHER_ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }
    const result = await listAuditLog({ db: db as never, cerbosClient: createAuditCerbosClient([ADMIN_ID]) }, otherAnalyst)
    expect(result).toEqual([])
  })

  it('returns an empty list when the org has no audit entries', async () => {
    const { db } = createMockDb({})
    const result = await listAuditLog({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)
    expect(result).toEqual([])
  })
})

describe('verifyAuditIntegrity', () => {
  it('rejects a non-admin caller before ever recomputing the chain', async () => {
    const { db } = createMockDb({})
    await expect(
      verifyAuditIntegrity({ db: db as never, cerbosClient: createAuditCerbosClient([ADMIN_ID]) }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('an admin caller is allowed through to the real integrity check', async () => {
    const { db } = createMockDb({})
    const result = await verifyAuditIntegrity({ db: db as never, cerbosClient: createAuditCerbosClient([ADMIN_ID]) }, admin)
    expect(result).toMatchObject({ valid: true })
  })
})
