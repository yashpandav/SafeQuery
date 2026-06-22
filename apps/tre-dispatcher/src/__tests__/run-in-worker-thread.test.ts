import { describe, it, expect, vi } from 'vitest'
import { runExecuteWriteInWorker, type WorkerLike, type WorkerMessage } from '../lib/run-in-worker-thread'
import type { ExecuteWriteJobData, ExecuteWriteJobResult } from '@repo/queue'
import { JOB_NAMES } from '@repo/queue'

const jobData: ExecuteWriteJobData = {
  type: JOB_NAMES.EXECUTE_WRITE,
  orgId: 'org-1',
  connection: { host: 'localhost', port: 5432, database: 'demo', ssl: false, encryptedCredentials: 'envelope' },
  sql: "UPDATE customers SET status = 'inactive' WHERE id = 1",
  dryRun: false,
}

function createFakeWorker(): { worker: WorkerLike; emit: (event: 'message' | 'error' | 'exit', payload: unknown) => void; terminate: ReturnType<typeof vi.fn> } {
  const listeners: Record<string, ((payload: unknown) => void)[]> = {}
  const terminate = vi.fn(async () => 0)
  const worker: WorkerLike = {
    on: (event, listener) => {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(listener as (payload: unknown) => void)
    },
    terminate,
  }
  return {
    worker,
    emit: (event, payload) => {
      for (const listener of listeners[event] ?? []) listener(payload)
    },
    terminate,
  }
}

describe('runExecuteWriteInWorker', () => {
  it('resolves with the result and terminates the worker on a successful message', async () => {
    const { worker, emit, terminate } = createFakeWorker()
    const promise = runExecuteWriteInWorker(jobData, () => worker)

    const result: ExecuteWriteJobResult = { success: true, error: null, affectedRows: 1, previewRows: [{ id: 1 }], executionMs: 5, committed: true }
    emit('message', { ok: true, result } satisfies WorkerMessage)

    await expect(promise).resolves.toEqual(result)
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('rejects and terminates the worker when the message reports failure', async () => {
    const { worker, emit, terminate } = createFakeWorker()
    const promise = runExecuteWriteInWorker(jobData, () => worker)

    emit('message', { ok: false, error: 'constraint violation' } satisfies WorkerMessage)

    await expect(promise).rejects.toThrow('constraint violation')
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('rejects and terminates the worker on an uncaught worker error', async () => {
    const { worker, emit, terminate } = createFakeWorker()
    const promise = runExecuteWriteInWorker(jobData, () => worker)

    emit('error', new Error('segfault'))

    await expect(promise).rejects.toThrow('segfault')
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('rejects when the worker exits with a non-zero code before reporting a result', async () => {
    const { worker, emit } = createFakeWorker()
    const promise = runExecuteWriteInWorker(jobData, () => worker)

    emit('exit', 1)

    await expect(promise).rejects.toThrow('exited with code 1')
  })

  it('does not reject on a clean exit that follows a successful message', async () => {
    const { worker, emit } = createFakeWorker()
    const promise = runExecuteWriteInWorker(jobData, () => worker)

    const result: ExecuteWriteJobResult = { success: true, error: null, affectedRows: 0, previewRows: [], executionMs: 1, committed: true }
    emit('message', { ok: true, result } satisfies WorkerMessage)
    emit('exit', 0)

    await expect(promise).resolves.toEqual(result)
  })

  it('times out and terminates the worker if no message ever arrives', async () => {
    const { worker, terminate } = createFakeWorker()
    const promise = runExecuteWriteInWorker(jobData, () => worker, 10)

    await expect(promise).rejects.toThrow('timed out')
    expect(terminate).toHaveBeenCalledOnce()
  })
})
