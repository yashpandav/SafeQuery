import { Queue, QueueEvents, Worker, type Processor } from 'bullmq'
import type { Redis } from 'ioredis'
import type { ExecutionJobData, ExecutionJobResult, JobName } from './jobs'

export const EXECUTION_QUEUE_NAME = 'safequery-execution'

export type ExecutionQueue = Queue<ExecutionJobData, ExecutionJobResult, JobName>
export type ExecutionWorker = Worker<ExecutionJobData, ExecutionJobResult, JobName>
export function createExecutionQueue(connection: Redis): ExecutionQueue {
  return new Queue(EXECUTION_QUEUE_NAME, { connection })
}

export function createExecutionQueueEvents(connection: Redis): QueueEvents {
  return new QueueEvents(EXECUTION_QUEUE_NAME, { connection })
}
export function createExecutionWorker(
  connection: Redis,
  processor: Processor<ExecutionJobData, ExecutionJobResult, JobName>,
  concurrency: number,
): ExecutionWorker {
  return new Worker(EXECUTION_QUEUE_NAME, processor, { connection, concurrency })
}
