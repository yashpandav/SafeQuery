import { TRPCError } from '@trpc/server'
import { env } from '../env'

async function getKeycloakAdminToken(): Promise<string> {
  const resp = await fetch(
    `${env.KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: env.KEYCLOAK_ADMIN_USER,
        password: env.KEYCLOAK_ADMIN_PASSWORD,
      }),
    },
  )
  if (!resp.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to obtain Keycloak admin token' })
  }
  const data = (await resp.json()) as { access_token: string }
  return data.access_token
}

export async function createKeycloakUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const adminToken = await getKeycloakAdminToken()

  const resp = await fetch(
    `${env.KEYCLOAK_URL}/admin/realms/${env.KEYCLOAK_REALM}/users`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: email.toLowerCase(),
        email: email.toLowerCase(),
        emailVerified: true,
        enabled: true,
        firstName,
        lastName,
        credentials: [{ type: 'password', value: password, temporary: false }],
      }),
    },
  )

  if (resp.status === 409) {
    throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' })
  }
  if (!resp.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create account' })
  }

  const location = resp.headers.get('Location') ?? ''
  const keycloakId = location.split('/').at(-1) ?? ''
  if (!keycloakId) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Keycloak did not return a user ID' })
  }

  return keycloakId
}
