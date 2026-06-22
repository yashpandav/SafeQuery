import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import { createLogger } from '../logger'

function captureLines(): { destination: Writable; firstLine: <T>() => T } {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk: Buffer, _enc, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  return {
    destination,
    firstLine: <T>() => {
      const lines = chunks.flatMap((c) => c.trim().split('\n')).filter(Boolean)
      const first = lines[0]
      if (!first) throw new Error('no log line captured')
      return JSON.parse(first) as T
    },
  }
}

describe('createLogger', () => {
  it('emits structured JSON with the service name and message', () => {
    const { destination, firstLine } = captureLines()
    const logger = createLogger('test-service', { destination })

    logger.info('hello world')

    const entry = firstLine<{ name: string; msg: string }>()
    expect(entry).toMatchObject({ name: 'test-service', msg: 'hello world' })
  })

  it('redacts known credential fields at the top level', () => {
    const { destination, firstLine } = captureLines()
    const logger = createLogger('test-service', { destination })

    logger.info({ password: 'super-secret', username: 'alice' }, 'connection attempt')

    const entry = firstLine<{ password: string; username: string }>()
    expect(entry.password).toBe('[REDACTED]')
    expect(entry.username).toBe('[REDACTED]')
  })

  it('redacts encryptedCredentials nested under connection', () => {
    const { destination, firstLine } = captureLines()
    const logger = createLogger('test-service', { destination })

    logger.info({ connection: { host: 'db.internal', encryptedCredentials: 'envelope-blob' } }, 'executing write')

    const entry = firstLine<{ connection: { host: string; encryptedCredentials: string } }>()
    expect(entry.connection.host).toBe('db.internal')
    expect(entry.connection.encryptedCredentials).toBe('[REDACTED]')
  })

  it('redacts a job payload one level deep (the data wrapper shape used by BullMQ jobs)', () => {
    const { destination, firstLine } = captureLines()
    const logger = createLogger('test-service', { destination })

    logger.info({ data: { type: 'test_connection', username: 'bob', password: 'hunter2' } }, 'job received')

    const entry = firstLine<{ data: { type: string; username: string; password: string } }>()
    expect(entry.data.type).toBe('test_connection')
    expect(entry.data.username).toBe('[REDACTED]')
    expect(entry.data.password).toBe('[REDACTED]')
  })

  it('redacts a session token regardless of key casing path used', () => {
    const { destination, firstLine } = captureLines()
    const logger = createLogger('test-service', { destination })

    logger.info({ sessionToken: 'v3.local.abc' }, 'issued session')

    const entry = firstLine<{ sessionToken: string }>()
    expect(entry.sessionToken).toBe('[REDACTED]')
  })
})
