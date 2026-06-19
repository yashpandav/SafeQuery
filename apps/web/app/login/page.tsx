'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'

const KEYCLOAK_URL = process.env['NEXT_PUBLIC_KEYCLOAK_URL'] ?? 'http://localhost:8080'

async function getKeycloakToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/safequery/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'safequery-web', username: email, password }),
  })
  if (!res.ok) throw new Error('Invalid Keycloak credentials')
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [awaitingOrgSelection, setAwaitingOrgSelection] = useState(false)
  const router = useRouter()
  const trpc = useTRPC()
  const { session, setSession } = useSession()
  const exchangeToken = useMutation(trpc.auth.exchangeToken.mutationOptions())
  const organizations = useQuery({
    ...trpc.organization.list.queryOptions(),
    enabled: awaitingOrgSelection && Boolean(session),
  })

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const keycloakToken = await getKeycloakToken(email, password)
      const exchanged = await exchangeToken.mutateAsync({ keycloakToken })
      setSession({ sessionToken: exchanged.sessionToken, userId: exchanged.user.id, email: exchanged.user.email, orgId: '' })
      setAwaitingOrgSelection(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  function selectOrganization(orgId: string) {
    if (!session) return
    setSession({ ...session, orgId })
    router.push('/')
  }

  const singleOrgId = organizations.data?.length === 1 ? organizations.data[0]?.id : undefined
  useEffect(() => {
    if (!singleOrgId || !session || session.orgId === singleOrgId) return
    setSession({ ...session, orgId: singleOrgId })
    router.push('/')
  }, [singleOrgId, session, setSession, router])

  if (awaitingOrgSelection) {
    return (
      <div className="mx-auto mt-12 max-w-sm rounded-lg border border-border p-6">
        <h1 className="text-xl font-semibold">Select an organization</h1>
        <p className="mt-1 mb-4 text-sm text-muted">Pulled live from your memberships — nothing pasted or hardcoded.</p>

        {organizations.isPending && <p className="text-sm text-muted">Loading…</p>}
        {organizations.isError && (
          <div role="alert" className="rounded border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger">
            {organizations.error.message}
          </div>
        )}
        {organizations.data?.length === 0 && (
          <p className="text-sm text-muted">
            You are not a member of any organization yet. Ask an Owner/Admin to invite you, or run{' '}
            <code className="text-xs">pnpm --filter @repo/db db:seed</code>.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {organizations.data?.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => selectOrganization(org.id)}
                className="flex w-full items-center justify-between rounded border border-border px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span className="font-medium">{org.name}</span>
                <span className="text-xs text-muted">{org.platformRole}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const submitting = exchangeToken.isPending

  return (
    <div className="mx-auto mt-12 max-w-sm rounded-lg border border-border p-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 mb-4 text-sm text-muted">
        Dev-only direct grant against Keycloak — production would use OIDC redirect + PKCE instead.
      </p>
      <form onSubmit={handleCredentialsSubmit} aria-label="Sign in form" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            aria-required="true"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-muted">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            aria-required="true"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-border bg-transparent px-3 py-2"
          />
        </div>
        {error && (
          <div role="alert" className="rounded border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
