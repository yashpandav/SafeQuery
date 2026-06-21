import { describe, it, expect, vi, afterEach } from 'vitest'
import { environments, auditLogs } from '@repo/db/schema'
import { listEnvironments, updateEnvironmentType, updateEnvironmentWriteWindow, type EnvironmentPrincipal } from '../lib/environment-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

const ORG_ID = 'org-1'
const ADMIN_ID = 'admin-1'
const ANALYST_ID = 'analyst-1'
const ENV_ID = 'env-1'

const admin: EnvironmentPrincipal = { userId: ADMIN_ID, orgId: ORG_ID, platformRole: 'admin' }
const analyst: EnvironmentPrincipal = { userId: ANALYST_ID, orgId: ORG_ID, platformRole: 'analyst' }

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

afterEach(() => {
  vi.useRealTimers()
})

describe('listEnvironments', () => {
  it('describes each environment\'s actual risk-engine posture, not aspirational copy', async () => {
    const fixtures: MockDbFixtures = {
      environmentsList: [
        { id: 'env-dev', orgId: ORG_ID, name: 'Development', type: 'development', createdAt: new Date() },
        { id: 'env-prod', orgId: ORG_ID, name: 'Production', type: 'production', createdAt: new Date() },
      ],
    }
    const { db } = createMockDb(fixtures)
    const result = await listEnvironments({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin)

    expect(result.find((e) => e.type === 'production')?.posture).toContain('always CRITICAL')
    expect(result.find((e) => e.type === 'development')?.posture).toContain('WARNING')
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb({})
    await expect(
      listEnvironments({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('updateEnvironmentType', () => {
  function fixtures(): MockDbFixtures {
    return { environments: { id: ENV_ID, orgId: ORG_ID, name: 'Staging', type: 'staging', createdAt: new Date() } }
  }

  it('changes the environment type and audits the before/after', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(fixtures())
    const result = await updateEnvironmentType(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { environmentId: ENV_ID, type: 'production' },
    )

    expect(result).toMatchObject({ type: 'production' })
    expect(result.posture).toContain('always CRITICAL')
    expect(updatedByTable.get(environments)?.[0]).toMatchObject({ type: 'production' })
    expect(insertedByTable.get(auditLogs)?.[0]).toMatchObject({
      action: 'ENVIRONMENT_UPDATED',
      metadata: { previousType: 'staging', newType: 'production' },
    })
  })

  it('rejects when the environment does not exist in this org', async () => {
    const { db } = createMockDb({ environments: undefined })
    await expect(
      updateEnvironmentType({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, admin, { environmentId: ENV_ID, type: 'production' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb(fixtures())
    await expect(
      updateEnvironmentType({ db: db as never, cerbosClient: createAdminOnlyCerbosClient() }, analyst, { environmentId: ENV_ID, type: 'production' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('updateEnvironmentWriteWindow', () => {
  function fixtures(): MockDbFixtures {
    return { environments: { id: ENV_ID, orgId: ORG_ID, name: 'Production', type: 'production', createdAt: new Date() } }
  }

  it('sets a write window and audits the before/after', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(fixtures())
    const result = await updateEnvironmentWriteWindow(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { environmentId: ENV_ID, writeWindow: { start: '09:00', end: '17:00', timezone: 'UTC' } },
    )

    expect(result.writeWindow).toEqual({ start: '09:00', end: '17:00', timezone: 'UTC' })
    expect(result.posture).toContain('09:00 and 17:00')
    expect(updatedByTable.get(environments)?.[0]).toMatchObject({
      writeWindowStart: '09:00',
      writeWindowEnd: '17:00',
      writeWindowTimezone: 'UTC',
    })
    expect(insertedByTable.get(auditLogs)?.[0]).toMatchObject({ action: 'ENVIRONMENT_UPDATED' })
  })

  it('reports whether the current moment falls inside the configured window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const { db } = createMockDb(fixtures())
    const result = await updateEnvironmentWriteWindow(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { environmentId: ENV_ID, writeWindow: { start: '09:00', end: '17:00', timezone: 'UTC' } },
    )
    expect(result.withinWriteWindowNow).toBe(true)
  })

  it('clears a previously configured window when writeWindow is null', async () => {
    const fx = fixtures()
    fx.environments = {
      ...(fx.environments as Record<string, unknown>),
      writeWindowStart: '09:00',
      writeWindowEnd: '17:00',
      writeWindowTimezone: 'UTC',
    }
    const { db, updatedByTable } = createMockDb(fx)
    const result = await updateEnvironmentWriteWindow(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
      admin,
      { environmentId: ENV_ID, writeWindow: null },
    )

    expect(result.writeWindow).toBeNull()
    expect(result.withinWriteWindowNow).toBeNull()
    expect(updatedByTable.get(environments)?.[0]).toMatchObject({
      writeWindowStart: null,
      writeWindowEnd: null,
      writeWindowTimezone: null,
    })
  })

  it('rejects when the environment does not exist in this org', async () => {
    const { db } = createMockDb({ environments: undefined })
    await expect(
      updateEnvironmentWriteWindow(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) },
        admin,
        { environmentId: ENV_ID, writeWindow: { start: '09:00', end: '17:00', timezone: 'UTC' } },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects non-admin callers', async () => {
    const { db } = createMockDb(fixtures())
    await expect(
      updateEnvironmentWriteWindow(
        { db: db as never, cerbosClient: createAdminOnlyCerbosClient() },
        analyst,
        { environmentId: ENV_ID, writeWindow: { start: '09:00', end: '17:00', timezone: 'UTC' } },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
