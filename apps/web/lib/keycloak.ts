const KEYCLOAK_URL = process.env['NEXT_PUBLIC_KEYCLOAK_URL'] ?? 'http://localhost:8080'

export async function getKeycloakToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/safequery/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'safequery-web', username: email, password }),
  })
  if (!res.ok) throw new Error('Invalid Keycloak credentials')
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}
