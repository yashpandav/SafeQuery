import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV is the GCM-recommended size
const KEY_LENGTH = 32 // 256-bit keys

interface AesGcmResult {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
}

function aesGcmEncrypt(plaintext: Buffer, key: Buffer): AesGcmResult {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

function aesGcmDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function parseMasterKey(masterKeyHex: string): Buffer {
  const key = Buffer.from(masterKeyHex, 'hex')
  if (key.length !== KEY_LENGTH) {
    throw new Error('Master key must be exactly 32 bytes (64 hex characters)')
  }
  return key
}

interface EncryptedPayload {
  ciphertext: string // base64
  iv: string
  authTag: string
  encryptedDek: string
  dekIv: string
  dekAuthTag: string
}
export function encryptCredentials(plaintext: string, masterKeyHex: string): string {
  const masterKey = parseMasterKey(masterKeyHex)
  const dek = randomBytes(KEY_LENGTH)

  const data = aesGcmEncrypt(Buffer.from(plaintext, 'utf8'), dek)
  const wrappedDek = aesGcmEncrypt(dek, masterKey)

  const payload: EncryptedPayload = {
    ciphertext: data.ciphertext.toString('base64'),
    iv: data.iv.toString('base64'),
    authTag: data.authTag.toString('base64'),
    encryptedDek: wrappedDek.ciphertext.toString('base64'),
    dekIv: wrappedDek.iv.toString('base64'),
    dekAuthTag: wrappedDek.authTag.toString('base64'),
  }
  return JSON.stringify(payload)
}

export function decryptCredentials(serialized: string, masterKeyHex: string): string {
  const masterKey = parseMasterKey(masterKeyHex)

  let payload: EncryptedPayload
  try {
    payload = JSON.parse(serialized) as EncryptedPayload
  } catch {
    throw new Error('Encrypted credentials are not valid JSON')
  }

  const dek = aesGcmDecrypt(
    Buffer.from(payload.encryptedDek, 'base64'),
    masterKey,
    Buffer.from(payload.dekIv, 'base64'),
    Buffer.from(payload.dekAuthTag, 'base64'),
  )
  const plaintext = aesGcmDecrypt(
    Buffer.from(payload.ciphertext, 'base64'),
    dek,
    Buffer.from(payload.iv, 'base64'),
    Buffer.from(payload.authTag, 'base64'),
  )
  return plaintext.toString('utf8')
}
export function generateMasterKeyHex(): string {
  return randomBytes(KEY_LENGTH).toString('hex')
}
