import type { ExecuteWriteJobData, ExecuteWriteJobResult } from '@repo/queue'

export interface WorkerMessage {
  ok: boolean
  result?: ExecuteWriteJobResult
  error?: string
}

export interface WorkerLike {
  on(event: 'message', listener: (msg: WorkerMessage) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  terminate(): Promise<number>
}

export type WorkerFactory = (data: ExecuteWriteJobData) => WorkerLike

const DEFAULT_TIMEOUT_MS = 30_000

export function runExecuteWriteInWorker(
  data: ExecuteWriteJobData,
  createWorker: WorkerFactory,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ExecuteWriteJobResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker(data)
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new Error(`execute_write worker timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.on('message', (msg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (msg.ok && msg.result) resolve(msg.result)
      else reject(new Error(msg.error ?? 'execute_write worker reported failure with no error message'))
    })

    worker.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      reject(err)
    })

    worker.on('exit', (code) => {
      if (settled || code === 0) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`execute_write worker exited with code ${code} before reporting a result`))
    })
  })
}
