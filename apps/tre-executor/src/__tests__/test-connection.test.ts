import { describe, it, expect } from 'vitest'
import { handleTestConnection } from '../lib/test-connection'
import { createFakeClient } from './fake-client'
import type { TestConnectionJobData } from '@repo/queue'

const baseData: TestConnectionJobData = {
  type: 'test_connection',
  orgId: 'org-1',
  host: 'localhost',
  port: 5432,
  database: 'demo',
  ssl: false,
  username: 'analyst',
  password: 'hunter2',
}

describe('handleTestConnection', () => {
  it('returns success and an encrypted credential envelope on a reachable database', async () => {
    const { client } = createFakeClient()
    const result = await handleTestConnection(baseData, () => client)

    expect(result.success).toBe(true)
    expect(result.error).toBeNull()
    expect(result.encryptedCredentials).not.toBeNull()
    expect(result.encryptedCredentials).not.toContain('hunter2')
  })

  it('returns failure without an encrypted envelope when connect() fails', async () => {
    const { client } = createFakeClient({ failConnect: new Error('connection refused') })
    const result = await handleTestConnection(baseData, () => client)

    expect(result.success).toBe(false)
    expect(result.error).toContain('connection refused')
    expect(result.encryptedCredentials).toBeNull()
  })

  it('returns failure when the SELECT 1 probe fails', async () => {
    const { client } = createFakeClient({ failQuery: () => new Error('permission denied') })
    const result = await handleTestConnection(baseData, () => client)

    expect(result.success).toBe(false)
    expect(result.error).toContain('permission denied')
  })

  it('always closes the connection, even on failure', async () => {
    let ended = false
    const { client } = createFakeClient({ failConnect: new Error('boom') })
    const wrapped = { ...client, end: async () => { ended = true } } as typeof client
    await handleTestConnection(baseData, () => wrapped)
    expect(ended).toBe(true)
  })
})
