import './env' // validate env vars before anything else
import { Worker as ThreadWorker } from 'node:worker_threads'
import { DelayedError } from 'bullmq'
import { createRedisConnection, createExecutionQueue, createExecutionWorker, JOB_NAMES } from '@repo/queue'
import { handleJob } from '@repo/tre-executor'
import { runExecuteWriteInWorker, type WorkerLike } from './lib/run-in-worker-thread'
import { shouldDelayForOrgConcurrency } from './lib/org-concurrency'
import { env } from './env'
import { logger } from './logger'
const connection = createRedisConnection(env.REDIS_URL)
const executionQueue = createExecutionQueue(connection)

// tsx (dev) preserves the real .ts extension on import.meta.url; the tsup build (prod) rewrites it
// to .js. Either way the worker script sits next to this file, so this resolves correctly in both.
const isTsSource = import.meta.url.endsWith('.ts')
const executeWriteWorkerUrl = new URL(isTsSource ? './execute-write-worker.ts' : './execute-write-worker.js', import.meta.url)

function createExecuteWriteWorker(data: Parameters<typeof runExecuteWriteInWorker>[0]): WorkerLike {
  return new ThreadWorker(executeWriteWorkerUrl, {
    workerData: data,
    execArgv: isTsSource ? ['--import', 'tsx/esm'] : [],
  }) as unknown as WorkerLike
}

const RETRY_DELAY_MS = 2_000

const worker = createExecutionWorker(
  connection,
  async (job, token) => {
    const shouldDelay = await shouldDelayForOrgConcurrency(
      { getActiveJobs: () => executionQueue.getJobs(['active']) },
      job.id,
      job.data.orgId,
      env.MAX_CONCURRENT_JOBS_PER_ORG,
    )
    if (shouldDelay) {
      await job.moveToDelayed(Date.now() + RETRY_DELAY_MS, token)
      throw new DelayedError()
    }

    if (job.data.type === JOB_NAMES.EXECUTE_WRITE) {
      return runExecuteWriteInWorker(job.data, createExecuteWriteWorker)
    }
    return handleJob(job.data)
  },
  env.WORKER_CONCURRENCY,
)

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, jobType: job.data.type }, 'job completed')
})

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, jobType: job?.data.type ?? 'unknown', err: err.message }, 'job failed')
})

logger.info({ concurrency: env.WORKER_CONCURRENCY, maxConcurrentPerOrg: env.MAX_CONCURRENT_JOBS_PER_ORG }, 'SafeQuery TRE dispatcher running')

async function shutdown() {
  logger.info('shutting down')
  await worker.close()
  await executionQueue.close()
  await connection.quit()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
