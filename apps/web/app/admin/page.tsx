'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'
import { Card } from '../components/card'
import { Badge, type RiskTone } from '../components/badge'
import { Button } from '../components/button'
import { RoleForm, roleToFormValues } from './role-form'
import { ConnectionForm } from './connection-form'

const ENV_TONE: Record<string, RiskTone> = {
  development: 'safe',
  staging: 'warning',
  production: 'critical',
}

export default function AdminPage() {
  const { session } = useSession()
  const router = useRouter()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const isAdmin = session?.platformRole === 'admin' || session?.platformRole === 'owner'

  useEffect(() => {
    if (!session) router.replace('/login')
    else if (!isAdmin) router.replace('/')
  }, [session, isAdmin, router])

  const summary = useQuery({ ...trpc.dashboard.summary.queryOptions(), enabled: Boolean(session) && isAdmin })
  const roles = useQuery({ ...trpc.customRole.list.queryOptions(), enabled: Boolean(session) && isAdmin })
  const envs = useQuery({ ...trpc.environment.list.queryOptions(), enabled: Boolean(session) && isAdmin })
  const connections = useQuery({ ...trpc.databaseConnection.list.queryOptions(), enabled: Boolean(session) && isAdmin })
  const rateLimits = useQuery({ ...trpc.policy.getRateLimits.queryOptions(), enabled: Boolean(session) && isAdmin })
  const invitations = useQuery({ ...trpc.invitation.list.queryOptions(), enabled: Boolean(session) && isAdmin })
  const members = useQuery({ ...trpc.member.list.queryOptions(), enabled: Boolean(session) && isAdmin })

  const createEnv = useMutation(trpc.environment.create.mutationOptions())
  const createRole = useMutation(trpc.customRole.create.mutationOptions())
  const updateRole = useMutation(trpc.customRole.update.mutationOptions())
  const deleteRole = useMutation(trpc.customRole.delete.mutationOptions())
  const updateEnvType = useMutation(trpc.environment.updateType.mutationOptions())
  const createConnection = useMutation(trpc.databaseConnection.create.mutationOptions())
  const captureSchema = useMutation(trpc.databaseConnection.captureSchema.mutationOptions())
  const updateWriteWindow = useMutation(trpc.environment.updateWriteWindow.mutationOptions())
  const updateRateLimits = useMutation(trpc.policy.updateRateLimits.mutationOptions())
  const createInvitation = useMutation(trpc.invitation.create.mutationOptions())
  const revokeInvitation = useMutation(trpc.invitation.revoke.mutationOptions())
  const updateMemberRole = useMutation(trpc.member.updateRole.mutationOptions())
  const removeMember = useMutation(trpc.member.remove.mutationOptions())

  const [showCreateEnvForm, setShowCreateEnvForm] = useState(false)
  const [envDraft, setEnvDraft] = useState({ name: '', type: 'development' as 'development' | 'staging' | 'production' })
  const [envError, setEnvError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [showConnectionForm, setShowConnectionForm] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [captureResults, setCaptureResults] = useState<Record<string, string>>({})
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [editingWindowEnvId, setEditingWindowEnvId] = useState<string | null>(null)
  const [windowDraft, setWindowDraft] = useState({ start: '09:00', end: '17:00', timezone: 'UTC' })
  const [windowError, setWindowError] = useState<string | null>(null)
  const [rateLimitDraft, setRateLimitDraft] = useState<{ enabled: boolean; queriesPerMinutePerUser: string; aiCallsPerDayPerOrg: string } | null>(null)
  const [rateLimitError, setRateLimitError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'reviewer' | 'analyst' | 'viewer'>('analyst')
  const [inviteCustomRoleId, setInviteCustomRoleId] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)

  useEffect(() => {
    if (rateLimits.data && !rateLimitDraft) {
      setRateLimitDraft({
        enabled: rateLimits.data.enabled,
        queriesPerMinutePerUser: String(rateLimits.data.queriesPerMinutePerUser),
        aiCallsPerDayPerOrg: String(rateLimits.data.aiCallsPerDayPerOrg),
      })
    }
  }, [rateLimits.data, rateLimitDraft])

  async function refetchEnvs() {
    await queryClient.invalidateQueries({ queryKey: trpc.environment.list.queryKey() })
  }

  async function refetchRoles() {
    await queryClient.invalidateQueries({ queryKey: trpc.customRole.list.queryKey() })
  }

  async function refetchConnections() {
    await queryClient.invalidateQueries({ queryKey: trpc.databaseConnection.list.queryKey() })
  }

  async function refetchInvitations() {
    await queryClient.invalidateQueries({ queryKey: trpc.invitation.list.queryKey() })
  }

  async function refetchMembers() {
    await queryClient.invalidateQueries({ queryKey: trpc.member.list.queryKey() })
  }

  if (!session || !isAdmin) return null

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Workspace settings</h1>
        <p className="mt-1 text-sm text-muted">Environments · Connections · Roles · Members</p>
      </div>

      {summary.data && (
        <div className="grid grid-cols-4 gap-3">
          <Card>
            <p className="text-xs text-muted">Queries today</p>
            <p className="text-2xl font-semibold">{summary.data.queriesToday.total}</p>
            <p className="text-xs text-muted">
              {summary.data.queriesToday.safe} safe · {summary.data.queriesToday.warning} warning · {summary.data.queriesToday.critical} critical
            </p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Pending approvals</p>
            <p className="text-2xl font-semibold">{summary.data.pendingApprovals.count}</p>
            <p className="text-xs text-muted">
              {summary.data.pendingApprovals.avgWaitMinutes !== null ? `avg wait ${summary.data.pendingApprovals.avgWaitMinutes} min` : 'none pending'}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Security incidents</p>
            <p className="text-2xl font-semibold">{summary.data.securityIncidentsLast30Days}</p>
            <p className="text-xs text-muted">last 30 days</p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Audit integrity</p>
            <p className="text-2xl font-semibold">
              <Badge tone={summary.data.auditIntegrity.valid ? 'safe' : 'critical'}>{summary.data.auditIntegrity.valid ? 'Verified' : 'Tampered'}</Badge>
            </p>
          </Card>
        </div>
      )}

      {/* ── Step 1: Environments ─────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Environments</h2>
            <p className="mt-0.5 text-xs text-muted">Create at least one environment before adding a database connection.</p>
          </div>
          {!showCreateEnvForm && (
            <Button variant="secondary" onClick={() => { setShowCreateEnvForm(true); setEnvError(null) }}>
              New environment
            </Button>
          )}
        </div>

        {showCreateEnvForm && (
          <form
            aria-label="Create environment"
            className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setEnvError(null)
              try {
                await createEnv.mutateAsync({ name: envDraft.name, type: envDraft.type })
                setEnvDraft({ name: '', type: 'development' })
                setShowCreateEnvForm(false)
                await refetchEnvs()
              } catch (err) {
                setEnvError(err instanceof Error ? err.message : 'Failed to create environment')
              }
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="env-name" className="text-xs text-muted">Name</label>
              <input
                id="env-name"
                type="text"
                required
                aria-required="true"
                placeholder="e.g. Production"
                value={envDraft.name}
                onChange={(e) => setEnvDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-48 rounded border border-border bg-transparent px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="env-type" className="text-xs text-muted">Type</label>
              <select
                id="env-type"
                value={envDraft.type}
                onChange={(e) => setEnvDraft((d) => ({ ...d, type: e.target.value as typeof d.type }))}
                className="rounded border border-border bg-transparent px-2 py-1 text-sm"
              >
                <option value="development">development</option>
                <option value="staging">staging</option>
                <option value="production">production</option>
              </select>
            </div>
            <Button type="submit" variant="primary" disabled={createEnv.isPending}>
              {createEnv.isPending ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCreateEnvForm(false)}>
              Cancel
            </Button>
          </form>
        )}

        {envError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{envError}</div>
        )}
        {envs.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{envs.error.message}</div>
        )}
        {windowError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{windowError}</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Environment</th>
                <th className="border-b border-border px-3 py-2">Type</th>
                <th className="border-b border-border px-3 py-2">Posture</th>
                <th className="border-b border-border px-3 py-2">Write window</th>
                <th className="border-b border-border px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {envs.data?.map((env) => (
                <Fragment key={env.id}>
                  <tr>
                    <td className="border-b border-border px-3 py-2 font-medium">{env.name}</td>
                    <td className="border-b border-border px-3 py-2">
                      <Badge tone={ENV_TONE[env.type] ?? 'neutral'}>{env.type}</Badge>
                    </td>
                    <td className="border-b border-border px-3 py-2 text-xs text-muted">{env.posture}</td>
                    <td className="border-b border-border px-3 py-2 text-xs text-muted">
                      {env.writeWindow ? (
                        <div className="flex items-center gap-1.5">
                          <span>{env.writeWindow.start}–{env.writeWindow.end} ({env.writeWindow.timezone})</span>
                          <Badge tone={env.withinWriteWindowNow ? 'safe' : 'critical'}>{env.withinWriteWindowNow ? 'open now' : 'closed now'}</Badge>
                        </div>
                      ) : (
                        <Badge tone="neutral">unrestricted</Badge>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <select
                          aria-label={`Change ${env.name}'s environment type`}
                          value={env.type}
                          disabled={updateEnvType.isPending}
                          onChange={async (e) => {
                            await updateEnvType.mutateAsync({ environmentId: env.id, type: e.target.value as 'development' | 'staging' | 'production' })
                            await refetchEnvs()
                          }}
                          className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                        >
                          <option value="development">development</option>
                          <option value="staging">staging</option>
                          <option value="production">production</option>
                        </select>
                        <button
                          type="button"
                          className="text-xs text-ink underline"
                          onClick={() => {
                            setWindowError(null)
                            if (editingWindowEnvId === env.id) {
                              setEditingWindowEnvId(null)
                              return
                            }
                            setEditingWindowEnvId(env.id)
                            setWindowDraft(env.writeWindow ?? { start: '09:00', end: '17:00', timezone: 'UTC' })
                          }}
                        >
                          {editingWindowEnvId === env.id ? 'Close' : 'Edit window'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingWindowEnvId === env.id && (
                    <tr>
                      <td colSpan={5} className="border-b border-border p-3">
                        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`window-start-${env.id}`} className="text-xs text-muted">Start</label>
                            <input
                              id={`window-start-${env.id}`}
                              type="time"
                              value={windowDraft.start}
                              onChange={(e) => setWindowDraft((d) => ({ ...d, start: e.target.value }))}
                              className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`window-end-${env.id}`} className="text-xs text-muted">End</label>
                            <input
                              id={`window-end-${env.id}`}
                              type="time"
                              value={windowDraft.end}
                              onChange={(e) => setWindowDraft((d) => ({ ...d, end: e.target.value }))}
                              className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`window-tz-${env.id}`} className="text-xs text-muted">Timezone (IANA)</label>
                            <input
                              id={`window-tz-${env.id}`}
                              type="text"
                              value={windowDraft.timezone}
                              onChange={(e) => setWindowDraft((d) => ({ ...d, timezone: e.target.value }))}
                              placeholder="UTC"
                              className="w-40 rounded border border-border bg-transparent px-2 py-1 text-xs"
                            />
                          </div>
                          <Button
                            variant="primary"
                            disabled={updateWriteWindow.isPending}
                            onClick={async () => {
                              setWindowError(null)
                              try {
                                await updateWriteWindow.mutateAsync({ environmentId: env.id, writeWindow: windowDraft })
                                setEditingWindowEnvId(null)
                                await refetchEnvs()
                              } catch (err) {
                                setWindowError(err instanceof Error ? err.message : 'Failed to update write window')
                              }
                            }}
                          >
                            {updateWriteWindow.isPending ? 'Saving…' : 'Save window'}
                          </Button>
                          {env.writeWindow && (
                            <Button
                              variant="ghost"
                              disabled={updateWriteWindow.isPending}
                              onClick={async () => {
                                setWindowError(null)
                                try {
                                  await updateWriteWindow.mutateAsync({ environmentId: env.id, writeWindow: null })
                                  setEditingWindowEnvId(null)
                                  await refetchEnvs()
                                } catch (err) {
                                  setWindowError(err instanceof Error ? err.message : 'Failed to clear write window')
                                }
                              }}
                            >
                              Clear (unrestricted)
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {envs.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-muted">
                    No environments yet — click <strong>New environment</strong> above to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Step 2: Database connections ─────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Database connections</h2>
            <p className="mt-0.5 text-xs text-muted">Add your own database. Credentials are encrypted at rest — only the executor ever sees the plaintext.</p>
          </div>
          {!showConnectionForm && (envs.data?.length ?? 0) > 0 && (
            <Button variant="secondary" onClick={() => setShowConnectionForm(true)}>
              New connection
            </Button>
          )}
        </div>

        {(envs.data?.length ?? 0) === 0 && !envs.isLoading && (
          <p className="mb-2 text-xs text-muted">Create an environment above first, then you can add a database connection.</p>
        )}

        {showConnectionForm && (
          <div className="mb-3">
            <ConnectionForm
              environments={envs.data ?? []}
              submitLabel="Test & save connection"
              pending={createConnection.isPending}
              onCancel={() => setShowConnectionForm(false)}
              onSubmit={async (values) => {
                setConnectionError(null)
                try {
                  await createConnection.mutateAsync(values)
                  setShowConnectionForm(false)
                  await refetchConnections()
                } catch (err) {
                  setConnectionError(err instanceof Error ? err.message : 'Failed to create connection')
                }
              }}
            />
          </div>
        )}

        {connectionError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{connectionError}</div>
        )}
        {connections.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{connections.error.message}</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Name</th>
                <th className="border-b border-border px-3 py-2">Environment</th>
                <th className="border-b border-border px-3 py-2">Database</th>
                <th className="border-b border-border px-3 py-2">SSL</th>
                <th className="border-b border-border px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {connections.data?.map((conn) => {
                const env = envs.data?.find((e) => e.id === conn.environmentId)
                return (
                  <tr key={conn.id}>
                    <td className="border-b border-border px-3 py-2 font-medium">{conn.name}</td>
                    <td className="border-b border-border px-3 py-2 text-xs text-muted">
                      {env ? <Badge tone={ENV_TONE[env.type] ?? 'neutral'}>{env.name}</Badge> : conn.environmentId}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-xs text-muted">
                      {conn.host}:{conn.port}/{conn.database}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      <Badge tone={conn.ssl ? 'safe' : 'neutral'}>{conn.ssl ? 'enabled' : 'disabled'}</Badge>
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs text-ink underline disabled:opacity-50"
                        disabled={capturingId === conn.id}
                        onClick={async () => {
                          setCapturingId(conn.id)
                          try {
                            const result = await captureSchema.mutateAsync({ connectionId: conn.id })
                            setCaptureResults((r) => ({ ...r, [conn.id]: `Captured ${result.tableCount} table(s)` }))
                          } catch (err) {
                            setCaptureResults((r) => ({ ...r, [conn.id]: err instanceof Error ? err.message : 'Schema discovery failed' }))
                          } finally {
                            setCapturingId(null)
                          }
                        }}
                      >
                        {capturingId === conn.id ? 'Capturing…' : 'Capture schema'}
                      </button>
                      {captureResults[conn.id] && <p className="mt-1 text-xs text-muted">{captureResults[conn.id]}</p>}
                    </td>
                  </tr>
                )
              })}
              {connections.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-muted">
                    No database connections yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Step 3: Custom roles ─────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Custom roles</h2>
            <p className="mt-0.5 text-xs text-muted">Define which tables, actions, and row caps each role can use — then assign to members below.</p>
          </div>
          {!showCreateForm && (
            <Button variant="secondary" onClick={() => setShowCreateForm(true)}>
              New role
            </Button>
          )}
        </div>

        {showCreateForm && (
          <div className="mb-3">
            <RoleForm
              submitLabel="Create role"
              pending={createRole.isPending}
              onCancel={() => setShowCreateForm(false)}
              onSubmit={async (values) => {
                await createRole.mutateAsync(values)
                setShowCreateForm(false)
                await refetchRoles()
              }}
            />
          </div>
        )}

        {roles.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{roles.error.message}</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Role</th>
                <th className="border-b border-border px-3 py-2">Capabilities</th>
                <th className="border-b border-border px-3 py-2">Tables</th>
                <th className="border-b border-border px-3 py-2">PII</th>
                <th className="border-b border-border px-3 py-2">Export</th>
                <th className="border-b border-border px-3 py-2">Members</th>
                <th className="border-b border-border px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {roles.data?.map((role) => (
                <Fragment key={role.id}>
                  <tr>
                    <td className="border-b border-border px-3 py-2 font-medium">{role.name}</td>
                    <td className="border-b border-border px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {role.config.allowedActions.map((a) => (
                          <span key={a} className="rounded border border-border px-1.5 py-0.5 text-xs">{a.toLowerCase()}</span>
                        ))}
                      </div>
                    </td>
                    <td className="border-b border-border px-3 py-2 text-xs text-muted">{role.config.allowedTables.join(', ')}</td>
                    <td className="border-b border-border px-3 py-2">
                      <Badge tone={role.config.maskPii !== false ? 'safe' : 'warning'}>{role.config.maskPii !== false ? 'Masked' : 'Unmasked'}</Badge>
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      <Badge tone={role.config.allowExport ? 'warning' : 'neutral'}>{role.config.allowExport ? 'Allowed' : 'Disabled'}</Badge>
                    </td>
                    <td className="border-b border-border px-3 py-2 text-xs text-muted">{role.memberCount} members</td>
                    <td className="border-b border-border px-3 py-2 text-right">
                      <button
                        type="button"
                        className="mr-3 text-xs text-ink underline"
                        onClick={() => setEditingRoleId(editingRoleId === role.id ? null : role.id)}
                      >
                        {editingRoleId === role.id ? 'Close' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-critical underline"
                        onClick={async () => {
                          if (!window.confirm(`Delete role "${role.name}"? Members assigned to it will lose query.submit capability.`)) return
                          await deleteRole.mutateAsync({ customRoleId: role.id })
                          await refetchRoles()
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  {editingRoleId === role.id && (
                    <tr>
                      <td colSpan={7} className="border-b border-border p-3">
                        <RoleForm
                          initial={roleToFormValues(role)}
                          submitLabel="Save changes"
                          pending={updateRole.isPending}
                          onCancel={() => setEditingRoleId(null)}
                          onSubmit={async (values) => {
                            await updateRole.mutateAsync({ customRoleId: role.id, ...values })
                            setEditingRoleId(null)
                            await refetchRoles()
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {roles.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-sm text-muted">
                    No custom roles yet — create one above, then assign it to members below so they can submit queries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Step 4: Members ──────────────────────────────────────────────── */}
      <div>
        <div className="mb-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Members</h2>
          <p className="mt-0.5 text-xs text-muted">Assign a custom role to give a member query access to the database.</p>
        </div>

        {members.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{members.error.message}</div>
        )}
        {memberError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{memberError}</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Email</th>
                <th className="border-b border-border px-3 py-2">Name</th>
                <th className="border-b border-border px-3 py-2">Platform role</th>
                <th className="border-b border-border px-3 py-2">Custom role</th>
                <th className="border-b border-border px-3 py-2">Joined</th>
                <th className="border-b border-border px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.data?.map((member) => (
                <tr key={member.userId}>
                  <td className="border-b border-border px-3 py-2 font-medium">{member.email}</td>
                  <td className="border-b border-border px-3 py-2 text-xs text-muted">{member.name ?? '—'}</td>
                  <td className="border-b border-border px-3 py-2">
                    <select
                      aria-label={`Change ${member.email}'s platform role`}
                      value={member.platformRole}
                      disabled={updateMemberRole.isPending}
                      onChange={async (e) => {
                        setMemberError(null)
                        try {
                          await updateMemberRole.mutateAsync({ userId: member.userId, platformRole: e.target.value as 'owner' | 'admin' | 'reviewer' | 'analyst' | 'viewer' })
                          await refetchMembers()
                        } catch (err) {
                          setMemberError(err instanceof Error ? err.message : 'Failed to update platform role')
                        }
                      }}
                      className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                    >
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="reviewer">reviewer</option>
                      <option value="analyst">analyst</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    <select
                      aria-label={`Change ${member.email}'s custom role`}
                      value={member.customRoleId ?? ''}
                      disabled={updateMemberRole.isPending}
                      onChange={async (e) => {
                        setMemberError(null)
                        try {
                          const value = e.target.value
                          await updateMemberRole.mutateAsync({ userId: member.userId, customRoleId: value === '' ? null : value })
                          await refetchMembers()
                        } catch (err) {
                          setMemberError(err instanceof Error ? err.message : 'Failed to update custom role')
                        }
                      }}
                      className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                    >
                      <option value="">— none —</option>
                      {roles.data?.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-border px-3 py-2 text-xs text-muted">{new Date(member.joinedAt).toLocaleDateString()}</td>
                  <td className="border-b border-border px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-critical underline"
                      onClick={async () => {
                        if (!window.confirm(`Remove ${member.email} from this organization?`)) return
                        setMemberError(null)
                        try {
                          await removeMember.mutateAsync({ userId: member.userId })
                          await refetchMembers()
                        } catch (err) {
                          setMemberError(err instanceof Error ? err.message : 'Failed to remove member')
                        }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {members.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-muted">No members yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Step 4b: Invite members ───────────────────────────────────────── */}
      <div>
        <div className="mb-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Invite members</h2>
          <p className="mt-0.5 mb-2 text-xs text-muted">
            No SMTP is configured — the invited email just needs to sign in (or self-register, since the Keycloak realm
            allows it) and they join this org automatically on first login.
          </p>
        </div>
        <form
          aria-label="Invite a member"
          className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setInviteError(null)
            try {
              await createInvitation.mutateAsync({ email: inviteEmail, platformRole: inviteRole, customRoleId: inviteCustomRoleId || null })
              setInviteEmail('')
              setInviteCustomRoleId('')
              await refetchInvitations()
            } catch (err) {
              setInviteError(err instanceof Error ? err.message : 'Failed to create invitation')
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-email" className="text-xs text-muted">Email</label>
            <input
              id="invite-email"
              type="email"
              required
              aria-required="true"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-56 rounded border border-border bg-transparent px-2 py-1 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-role" className="text-xs text-muted">Platform role</label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
              className="rounded border border-border bg-transparent px-2 py-1 text-xs"
            >
              <option value="admin">admin</option>
              <option value="reviewer">reviewer</option>
              <option value="analyst">analyst</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-custom-role" className="text-xs text-muted">Custom role</label>
            <select
              id="invite-custom-role"
              value={inviteCustomRoleId}
              onChange={(e) => setInviteCustomRoleId(e.target.value)}
              className="rounded border border-border bg-transparent px-2 py-1 text-xs"
            >
              <option value="">— none —</option>
              {roles.data?.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="primary" disabled={createInvitation.isPending}>
            {createInvitation.isPending ? 'Inviting…' : 'Send invite'}
          </Button>
        </form>

        {inviteError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{inviteError}</div>
        )}
        {invitations.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{invitations.error.message}</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Email</th>
                <th className="border-b border-border px-3 py-2">Role</th>
                <th className="border-b border-border px-3 py-2">Status</th>
                <th className="border-b border-border px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invitations.data?.map((invite) => (
                <tr key={invite.id}>
                  <td className="border-b border-border px-3 py-2 font-medium">{invite.email}</td>
                  <td className="border-b border-border px-3 py-2 text-xs text-muted">{invite.platformRole}</td>
                  <td className="border-b border-border px-3 py-2">
                    <Badge tone={invite.expired ? 'critical' : 'safe'}>{invite.expired ? 'Expired' : 'Pending'}</Badge>
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-critical underline"
                      onClick={async () => {
                        await revokeInvitation.mutateAsync({ invitationId: invite.id })
                        await refetchInvitations()
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {invitations.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted">No pending invitations.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Rate limits ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Rate limits</h2>
        <p className="mb-2 text-xs text-muted">
          Per-user query rate and per-org daily AI-call cap — protects both LLM cost and the customer database from
          runaway or abusive usage.
        </p>
        {rateLimits.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{rateLimits.error.message}</div>
        )}
        {rateLimitError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">{rateLimitError}</div>
        )}
        {rateLimitDraft && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={rateLimitDraft.enabled}
                onChange={(e) => setRateLimitDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))}
              />
              Enabled
            </label>
            <div className="flex flex-col gap-1">
              <label htmlFor="rl-per-user" className="text-xs text-muted">Queries / min / user</label>
              <input
                id="rl-per-user"
                type="number"
                min={1}
                value={rateLimitDraft.queriesPerMinutePerUser}
                onChange={(e) => setRateLimitDraft((d) => (d ? { ...d, queriesPerMinutePerUser: e.target.value } : d))}
                className="w-32 rounded border border-border bg-transparent px-2 py-1 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="rl-per-org" className="text-xs text-muted">AI calls / day / org</label>
              <input
                id="rl-per-org"
                type="number"
                min={1}
                value={rateLimitDraft.aiCallsPerDayPerOrg}
                onChange={(e) => setRateLimitDraft((d) => (d ? { ...d, aiCallsPerDayPerOrg: e.target.value } : d))}
                className="w-32 rounded border border-border bg-transparent px-2 py-1 text-xs"
              />
            </div>
            <Button
              variant="primary"
              disabled={updateRateLimits.isPending}
              onClick={async () => {
                setRateLimitError(null)
                try {
                  await updateRateLimits.mutateAsync({
                    enabled: rateLimitDraft.enabled,
                    queriesPerMinutePerUser: Number(rateLimitDraft.queriesPerMinutePerUser),
                    aiCallsPerDayPerOrg: Number(rateLimitDraft.aiCallsPerDayPerOrg),
                  })
                  await queryClient.invalidateQueries({ queryKey: trpc.policy.getRateLimits.queryKey() })
                } catch (err) {
                  setRateLimitError(err instanceof Error ? err.message : 'Failed to update rate limits')
                }
              }}
            >
              {updateRateLimits.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
