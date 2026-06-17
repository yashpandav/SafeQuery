import { createRedisConnection, createExecutionQueue, createExecutionQueueEvents } from '@repo/queue'
import type { ExecutionJobData, JobResultMap } from '@repo/queue'
import type { ExecutionQueueClient } from './query-pipeline'
import { env } from '../env'
const connection = createRedisConnection(env.REDIS_URL)
const queue = createExecutionQueue(connection)
const queueEvents = createExecutionQueueEvents(connection)

const JOB_TIMEOUT_MS = 60_000

export const executionQueue: ExecutionQueueClient = {
  async run<T extends ExecutionJobData>(data: T): Promise<JobResultMap[T['type']]> {
    const job = await queue.add(data.type, data)
    const result = await job.waitUntilFinished(queueEvents, JOB_TIMEOUT_MS)
    return result as JobResultMap[T['type']]
  },
}
