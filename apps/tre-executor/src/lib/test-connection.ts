import { Client } from 'pg'
import { encryptDatabaseCredentials } from '@repo/secrets'
import { createVaultDatabaseClient } from '@repo/vault-client'
import type { VaultDatabaseClient } from '@repo/vault-client'
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

const defaultVaultClient: VaultDatabaseClient | null =
  env.VAULT_ADDR && env.VAULT_TOKEN
    ? createVaultDatabaseClient({ addr: env.VAULT_ADDR, token: env.VAULT_TOKEN })
    : null

function connectionContext(data: TestConnectionJobData) {
  return { host: data.host, port: data.port, database: data.database, ssl: data.ssl }
}

export async function handleTestConnection(
  data: TestConnectionJobData,
  clientFactory: TestClientFactory = defaultTestClientFactory,
  vaultClient: VaultDatabaseClient | null = defaultVaultClient,
): Promise<TestConnectionJobResult> {
  const client = clientFactory(data)
  try {
    await client.connect()
    await client.query('SELECT 1')

    if (vaultClient) {
      try {
        await vaultClient.registerConnection({
          connectionId: data.connectionId,
          host: data.host,
          port: data.port,
          database: data.database,
          username: data.username,
          password: data.password,
          ssl: data.ssl,
        })
        const encryptedCredentials = JSON.stringify({ type: 'vault', connectionId: data.connectionId })
        logger.info({ ...connectionContext(data), vault: true }, 'test_connection succeeded (Vault)')
        return { success: true, error: null, encryptedCredentials }
      } catch (vaultErr) {
        logger.warn(
          { ...connectionContext(data), err: vaultErr instanceof Error ? vaultErr.message : String(vaultErr) },
          'Vault registration failed — falling back to envelope encryption',
        )
      }
    }

    const encryptedCredentials = encryptDatabaseCredentials(
      { username: data.username, password: data.password },
      env.CREDENTIAL_MASTER_KEY,
    )
    logger.info({ ...connectionContext(data), vault: false }, 'test_connection succeeded')
    return { success: true, error: null, encryptedCredentials }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Connection failed'
    logger.warn({ ...connectionContext(data), err: error }, 'test_connection failed')
    return { success: false, error, encryptedCredentials: null }
  } finally {
    await client.end().catch(() => { })
  }
}
