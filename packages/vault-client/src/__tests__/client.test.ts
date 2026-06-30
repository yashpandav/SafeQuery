import { describe, it, expect, vi, afterEach } from 'vitest'
import { createVaultDatabaseClient } from '../client'
import type { RegisterConnectionParams } from '../types'

const config = { addr: 'http://vault:8200', token: 'dev-root-token' }

const baseParams: RegisterConnectionParams = {
  connectionId: 'abc-123',
  host: 'postgres',
  port: 5432,
  database: 'mydb',
  username: 'admin',
  password: 'secret',
  ssl: false,
}

function mockResponse(status: number, body: unknown = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

// Explicitly typed so vi.fn.mock.calls knows the arguments are (url, init).
function makeFetch(responses: Response[]) {
  let idx = 0
  return vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(responses[idx++] ?? mockResponse(204)),
  )
}

describe('createVaultDatabaseClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  describe('registerConnection', () => {
    it('enables the mount, configures the connection, and creates two roles', async () => {
      const fetchMock = makeFetch([
        mockResponse(204), // sys/mounts/database — enable
        mockResponse(204), // database/config/...
        mockResponse(204), // database/roles/...-read
        mockResponse(204), // database/roles/...-write
      ])
      vi.stubGlobal('fetch', fetchMock)

      const client = createVaultDatabaseClient(config)
      await expect(client.registerConnection(baseParams)).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(4)

      const urls = fetchMock.mock.calls.map(([url]) => url)
      expect(urls[0]).toBe('http://vault:8200/v1/sys/mounts/database')
      expect(urls[1]).toBe('http://vault:8200/v1/database/config/safequery-abc-123')
      expect(urls[2]).toBe('http://vault:8200/v1/database/roles/safequery-abc-123-read')
      expect(urls[3]).toBe('http://vault:8200/v1/database/roles/safequery-abc-123-write')
    })

    it('sets sslmode=disable when ssl is false', async () => {
      const fetchMock = makeFetch([
        mockResponse(204), mockResponse(204), mockResponse(204), mockResponse(204),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await createVaultDatabaseClient(config).registerConnection(baseParams)

      const [, configInit] = fetchMock.mock.calls[1]!
      const body = JSON.parse(configInit?.body as string)
      expect(body.connection_url).toContain('sslmode=disable')
    })

    it('sets sslmode=require when ssl is true', async () => {
      const fetchMock = makeFetch([
        mockResponse(204), mockResponse(204), mockResponse(204), mockResponse(204),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await createVaultDatabaseClient(config).registerConnection({ ...baseParams, ssl: true })

      const [, configInit] = fetchMock.mock.calls[1]!
      const body = JSON.parse(configInit?.body as string)
      expect(body.connection_url).toContain('sslmode=require')
    })

    it('ignores a 400 "already in use" error when enabling the mount', async () => {
      const fetchMock = makeFetch([
        mockResponse(400, { errors: ['path is already in use at database/'] }),
        mockResponse(204), mockResponse(204), mockResponse(204),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createVaultDatabaseClient(config).registerConnection(baseParams),
      ).resolves.toBeUndefined()
    })

    it('throws when the database config call fails', async () => {
      const fetchMock = makeFetch([
        mockResponse(204),
        mockResponse(400, { errors: ['plugin not found'] }),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createVaultDatabaseClient(config).registerConnection(baseParams),
      ).rejects.toThrow('plugin not found')
    })
  })

  describe('mintCredentials', () => {
    it('returns username, password, leaseId, and leaseDuration for a read role', async () => {
      const fetchMock = makeFetch([
        mockResponse(200, {
          data: { username: 'v-token-abc', password: 'generated-pw' },
          lease_id: 'database/creds/safequery-abc-123-read/xyz789',
          lease_duration: 300,
        }),
      ])
      vi.stubGlobal('fetch', fetchMock)

      const cred = await createVaultDatabaseClient(config).mintCredentials('abc-123', 'read')
      expect(cred.username).toBe('v-token-abc')
      expect(cred.password).toBe('generated-pw')
      expect(cred.leaseId).toBe('database/creds/safequery-abc-123-read/xyz789')
      expect(cred.leaseDuration).toBe(300)

      const [url] = fetchMock.mock.calls[0]!
      expect(url).toBe('http://vault:8200/v1/database/creds/safequery-abc-123-read')
    })

    it('requests the write role when role is "write"', async () => {
      const fetchMock = makeFetch([
        mockResponse(200, {
          data: { username: 'v-write-abc', password: 'pw' },
          lease_id: 'database/creds/safequery-abc-123-write/lease1',
          lease_duration: 120,
        }),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await createVaultDatabaseClient(config).mintCredentials('abc-123', 'write')
      const [url] = fetchMock.mock.calls[0]!
      expect(url).toContain('safequery-abc-123-write')
    })

    it('throws when Vault returns an error', async () => {
      const fetchMock = makeFetch([mockResponse(403, { errors: ['permission denied'] })])
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createVaultDatabaseClient(config).mintCredentials('abc-123', 'read'),
      ).rejects.toThrow('permission denied')
    })
  })

  describe('revokeLease', () => {
    it('calls the revoke endpoint with the lease ID', async () => {
      const fetchMock = makeFetch([mockResponse(204)])
      vi.stubGlobal('fetch', fetchMock)

      await createVaultDatabaseClient(config).revokeLease('database/creds/role/lease-xyz')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('http://vault:8200/v1/sys/leases/revoke')
      expect(JSON.parse(init?.body as string).lease_id).toBe('database/creds/role/lease-xyz')
    })
  })

  describe('deregisterConnection', () => {
    it('deletes the write role, read role, and config in that order', async () => {
      const fetchMock = makeFetch([
        mockResponse(204), mockResponse(204), mockResponse(204),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await createVaultDatabaseClient(config).deregisterConnection('abc-123')

      const urls = fetchMock.mock.calls.map(([url]) => url)
      expect(urls[0]).toContain('roles/safequery-abc-123-write')
      expect(urls[1]).toContain('roles/safequery-abc-123-read')
      expect(urls[2]).toContain('config/safequery-abc-123')
    })

    it('does not throw when individual deletions fail (best-effort cleanup)', async () => {
      const fetchMock = makeFetch([
        mockResponse(404, { errors: ['not found'] }),
        mockResponse(404, { errors: ['not found'] }),
        mockResponse(204),
      ])
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createVaultDatabaseClient(config).deregisterConnection('abc-123'),
      ).resolves.toBeUndefined()
    })
  })
})
