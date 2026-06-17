import { describe, it, expect } from 'vitest'
import {
  generateServiceKeypairBase64,
  signServiceToken,
  verifyServiceToken,
} from '../service-token'

describe('service token (PASETO v4.public)', () => {
  it('signs and verifies a token with a matching keypair', async () => {
    const { publicKey, privateKey } = generateServiceKeypairBase64()
    const token = await signServiceToken({ service: 'api' }, privateKey)
    const payload = await verifyServiceToken(token, publicKey)
    expect(payload.service).toBe('api')
  })

  it('rejects a token verified against a different keypair', async () => {
    const keypairA = generateServiceKeypairBase64()
    const keypairB = generateServiceKeypairBase64()
    const token = await signServiceToken({ service: 'api' }, keypairA.privateKey)
    await expect(verifyServiceToken(token, keypairB.publicKey)).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { publicKey, privateKey } = generateServiceKeypairBase64()
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const token = await signServiceToken({ service: 'api' }, privateKey, {
      expiresIn: '1s',
      now: anHourAgo,
    })
    await expect(verifyServiceToken(token, publicKey)).rejects.toThrow()
  })

  it('rejects a tampered token', async () => {
    const { publicKey, privateKey } = generateServiceKeypairBase64()
    const token = await signServiceToken({ service: 'api' }, privateKey)
    const tampered = token.slice(0, -4) + 'abcd'
    await expect(verifyServiceToken(tampered, publicKey)).rejects.toThrow()
  })

  it('generates distinct keypairs on each call', () => {
    const a = generateServiceKeypairBase64()
    const b = generateServiceKeypairBase64()
    expect(a.privateKey).not.toBe(b.privateKey)
    expect(a.publicKey).not.toBe(b.publicKey)
  })
})
