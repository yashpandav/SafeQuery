import { encryptCredentials, decryptCredentials } from './envelope'
export interface DatabaseCredentials {
  username: string
  password: string
}

export function encryptDatabaseCredentials(creds: DatabaseCredentials, masterKeyHex: string): string {
  return encryptCredentials(JSON.stringify(creds), masterKeyHex)
}

export function decryptDatabaseCredentials(serialized: string, masterKeyHex: string): DatabaseCredentials {
  const plaintext = decryptCredentials(serialized, masterKeyHex)
  return JSON.parse(plaintext) as DatabaseCredentials
}
