import type { VaultConfig, RegisterConnectionParams, VaultCredential } from './types'

const READ_ROLE_TTL = '5m'
const WRITE_ROLE_TTL = '2m'

const PG_PLUGIN = 'postgresql-database-plugin'

function creationSQL(grants: string): string {
  return [
    `CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';`,
    `${grants};`,
    `GRANT CONNECT ON DATABASE {{database}} TO "{{name}}";`,
  ].join(' ')
}

const READ_CREATION_SQL = creationSQL(
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{name}}"; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "{{name}}"',
)
const WRITE_CREATION_SQL = creationSQL(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{{name}}"; GRANT USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "{{name}}"',
)
const REVOCATION_SQL =
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "{{name}}"; REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "{{name}}"; DROP ROLE IF EXISTS "{{name}}";'

function configName(connectionId: string): string { return `safequery-${connectionId}` }
function readRoleName(connectionId: string): string { return `safequery-${connectionId}-read` }
function writeRoleName(connectionId: string): string { return `safequery-${connectionId}-write` }

async function vaultFetch(
  config: VaultConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${config.addr}/v1/${path}`, {
    method,
    headers: {
      'X-Vault-Token': config.token,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // 204 No Content — success with no body
  if (res.status === 204) return { status: 204, data: null }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    const errors = Array.isArray((data as { errors?: string[] })?.errors)
      ? (data as { errors: string[] }).errors.join(', ')
      : `HTTP ${res.status}`
    throw new Error(`Vault ${method} /${path} failed: ${errors}`)
  }

  return { status: res.status, data }
}

export function createVaultDatabaseClient(config: VaultConfig) {
  async function ensureMountEnabled(): Promise<void> {
    try {
      await vaultFetch(config, 'POST', 'sys/mounts/database', { type: 'database' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!msg.includes('already in use') && !msg.includes('path is already')) throw err
    }
  }

  async function registerConnection(params: RegisterConnectionParams): Promise<void> {
    await ensureMountEnabled()

    const sslmode = params.ssl ? 'require' : 'disable'
    const connectionUrl =
      `postgresql://{{username}}:{{password}}@${params.host}:${params.port}/${params.database}?sslmode=${sslmode}`

    const name = configName(params.connectionId)
    const readRole = readRoleName(params.connectionId)
    const writeRole = writeRoleName(params.connectionId)

    await vaultFetch(config, 'POST', `database/config/${name}`, {
      plugin_name: PG_PLUGIN,
      connection_url: connectionUrl,
      allowed_roles: [readRole, writeRole],
      username: params.username,
      password: params.password,
      verify_connection: true,
    })

    // Create the read-only role.
    await vaultFetch(config, 'POST', `database/roles/${readRole}`, {
      db_name: name,
      creation_statements: [READ_CREATION_SQL],
      revocation_statements: [REVOCATION_SQL],
      default_ttl: READ_ROLE_TTL,
      max_ttl: READ_ROLE_TTL,
    })

    await vaultFetch(config, 'POST', `database/roles/${writeRole}`, {
      db_name: name,
      creation_statements: [WRITE_CREATION_SQL],
      revocation_statements: [REVOCATION_SQL],
      default_ttl: WRITE_ROLE_TTL,
      max_ttl: WRITE_ROLE_TTL,
    })
  }

  async function mintCredentials(
    connectionId: string,
    role: 'read' | 'write',
  ): Promise<VaultCredential> {
    const roleName = role === 'read' ? readRoleName(connectionId) : writeRoleName(connectionId)
    const { data } = await vaultFetch(config, 'GET', `database/creds/${roleName}`)
    const payload = data as { data: { username: string; password: string }; lease_id: string; lease_duration: number }
    return {
      username: payload.data.username,
      password: payload.data.password,
      leaseId: payload.lease_id,
      leaseDuration: payload.lease_duration,
    }
  }

  async function revokeLease(leaseId: string): Promise<void> {
    await vaultFetch(config, 'PUT', 'sys/leases/revoke', { lease_id: leaseId })
  }

  async function deregisterConnection(connectionId: string): Promise<void> {
    const name = configName(connectionId)
    const readRole = readRoleName(connectionId)
    const writeRole = writeRoleName(connectionId)
    // Best-effort — ignore errors so a missing connection doesn't block cleanup.
    await vaultFetch(config, 'DELETE', `database/roles/${writeRole}`).catch(() => { })
    await vaultFetch(config, 'DELETE', `database/roles/${readRole}`).catch(() => { })
    await vaultFetch(config, 'DELETE', `database/config/${name}`).catch(() => { })
  }

  return { registerConnection, mintCredentials, revokeLease, deregisterConnection }
}

export type VaultDatabaseClient = ReturnType<typeof createVaultDatabaseClient>
