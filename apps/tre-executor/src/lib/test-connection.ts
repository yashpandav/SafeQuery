import { Client } from 'pg'
import { encryptDatabaseCredentials } from '@repo/secrets'
import type { TestConnectionJobData, TestConnectionJobResult } from '@repo/queue'
import { env } from '../env'
import { logger } from '../logger'

export type TestClientFactory = (data: TestConnectionJobData) => Client

const defaultTestClientFactory: TestClientFactory = (data) =>
  new Client({
    host: data.host,
    port: data.port,
    database: data.database,
    user: data.username,
    password: data.password,
    ssl: data.ssl,
    connectionTimeoutMillis: 5_000,
  })

function connectionContext(data: TestConnectionJobData) {
  return { host: data.host, port: data.port, database: data.database, ssl: data.ssl }
}

export async function handleTestConnection(
  data: TestConnectionJobData,
  clientFactory: TestClientFactory = defaultTestClientFactory,
): Promise<TestConnectionJobResult> {
  const client = clientFactory(data)
  try {
    await client.connect()
    await client.query('SELECT 1')
    const encryptedCredentials = encryptDatabaseCredentials(
      { username: data.username, password: data.password },
      env.CREDENTIAL_MASTER_KEY,
    )
    logger.info(connectionContext(data), 'test_connection succeeded')
    return { success: true, error: null, encryptedCredentials }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Connection failed'
    logger.warn({ ...connectionContext(data), err: error }, 'test_connection failed')
    return {
      success: false,
      error,
      encryptedCredentials: null,
    }
  } finally {
    await client.end().catch(() => {})
  }
}
