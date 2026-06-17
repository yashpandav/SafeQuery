import { describe, it, expect } from 'vitest'
import { databaseConnections, schemaSnapshots, auditLogs } from '@repo/db/schema'
import { JOB_NAMES } from '@repo/queue'
import { createConnection, listConnections, captureSchema, type ConnectionPrincipal } from '../lib/connection-pipeline'
import { createMockDb } from './mock-db'
import { createMockExecutionQueue } from './mock-execution-queue'
import { createAllowAllCerbosClient } from './mock-cerbos-allow-all'

const ORG_ID = 'org-1'
const ENVIRONMENT_ID = 'env-1'
const CONNECTION_ID = 'conn-1'

const adminPrincipal: ConnectionPrincipal = { userId: 'admin-1', orgId: ORG_ID, platformRole: 'admin' }
const analystPrincipal: ConnectionPrincipal = { userId: 'analyst-1', orgId: ORG_ID, platformRole: 'analyst' }

const createInput = {
  name: 'Primary',
  environmentId: ENVIRONMENT_ID,
  host: 'localhost',
  port: 5432,
  database: 'demo',
  username: 'analyst',
  password: 'hunter2',
  ssl: false,
}

describe('createConnection', () => {
  it('persists a connection and never stores the plaintext password', async () => {
    const { db, insertedByTable } = createMockDb({ environments: { id: ENVIRONMENT_ID, orgId: ORG_ID, type: 'development' } })
    const { client: executionQueue, calls } = createMockExecutionQueue()
    const result = await createConnection(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
      adminPrincipal,
      createInput,
    )

    expect(result.name).toBe('Primary')
    expect(calls[0]).toMatchObject({ type: JOB_NAMES.TEST_CONNECTION, password: 'hunter2' })
    const stored = insertedByTable.get(databaseConnections)?.[0]
    expect(stored?.['encryptedCredentials']).toBeDefined()
    expect(JSON.stringify(stored)).not.toContain('hunter2')
    expect(insertedByTable.get(auditLogs)?.[0]).toMatchObject({ action: 'DB_CONNECTION_CREATED' })
  })

  it('does not persist anything when the connectivity test fails', async () => {
    const { db, insertedByTable } = createMockDb({ environments: { id: ENVIRONMENT_ID, orgId: ORG_ID, type: 'development' } })
    const { client: executionQueue } = createMockExecutionQueue({
      [JOB_NAMES.TEST_CONNECTION]: { success: false, error: 'connection refused', encryptedCredentials: null },
    })

    await expect(
      createConnection({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue }, adminPrincipal, createInput),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect(insertedByTable.get(databaseConnections)).toBeUndefined()
  })

  it('rejects when the environment does not belong to the caller org', async () => {
    const { db } = createMockDb({ environments: undefined })
    const { client: executionQueue } = createMockExecutionQueue()
    await expect(
      createConnection({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue }, adminPrincipal, createInput),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('listConnections', () => {
  it('returns metadata without credentials', async () => {
    const { db } = createMockDb({})
    db.query.databaseConnections = {
      findMany: async () => [
        {
          id: CONNECTION_ID,
          orgId: ORG_ID,
          environmentId: ENVIRONMENT_ID,
          name: 'Primary',
          ssl: false,
          createdAt: new Date(),
          encryptedCredentials: 'should-not-appear',
        },
      ],
    } as never
    const { client: executionQueue } = createMockExecutionQueue()
    const result = await listConnections({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue }, analystPrincipal)

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('encryptedCredentials')
    expect(JSON.stringify(result)).not.toContain('should-not-appear')
  })
})

describe('captureSchema', () => {
  it('stores the returned snapshot and reports table count', async () => {
    const { db, insertedByTable } = createMockDb({
      databaseConnections: {
        id: CONNECTION_ID,
        orgId: ORG_ID,
        host: 'localhost',
        port: 5432,
        database: 'demo',
        ssl: false,
        encryptedCredentials: 'envelope',
      },
    })
    const { client: executionQueue } = createMockExecutionQueue({
      [JOB_NAMES.CAPTURE_SCHEMA]: {
        success: true,
        error: null,
        snapshot: { customers: [{ column: 'id', type: 'uuid', nullable: false, isPii: false }] },
      },
    })

    const result = await captureSchema(
      { db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue },
      adminPrincipal,
      CONNECTION_ID,
    )

    expect(result.tableCount).toBe(1)
    expect(insertedByTable.get(schemaSnapshots)?.[0]).toMatchObject({ connectionId: CONNECTION_ID })
  })

  it('rejects when the connection is not found in this org', async () => {
    const { db } = createMockDb({ databaseConnections: undefined })
    const { client: executionQueue } = createMockExecutionQueue()
    await expect(
      captureSchema({ db: db as never, cerbosClient: createAllowAllCerbosClient(ORG_ID), executionQueue }, adminPrincipal, CONNECTION_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
