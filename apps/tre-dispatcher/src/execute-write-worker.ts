import { parentPort, workerData } from 'node:worker_threads'
import { handleExecuteWrite } from '@repo/tre-executor'
import type { ExecuteWriteJobData } from '@repo/queue'
import type { WorkerMessage } from './lib/run-in-worker-thread'

async function main() {
  const data = workerData as ExecuteWriteJobData
  try {
    const result = await handleExecuteWrite(data)
    const message: WorkerMessage = { ok: true, result }
    parentPort?.postMessage(message)
  } catch (err) {
    const message: WorkerMessage = { ok: false, error: err instanceof Error ? err.message : String(err) }
    parentPort?.postMessage(message)
  }
}

void main()
