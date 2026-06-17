import { describe, it, expect } from 'vitest'
import { handleCaptureSchema, buildSnapshot } from '../lib/capture-schema'
import { createFakeClient } from './fake-client'
import type { ConnectionTarget } from '@repo/queue'

const connection: ConnectionTarget = {
  host: 'localhost',
  port: 5432,
  database: 'demo',
  ssl: false,
  encryptedCredentials: 'irrelevant-for-this-handler', // capture-schema never decrypts; pg-client.ts does
}

describe('buildSnapshot', () => {
  it('groups columns by table', () => {
    const snapshot = buildSnapshot([
      { table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { table_name: 'customers', column_name: 'email', data_type: 'text', is_nullable: 'NO' },
      { table_name: 'orders', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
    ])
    expect(Object.keys(snapshot)).toEqual(['customers', 'orders'])
    expect(snapshot['customers']).toHaveLength(2)
  })

  it('flags likely-PII columns by name', () => {
    const snapshot = buildSnapshot([
      { table_name: 'customers', column_name: 'email', data_type: 'text', is_nullable: 'NO' },
      { table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
    ])
    expect(snapshot['customers']?.find((c) => c.column === 'email')?.isPii).toBe(true)
    expect(snapshot['customers']?.find((c) => c.column === 'id')?.isPii).toBe(false)
  })

  it('maps is_nullable correctly', () => {
    const snapshot = buildSnapshot([{ table_name: 't', column_name: 'c', data_type: 'text', is_nullable: 'YES' }])
    expect(snapshot['t']?.[0]?.nullable).toBe(true)
  })
})

describe('handleCaptureSchema', () => {
  it('returns a snapshot built from information_schema rows', async () => {
    const { client } = createFakeClient({
      onQuery: () => ({
        rows: [{ table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' }],
      }),
    })
    const result = await handleCaptureSchema({ type: 'capture_schema', connection }, () => client)

    expect(result.success).toBe(true)
    expect(result.snapshot).toEqual({ customers: [{ column: 'id', type: 'uuid', nullable: false, isPii: false }] })
  })

  it('returns failure when the connection cannot be established', async () => {
    const { client } = createFakeClient({ failConnect: new Error('no route to host') })
    const result = await handleCaptureSchema({ type: 'capture_schema', connection }, () => client)

    expect(result.success).toBe(false)
    expect(result.error).toContain('no route to host')
    expect(result.snapshot).toBeNull()
  })
})
