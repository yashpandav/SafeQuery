export interface VaultConfig {
  addr: string
  token: string
}

export interface RegisterConnectionParams {
  connectionId: string
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: boolean
}

export interface VaultCredential {
  username: string
  password: string
  leaseId: string
  leaseDuration: number
}

export interface VaultCredentialRef {
  type: 'vault'
  connectionId: string
}
