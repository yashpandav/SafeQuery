import { describe, it, expect } from 'vitest'
import { approvalRequests, queryLogs, auditLogs } from '@repo/db/schema'
import { JOB_NAMES } from '@repo/queue'
import { decideApproval, type ApprovalPrincipal } from '../lib/approval-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createMockExecutionQueue } from './mock-execution-queue'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CerbosClient } from '@repo/policy-client'

const ORG_ID = 'org-1'
const SUBMITTER_ID = 'analyst-1'
const REVIEWER_ID = 'reviewer-1'
const APPROVAL_ID = 'approval-1'
const QUERY_LOG_ID = 'query-1'
const CONNECTION_ID = 'conn-1'

const reviewer: ApprovalPrincipal = { userId: REVIEWER_ID, orgId: ORG_ID, platformRole: 'reviewer' }
const submitterAsReviewer: ApprovalPrincipal = { userId: SUBMITTER_ID, orgId: ORG_ID, platformRole: 'reviewer' }

function baseFixtures(): MockDbFixtures {
  return {
    approvalRequests: { id: APPROVAL_ID, orgId: ORG_ID, queryLogId: QUERY_LOG_ID, status: 'PENDING' },
    queryLogs: { id: QUERY_LOG_ID, orgId: ORG_ID, userId: SUBMITTER_ID, connectionId: CONNECTION_ID, generatedSql: 'DELETE FROM customers WHERE id = 1' },
    databaseConnections: { id: CONNECTION_ID, orgId: ORG_ID, host: 'localhost', port: 5432, database: 'demo', ssl: false, encryptedCredentials: 'envelope' },
  }
}
function createFourEyesCerbosClient(orgId: string): CerbosClient {
  return {
    async checkResources(req: {
      principal: { id: string; attributes: Record<string, unknown> }
      resources: { resource: { kind: string; id: string; attributes: Record<string, unknown> }; actions: string[] }[]
    }) {
      const results = req.resources.map(({ resource, actions }) => {
        const orgMatches = resource.attributes['org_id'] === req.principal.attributes['org_id'] && req.principal.attributes['org_id'] === orgId
        const isOwnRequest = resource.attributes['submitted_by'] === req.principal.id
        const actionsMap: Record<string, 'EFFECT_ALLOW' | 'EFFECT_DENY'> = {}
        for (const action of actions) actionsMap[action] = orgMatches && !isOwnRequest ? 'EFFECT_ALLOW' : 'EFFECT_DENY'
        return {
          resource: { kind: resource.kind, id: resource.id },
          actions: actionsMap,
          outputs: [],
          isAllowed(action: string) {
            return actionsMap[action] === 'EFFECT_ALLOW'
          },
        }
      })
      return {
        results,
        isAllowed({ resource, action }: { resource: { kind: string; id: string }; action: string }) {
          return results.find((r) => r.resource.id === resource.id)?.isAllowed(action)
        },
        findResult(resource: { kind: string; id: string }) {
          return results.find((r) => r.resource.id === resource.id)
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as CerbosClient
}

describe('decideApproval', () => {
  it('REJECTED: marks the approval rejected and the query_log cancelled', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(baseFixtures())
    const { client: executionQueue, calls } = createMockExecutionQueue()
    const result = await decideApproval(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
      reviewer,
      { approvalRequestId: APPROVAL_ID, decision: 'REJECTED', note: 'too risky' },
    )

    expect(result).toMatchObject({ status: 'REJECTED', executed: false })
    expect(calls).toHaveLength(0) // never enqueues a write for a rejection
    expect(updatedByTable.get(approvalRequests)?.[0]).toMatchObject({ status: 'REJECTED', reviewerId: REVIEWER_ID })
    expect(updatedByTable.get(queryLogs)?.[0]).toMatchObject({ status: 'CANCELLED' })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['APPROVAL_REJECTED'])
  })

  it('APPROVED: re-runs the validated SQL with dryRun: false and commits', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(baseFixtures())
    const { client: executionQueue, calls } = createMockExecutionQueue()
    const result = await decideApproval(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
      reviewer,
      { approvalRequestId: APPROVAL_ID, decision: 'APPROVED' },
    )

    expect(result).toMatchObject({ status: 'APPROVED', executed: true, rowCount: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: JOB_NAMES.EXECUTE_WRITE, dryRun: false, sql: 'DELETE FROM customers WHERE id = 1' })
    expect(updatedByTable.get(approvalRequests)?.[0]).toMatchObject({ status: 'APPROVED', reviewerId: REVIEWER_ID })
    expect(updatedByTable.get(queryLogs)?.[0]).toMatchObject({ status: 'EXECUTED', rowCount: 1 })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['APPROVAL_APPROVED', 'QUERY_EXECUTED'])
  })

  it('APPROVED but the commit fails: query_log marked FAILED, approval still recorded as APPROVED', async () => {
    const { db, updatedByTable, insertedByTable } = createMockDb(baseFixtures())
    const { client: executionQueue } = createMockExecutionQueue({
      [JOB_NAMES.EXECUTE_WRITE]: { success: false, error: 'deadlock detected', affectedRows: 0, previewRows: [], executionMs: 1, committed: false },
    })
    const result = await decideApproval(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
      reviewer,
      { approvalRequestId: APPROVAL_ID, decision: 'APPROVED' },
    )

    expect(result).toMatchObject({ status: 'APPROVED', executed: false, error: 'deadlock detected' })
    expect(updatedByTable.get(queryLogs)?.[0]).toMatchObject({ status: 'FAILED', errorMessage: 'deadlock detected' })
    expect(insertedByTable.get(auditLogs)?.map((a) => a.action)).toEqual(['APPROVAL_APPROVED', 'QUERY_FAILED'])
  })

  it('four-eyes: a submitter cannot approve their own request', async () => {
    const { db } = createMockDb(baseFixtures())
    const { client: executionQueue } = createMockExecutionQueue()
    await expect(
      decideApproval(
        { db: db as never, cerbosClient: createFourEyesCerbosClient(ORG_ID), executionQueue },
        submitterAsReviewer,
        { approvalRequestId: APPROVAL_ID, decision: 'APPROVED' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects when the approval request is not found in this org', async () => {
    const { db } = createMockDb({ ...baseFixtures(), approvalRequests: undefined })
    const { client: executionQueue } = createMockExecutionQueue()
    await expect(
      decideApproval(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
        reviewer,
        { approvalRequestId: APPROVAL_ID, decision: 'APPROVED' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects re-deciding an already-decided approval request', async () => {
    const { db } = createMockDb({ ...baseFixtures(), approvalRequests: { id: APPROVAL_ID, orgId: ORG_ID, queryLogId: QUERY_LOG_ID, status: 'APPROVED' } })
    const { client: executionQueue } = createMockExecutionQueue()
    await expect(
      decideApproval(
        { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
        reviewer,
        { approvalRequestId: APPROVAL_ID, decision: 'APPROVED' },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
