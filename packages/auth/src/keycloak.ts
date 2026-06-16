import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { KeycloakTokenPayload } from './types'

// JWKS sets are cached per (keycloakUrl, realm) pair — they auto-refresh on key rotation
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(keycloakUrl: string, realm: string) {
  const key = `${keycloakUrl}/realms/${realm}`
  if (!jwksCache.has(key)) {
    jwksCache.set(
      key,
      createRemoteJWKSet(
        new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`),
      ),
    )
  }
  return jwksCache.get(key)!
}

export async function verifyKeycloakToken(
  token: string,
  opts: { keycloakUrl: string; realm: string },
): Promise<KeycloakTokenPayload> {
  const jwks = getJwks(opts.keycloakUrl, opts.realm)
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${opts.keycloakUrl}/realms/${opts.realm}`,
  })
  if (!payload.sub || typeof (payload as Record<string, unknown>)['email'] !== 'string') {
    throw new Error('Keycloak token missing required claims (sub, email)')
  }
  return payload as unknown as KeycloakTokenPayload
}
