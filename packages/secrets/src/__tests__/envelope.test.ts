import { describe, it, expect } from 'vitest'
import { encryptCredentials, decryptCredentials, generateMasterKeyHex } from '../envelope'

describe('envelope encryption', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const key = generateMasterKeyHex()
    const ciphertext = encryptCredentials('super-secret-password', key)
    expect(decryptCredentials(ciphertext, key)).toBe('super-secret-password')
  })

  it('produces a different ciphertext each time (random IV + DEK)', () => {
    const key = generateMasterKeyHex()
    const a = encryptCredentials('same plaintext', key)
    const b = encryptCredentials('same plaintext', key)
    expect(a).not.toBe(b)
  })

  it('never stores the plaintext anywhere in the serialized payload', () => {
    const key = generateMasterKeyHex()
    const ciphertext = encryptCredentials('findable-secret-value', key)
    expect(ciphertext).not.toContain('findable-secret-value')
  })

  it('rejects decryption with the wrong master key', () => {
    const keyA = generateMasterKeyHex()
    const keyB = generateMasterKeyHex()
    const ciphertext = encryptCredentials('secret', keyA)
    expect(() => decryptCredentials(ciphertext, keyB)).toThrow()
  })

  it('rejects a tampered ciphertext (GCM auth tag catches modification)', () => {
    const key = generateMasterKeyHex()
    const ciphertext = encryptCredentials('secret', key)
    const payload = JSON.parse(ciphertext)
    payload.ciphertext = Buffer.from('tampered-bytes-here-12').toString('base64')
    expect(() => decryptCredentials(JSON.stringify(payload), key)).toThrow()
  })

  it('rejects a tampered wrapped DEK', () => {
    const key = generateMasterKeyHex()
    const ciphertext = encryptCredentials('secret', key)
    const payload = JSON.parse(ciphertext)
    payload.encryptedDek = Buffer.from('tampered-dek-bytes-here').toString('base64')
    expect(() => decryptCredentials(JSON.stringify(payload), key)).toThrow()
  })

  it('rejects a master key of the wrong length', () => {
    expect(() => encryptCredentials('secret', 'too-short')).toThrow(/32 bytes/)
    expect(() => decryptCredentials('{}', 'too-short')).toThrow(/32 bytes/)
  })

  it('rejects malformed serialized payloads', () => {
    const key = generateMasterKeyHex()
    expect(() => decryptCredentials('not json at all', key)).toThrow(/valid JSON/)
  })

  it('generateMasterKeyHex produces distinct, correctly-sized keys', () => {
    const a = generateMasterKeyHex()
    const b = generateMasterKeyHex()
    expect(a).not.toBe(b)
    expect(a).toHaveLength(64) // 32 bytes as hex
  })
})
