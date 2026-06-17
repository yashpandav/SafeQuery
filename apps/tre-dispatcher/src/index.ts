import './env' // validate env vars before anything else
import { createRedisConnection, createExecutionWorker } from '@repo/queue'
import { handleJob } from '@repo/tre-executor'
import { env } from './env'
const connection = createRedisConnection(env.REDIS_URL)

const worker = createExecutionWorker(
  connection,
  async (job) => handleJob(job.data),
  env.WORKER_CONCURRENCY,
)

worker.on('completed', (job) => {
  console.log(`[tre-dispatcher] job ${job.id} (${job.data.type}) completed`)
})

worker.on('failed', (job, err) => {
  console.error(`[tre-dispatcher] job ${job?.id} (${job?.data.type ?? 'unknown'}) failed:`, err.message)
})

console.log(`SafeQuery TRE dispatcher running — concurrency ${env.WORKER_CONCURRENCY}`)

async function shutdown() {
  console.log('[tre-dispatcher] shutting down...')
  await worker.close()
  await connection.quit()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
