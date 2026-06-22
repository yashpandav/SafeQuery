'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'
import { Card } from '../components/card'
import { Button } from '../components/button'
import { getKeycloakToken } from '../../lib/keycloak'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [awaitingOrgSelection, setAwaitingOrgSelection] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [createOrgError, setCreateOrgError] = useState<string | null>(null)
  const router = useRouter()
  const trpc = useTRPC()
  const { session, setSession } = useSession()
  const exchangeToken = useMutation(trpc.auth.exchangeToken.mutationOptions())
  const createOrganization = useMutation(trpc.organization.create.mutationOptions())
  const organizations = useQuery({
    ...trpc.organization.list.queryOptions(),
    enabled: awaitingOrgSelection && Boolean(session),
  })

  async function handleCreateOrg(e: FormEvent) {
    e.preventDefault()
    setCreateOrgError(null)
    try {
      const org = await createOrganization.mutateAsync({ name: orgName, slug: orgSlug })
      selectOrganization(org.id, org.platformRole)
    } catch (err) {
      setCreateOrgError(err instanceof Error ? err.message : 'Failed to create organization')
    }
  }

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const keycloakToken = await getKeycloakToken(email, password)
      const exchanged = await exchangeToken.mutateAsync({ keycloakToken })
      setSession({ sessionToken: exchanged.sessionToken, userId: exchanged.user.id, email: exchanged.user.email, orgId: '', platformRole: '' })
      setAwaitingOrgSelection(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  function selectOrganization(orgId: string, platformRole: string) {
    if (!session) return
    setSession({ ...session, orgId, platformRole })
    router.push('/')
  }

  const singleOrg = organizations.data?.length === 1 ? organizations.data[0] : undefined
  useEffect(() => {
    if (!singleOrg || !session || session.orgId === singleOrg.id) return
    setSession({ ...session, orgId: singleOrg.id, platformRole: singleOrg.platformRole })
    router.push('/')
  }, [singleOrg, session, setSession, router])

  if (awaitingOrgSelection) {
    return (
      <Card className="mx-auto mt-12 max-w-sm">
        <h1 className="text-xl font-semibold">Select an organization</h1>
        <p className="mt-1 mb-4 text-sm text-muted">Pulled live from your memberships — nothing pasted or hardcoded.</p>

        {organizations.isPending && <p className="text-sm text-muted">Loading…</p>}
        {organizations.isError && (
          <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {organizations.error.message}
          </div>
        )}
        {organizations.data?.length === 0 && (
          <div className="mb-4 flex flex-col gap-3">
            <p className="text-sm text-muted">
              You are not a member of any organization yet. Ask an Owner/Admin to invite you, or create your own below.
            </p>
            <form onSubmit={handleCreateOrg} aria-label="Create an organization" className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="org-name" className="text-sm text-muted">
                  Organization name
                </label>
                <input
                  id="org-name"
                  type="text"
                  required
                  aria-required="true"
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value)
                    if (!slugTouched) setOrgSlug(slugify(e.target.value))
                  }}
                  className="rounded-lg border border-border bg-transparent px-3 py-2"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="org-slug" className="text-sm text-muted">
                  Slug
                </label>
                <input
                  id="org-slug"
                  type="text"
                  required
                  aria-required="true"
                  value={orgSlug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setOrgSlug(e.target.value)
                  }}
                  className="rounded-lg border border-border bg-transparent px-3 py-2"
                />
              </div>
              {createOrgError && (
                <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
                  {createOrgError}
                </div>
              )}
              <Button type="submit" variant="primary" disabled={createOrganization.isPending}>
                {createOrganization.isPending ? 'Creating…' : 'Create organization'}
              </Button>
            </form>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {organizations.data?.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => selectOrganization(org.id, org.platformRole)}
                className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition hover:bg-black/[0.03] active:scale-[0.99]"
              >
                <span className="font-medium">{org.name}</span>
                <span className="text-xs text-muted">{org.platformRole}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  const submitting = exchangeToken.isPending

  return (
    <Card className="mx-auto mt-12 max-w-sm">
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
            className="rounded-lg border border-border bg-transparent px-3 py-2"
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
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        {error && (
          <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  )
}
