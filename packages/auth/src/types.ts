// Extends Record so it's assignable to the paseto library's payload type
export interface SessionPayload extends Record<string, unknown> {
  userId: string
  sessionId: string
  // standard PASETO registered claims (added by the library)
  iat?: string
  exp?: string
}

export interface KeycloakTokenPayload {
  sub: string             // Keycloak user UUID — used as keycloak_id in our users table
  email: string
  email_verified: boolean
  name?: string
  given_name?: string
  family_name?: string
  preferred_username?: string
  iss: string
  aud: string | string[]
  exp: number
  iat: number
}
