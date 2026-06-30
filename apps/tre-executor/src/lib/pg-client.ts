import { Client } from 'pg'
import type { ConnectionTarget } from '@repo/queue'
import { decryptDatabaseCredentials } from '@repo/secrets'
import { createVaultDatabaseClient } from '@repo/vault-client'
import type { VaultDatabaseClient, VaultCredentialRef } from '@repo/vault-client'
import { env } from '../env'

export interface ResolvedConnection {
  client: Client
  revokeOnDone: () => Promise<void>
}

export type ClientFactory = (target: ConnectionTarget, role?: 'read' | 'write') => Promise<ResolvedConnection>

function tryParseVaultRef(encryptedCredentials: string): VaultCredentialRef | null {
  try {
    const parsed = JSON.parse(encryptedCredentials) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>).type === 'vault' &&
      typeof (parsed as Record<string, unknown>).connectionId === 'string'
    ) {
      return parsed as VaultCredentialRef
    }
  } catch {
  }
  return null
}

const vaultClient: VaultDatabaseClient | null =
  env.VAULT_ADDR && env.VAULT_TOKEN
    ? createVaultDatabaseClient({ addr: env.VAULT_ADDR, token: env.VAULT_TOKEN })
    : null

export const defaultClientFactory: ClientFactory = async (target, role = 'read') => {
  const vaultRef = tryParseVaultRef(target.encryptedCredentials)

  if (vaultRef) {
    if (!vaultClient) {
      throw new Error(
        `Connection ${vaultRef.connectionId} uses Vault credentials but VAULT_ADDR/VAULT_TOKEN are not configured`,
      )
    }
    const cred = await vaultClient.mintCredentials(vaultRef.connectionId, role)
    const client = new Client({
      host: target.host,
      port: target.port,
      database: target.database,
      user: cred.username,
      password: cred.password,
      ssl: target.ssl,
      connectionTimeoutMillis: 5_000,
    })
    return {
      client,
      revokeOnDone: () => vaultClient.revokeLease(cred.leaseId),
    }
  }

  const { username, password } = decryptDatabaseCredentials(target.encryptedCredentials, env.CREDENTIAL_MASTER_KEY)
  const client = new Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: username,
    password,
    ssl: target.ssl,
    connectionTimeoutMillis: 5_000,
  })
  return { client, revokeOnDone: async () => { } }
}
