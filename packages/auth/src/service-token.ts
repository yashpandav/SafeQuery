import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'crypto'
import { V4 } from 'paseto'
export interface ServiceTokenPayload extends Record<string, unknown> {
  service: string // identity of the calling service, e.g. 'api'
}
export function generateServiceKeypairBase64(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return {
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(privateKey).toString('base64'),
  }
}

function privateKeyFromBase64(base64Pem: string): KeyObject {
  return createPrivateKey(Buffer.from(base64Pem, 'base64').toString('utf8'))
}

function publicKeyFromBase64(base64Pem: string): KeyObject {
  return createPublicKey(Buffer.from(base64Pem, 'base64').toString('utf8'))
}

export async function signServiceToken(
  payload: ServiceTokenPayload,
  privateKeyBase64: string,
  options: { expiresIn?: string; now?: Date } = {},
): Promise<string> {
  const key = privateKeyFromBase64(privateKeyBase64)
  return V4.sign(payload as Record<string, unknown>, key, {
    expiresIn: options.expiresIn ?? '5m',
    now: options.now,
  })
}

export async function verifyServiceToken(
  token: string,
  publicKeyBase64: string,
): Promise<ServiceTokenPayload> {
  const key = publicKeyFromBase64(publicKeyBase64)
  const payload = await V4.verify(token, key)
  return payload as unknown as ServiceTokenPayload
}
