import { createSecretKey, randomBytes } from 'crypto'
import { V3 } from 'paseto'
import type { SessionPayload } from './types'

// PASETO v3.local: AES-256-CTR + HMAC-SHA384 (Node.js native crypto, no XChaCha20 dep).
// Key must be exactly 32 bytes (64 hex chars) — store in PASETO_LOCAL_KEY env var.

function localKeyFromHex(hexKey: string) {
  const buf = Buffer.from(hexKey, 'hex')
  if (buf.length !== 32) {
    throw new Error('PASETO_LOCAL_KEY must be exactly 32 bytes (64 hex characters)')
  }
  return createSecretKey(buf)
}

export async function signSession(
  payload: SessionPayload,
  hexKey: string,
  options: { expiresIn?: string } = {},
): Promise<string> {
  const key = localKeyFromHex(hexKey)
  return V3.encrypt(payload as Record<string, unknown>, key, {
    expiresIn: options.expiresIn ?? '8h',
  })
}

export async function verifySession(token: string, hexKey: string): Promise<SessionPayload> {
  const key = localKeyFromHex(hexKey)
  const payload = await V3.decrypt(token, key)
  return payload as unknown as SessionPayload
}

// Run once to populate PASETO_LOCAL_KEY:
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
export function generateLocalKeyHex(): string {
  return randomBytes(32).toString('hex')
}
