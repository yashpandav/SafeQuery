export * from './types'
export * from './paseto'
export * from './keycloak'
export * from './service-token'

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}
