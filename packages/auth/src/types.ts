export interface SessionPayload extends Record<string, unknown> {
  userId: string
  sessionId: string
  iat?: string
  exp?: string
}

export interface KeycloakTokenPayload {
  sub: string
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
