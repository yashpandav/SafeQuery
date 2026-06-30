import { describe, it, expect, vi } from 'vitest'
import { handleTestConnection } from '../lib/test-connection'
import { createFakeClient } from './fake-client'
import type { TestConnectionJobData } from '@repo/queue'
import type { VaultDatabaseClient } from '@repo/vault-client'

const baseData: TestConnectionJobData = {
  type: 'test_connection',
  orgId: 'org-1',
  connectionId: 'conn-uuid-123',
  host: 'localhost',
  port: 5432,
  database: 'demo',
  ssl: false,
  username: 'analyst',
  password: 'hunter2',
}

function fakeVaultClient(): VaultDatabaseClient {
  return {
    registerConnection: vi.fn(async () => {}),
    mintCredentials: vi.fn(),
    revokeLease: vi.fn(),
    deregisterConnection: vi.fn(),
  }
}

describe('handleTestConnection (secrets path)', () => {
  it('returns success and an encrypted credential envelope on a reachable database', async () => {
    const { client } = createFakeClient()
    const result = await handleTestConnection(baseData, () => client, null)

    expect(result.success).toBe(true)
    expect(result.error).toBeNull()
    expect(result.encryptedCredentials).not.toBeNull()
    expect(result.encryptedCredentials).not.toContain('hunter2')
  })

  it('returns failure without an encrypted envelope when connect() fails', async () => {
    const { client } = createFakeClient({ failConnect: new Error('connection refused') })
    const result = await handleTestConnection(baseData, () => client, null)

    expect(result.success).toBe(false)
    expect(result.error).toContain('connection refused')
    expect(result.encryptedCredentials).toBeNull()
  })

  it('returns failure when the SELECT 1 probe fails', async () => {
    const { client } = createFakeClient({ failQuery: () => new Error('permission denied') })
    const result = await handleTestConnection(baseData, () => client, null)

    expect(result.success).toBe(false)
    expect(result.error).toContain('permission denied')
  })

  it('always closes the connection, even on failure', async () => {
    let ended = false
    const { client } = createFakeClient({ failConnect: new Error('boom') })
    const wrapped = { ...client, end: async () => { ended = true } } as typeof client
    await handleTestConnection(baseData, () => wrapped, null)
    expect(ended).toBe(true)
  })
})

describe('handleTestConnection (Vault path)', () => {
  it('registers the connection with Vault and returns a vault credential ref', async () => {
    const { client } = createFakeClient()
    const vault = fakeVaultClient()
    const result = await handleTestConnection(baseData, () => client, vault)

    expect(result.success).toBe(true)
    expect(result.error).toBeNull()

    const ref = JSON.parse(result.encryptedCredentials ?? '{}') as { type: string; connectionId: string }
    expect(ref.type).toBe('vault')
    expect(ref.connectionId).toBe(baseData.connectionId)
  })

  it('calls registerConnection with the correct params', async () => {
    const { client } = createFakeClient()
    const vault = fakeVaultClient()
    await handleTestConnection(baseData, () => client, vault)

    expect(vault.registerConnection).toHaveBeenCalledOnce()
    const call = (vault.registerConnection as ReturnType<typeof vi.fn>).mock.calls[0] as [Parameters<VaultDatabaseClient['registerConnection']>[0]]
    const params = call[0]
    expect(params.connectionId).toBe('conn-uuid-123')
    expect(params.username).toBe('analyst')
    expect(params.password).toBe('hunter2')
    expect(params.host).toBe('localhost')
  })

  it('vault ref does not contain the plaintext password', async () => {
    const { client } = createFakeClient()
    const vault = fakeVaultClient()
    const result = await handleTestConnection(baseData, () => client, vault)

    expect(result.encryptedCredentials).not.toContain('hunter2')
  })

  it('returns failure when the connectivity test fails before Vault registration', async () => {
    const { client } = createFakeClient({ failConnect: new Error('unreachable') })
    const vault = fakeVaultClient()
    const result = await handleTestConnection(baseData, () => client, vault)

    expect(result.success).toBe(false)
    expect(vault.registerConnection).not.toHaveBeenCalled()
    expect(result.encryptedCredentials).toBeNull()
  })

  it('returns failure when Vault registration itself fails', async () => {
    const { client } = createFakeClient()
    const vault = fakeVaultClient()
    vi.mocked(vault.registerConnection).mockRejectedValueOnce(new Error('Vault unavailable'))

    const result = await handleTestConnection(baseData, () => client, vault)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Vault unavailable')
    expect(result.encryptedCredentials).toBeNull()
  })
})
