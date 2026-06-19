import { JOB_NAMES, type ExecutionJobData, type JobResultMap } from '@repo/queue'
import type { ExecutionQueueClient } from '../lib/query-pipeline'
export function createMockExecutionQueue(overrides: Partial<JobResultMap> = {}): {
  client: ExecutionQueueClient
  calls: ExecutionJobData[]
} {
  const calls: ExecutionJobData[] = []

  const defaults: JobResultMap = {
    [JOB_NAMES.TEST_CONNECTION]: { success: true, error: null, encryptedCredentials: 'encrypted' },
    [JOB_NAMES.CAPTURE_SCHEMA]: { success: true, error: null, snapshot: {} },
    [JOB_NAMES.EXECUTE_READ]: {
      success: true,
      error: null,
      columns: ['id'],
      rows: [{ id: '1' }],
      rowCount: 1,
      truncated: false,
      maskedColumns: [],
      executionMs: 5,
      plan: null,
      estimatedRowCount: null,
    },
    [JOB_NAMES.EXECUTE_WRITE]: {
      success: true,
      error: null,
      affectedRows: 1,
      previewRows: [{ id: '1' }],
      executionMs: 5,
      committed: false,
    },
  }

  const client: ExecutionQueueClient = {
    async run<T extends ExecutionJobData>(data: T): Promise<JobResultMap[T['type']]> {
      calls.push(data)
      return { ...defaults[data.type], ...overrides[data.type] } as JobResultMap[T['type']]
    },
  }

  return { client, calls }
}
