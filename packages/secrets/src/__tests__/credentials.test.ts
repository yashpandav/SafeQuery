import { describe, it, expect } from 'vitest'
import { encryptDatabaseCredentials, decryptDatabaseCredentials } from '../credentials'
import { generateMasterKeyHex } from '../envelope'

describe('database credential helpers', () => {
  it('round-trips a username/password pair', () => {
    const key = generateMasterKeyHex()
    const ciphertext = encryptDatabaseCredentials({ username: 'tre_reader', password: "p@ssw0rd'; --" }, key)
    expect(decryptDatabaseCredentials(ciphertext, key)).toEqual({ username: 'tre_reader', password: "p@ssw0rd'; --" })
  })

  it('never leaks the password into the stored ciphertext', () => {
    const key = generateMasterKeyHex()
    const ciphertext = encryptDatabaseCredentials({ username: 'admin', password: 'findable-marker-xyz' }, key)
    expect(ciphertext).not.toContain('findable-marker-xyz')
    expect(ciphertext).not.toContain('admin')
  })
})
