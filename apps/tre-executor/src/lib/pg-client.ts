import { Client } from 'pg'
import type { ConnectionTarget } from '@repo/queue'
import { decryptDatabaseCredentials } from '@repo/secrets'
import { env } from '../env'
export type ClientFactory = (target: ConnectionTarget) => Client

export const defaultClientFactory: ClientFactory = (target) => {
  const { username, password } = decryptDatabaseCredentials(target.encryptedCredentials, env.CREDENTIAL_MASTER_KEY)
  return new Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: username,
    password,
    ssl: target.ssl,
    connectionTimeoutMillis: 5_000,
  })
}
