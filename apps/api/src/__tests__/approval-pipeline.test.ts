import { describe, it, expect } from 'vitest'
import { approvalRequests, queryLogs, auditLogs } from '@repo/db/schema'
import { JOB_NAMES } from '@repo/queue'
import { decideApproval, listApprovals, type ApprovalPrincipal } from '../lib/approval-pipeline'
import { createMockDb, type MockDbFixtures } from './mock-db'
import { createMockExecutionQueue } from './mock-execution-queue'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'
import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

const ORG_ID = 'org-1'
const SUBMITTER_ID = 'analyst-1'
const REVIEWER_ID = 'reviewer-1'
const APPROVAL_ID = 'approval-1'
const QUERY_LOG_ID = 'query-1'
const CONNECTION_ID = 'conn-1'

const reviewer: ApprovalPrincipal = { userId: REVIEWER_ID, orgId: ORG_ID, platformRole: 'reviewer' }
const submitter: ApprovalPrincipal = { userId: SUBMITTER_ID, orgId: ORG_ID, platformRole: 'analyst' }
const submitterAsReviewer: ApprovalPrincipal = { userId: SUBMITTER_ID, orgId: ORG_ID, platformRole: 'reviewer' }

function createSubmitterOnlyCerbosClient(): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const results = req.resources.map(({ resource, actions }) => {
        const isOwnRequest = resource.attr?.['submitted_by'] === req.principal.id
        const actionsMap: Record<string, boolean> = {}
        for (const action of actions) actionsMap[action] = isOwnRequest
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

function baseFixtures(): MockDbFixtures {
  return {
    approvalRequests: { id: APPROVAL_ID, orgId: ORG_ID, queryLogId: QUERY_LOG_ID, status: 'PENDING' },
    queryLogs: { id: QUERY_LOG_ID, orgId: ORG_ID, userId: SUBMITTER_ID, connectionId: CONNECTION_ID, generatedSql: 'DELETE FROM customers WHERE id = 1' },
    databaseConnections: { id: CONNECTION_ID, orgId: ORG_ID, host: 'localhost', port: 5432, database: 'demo', ssl: false, encryptedCredentials: 'envelope' },
  }
}
function createFourEyesCerbosClient(orgId: string): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const results = req.resources.map(({ resource, actions }) => {
        const orgMatches = resource.attr?.['org_id'] === req.principal.attr?.['org_id'] && req.principal.attr?.['org_id'] === orgId
        const isOwnRequest = resource.attr?.['submitted_by'] === req.principal.id
        const actionsMap: Record<string, boolean> = {}
        for (const action of actions) actionsMap[action] = orgMatches && !isOwnRequest
        return {
          resourceId: resource.id,
          isAllowed(action: string) {
            return actionsMap[action] ?? false
          },
        }
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

describe('listApprovals', () => {
  function listFixtures(): MockDbFixtures {
    return {
      approvalRequestsList: [{ id: APPROVAL_ID, orgId: ORG_ID, queryLogId: QUERY_LOG_ID, status: 'PENDING', expiresAt: new Date(), createdAt: new Date() }],
      queryLogsList: [
        { id: QUERY_LOG_ID, orgId: ORG_ID, userId: SUBMITTER_ID, naturalLanguage: 'delete inactive customers', generatedSql: 'DELETE FROM customers WHERE id = 1', riskLevel: 'CRITICAL' },
      ],
    }
  }

  it('reviewer: sees the request with the linked query_log details joined in', async () => {
    const { db } = createMockDb(listFixtures())
    const result = await listApprovals({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, reviewer)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: APPROVAL_ID,
      status: 'PENDING',
      naturalLanguage: 'delete inactive customers',
      generatedSql: 'DELETE FROM customers WHERE id = 1',
      riskLevel: 'CRITICAL',
      submittedBy: SUBMITTER_ID,
    })
  })

  it('analyst: only sees requests they submitted, per request_submitter', async () => {
    const { db } = createMockDb(listFixtures())
    const result = await listApprovals({ db: db as never, cerbosClient: createSubmitterOnlyCerbosClient() }, submitter)
    expect(result).toHaveLength(1)

    const otherAnalyst: ApprovalPrincipal = { userId: 'someone-else', orgId: ORG_ID, platformRole: 'analyst' }
    const hiddenFromOthers = await listApprovals({ db: db as never, cerbosClient: createSubmitterOnlyCerbosClient() }, otherAnalyst)
    expect(hiddenFromOthers).toHaveLength(0)
  })

  it('returns an empty list when there are no approval requests in the org', async () => {
    const { db } = createMockDb({})
    const result = await listApprovals({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID) }, reviewer)
    expect(result).toEqual([])
  })
})
