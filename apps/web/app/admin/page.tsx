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

  const createRole = useMutation(trpc.customRole.create.mutationOptions())
  const updateRole = useMutation(trpc.customRole.update.mutationOptions())
  const deleteRole = useMutation(trpc.customRole.delete.mutationOptions())
  const updateEnvType = useMutation(trpc.environment.updateType.mutationOptions())
  const createConnection = useMutation(trpc.databaseConnection.create.mutationOptions())
  const captureSchema = useMutation(trpc.databaseConnection.captureSchema.mutationOptions())
  const updateWriteWindow = useMutation(trpc.environment.updateWriteWindow.mutationOptions())
  const updateRateLimits = useMutation(trpc.policy.updateRateLimits.mutationOptions())

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

  useEffect(() => {
    if (rateLimits.data && !rateLimitDraft) {
      setRateLimitDraft({
        enabled: rateLimits.data.enabled,
        queriesPerMinutePerUser: String(rateLimits.data.queriesPerMinutePerUser),
        aiCallsPerDayPerOrg: String(rateLimits.data.aiCallsPerDayPerOrg),
      })
    }
  }, [rateLimits.data, rateLimitDraft])

  async function refetchRoles() {
    await queryClient.invalidateQueries({ queryKey: trpc.customRole.list.queryKey() })
  }

  async function refetchConnections() {
    await queryClient.invalidateQueries({ queryKey: trpc.databaseConnection.list.queryKey() })
  }

  if (!session || !isAdmin) return null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Workspace settings</h1>
        <p className="text-sm text-muted">Custom roles, database connections, and policy posture.</p>
      </div>

      {summary.data && (
        <div className="grid grid-cols-4 gap-4">
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

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">Custom roles — defined as data, no deploy required</h2>
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
                await createRole.mutateAsync({ ...values, allowedColumns: {}, rowFilters: {} })
                setShowCreateForm(false)
                await refetchRoles()
              }}
            />
          </div>
        )}

        {roles.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {roles.error.message}
          </div>
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
                          <span key={a} className="rounded border border-border px-1.5 py-0.5 text-xs">
                            {a.toLowerCase()}
                          </span>
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
                            await updateRole.mutateAsync({ customRoleId: role.id, ...values, allowedColumns: {}, rowFilters: {} })
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
                    No custom roles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">Database connections</h2>
          {!showConnectionForm && (envs.data?.length ?? 0) > 0 && (
            <Button variant="secondary" onClick={() => setShowConnectionForm(true)}>
              New connection
            </Button>
          )}
        </div>

        {envs.data?.length === 0 && !envs.isLoading && (
          <p className="mb-2 text-xs text-muted">Configure an environment below before adding a database connection.</p>
        )}

        {showConnectionForm && (
          <div className="mb-3">
            <ConnectionForm
              environments={envs.data ?? []}
              submitLabel="Test & create connection"
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
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {connectionError}
          </div>
        )}
        {connections.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {connections.error.message}
          </div>
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

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted">Environment policy posture</h2>
        {envs.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {envs.error.message}
          </div>
        )}
        {windowError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {windowError}
          </div>
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
                          <span>
                            {env.writeWindow.start}–{env.writeWindow.end} ({env.writeWindow.timezone})
                          </span>
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
                            await queryClient.invalidateQueries({ queryKey: trpc.environment.list.queryKey() })
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
                            <label htmlFor={`window-start-${env.id}`} className="text-xs text-muted">
                              Start
                            </label>
                            <input
                              id={`window-start-${env.id}`}
                              type="time"
                              value={windowDraft.start}
                              onChange={(e) => setWindowDraft((d) => ({ ...d, start: e.target.value }))}
                              className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`window-end-${env.id}`} className="text-xs text-muted">
                              End
                            </label>
                            <input
                              id={`window-end-${env.id}`}
                              type="time"
                              value={windowDraft.end}
                              onChange={(e) => setWindowDraft((d) => ({ ...d, end: e.target.value }))}
                              className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`window-tz-${env.id}`} className="text-xs text-muted">
                              Timezone (IANA)
                            </label>
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
                                await queryClient.invalidateQueries({ queryKey: trpc.environment.list.queryKey() })
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
                                  await queryClient.invalidateQueries({ queryKey: trpc.environment.list.queryKey() })
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
                    No environments configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted">Rate limits</h2>
        <p className="mb-2 text-xs text-muted">
          Per-user query rate and per-org daily AI-call cap — protects both LLM cost and the customer database from
          runaway or abusive usage.
        </p>
        {rateLimits.isError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {rateLimits.error.message}
          </div>
        )}
        {rateLimitError && (
          <div role="alert" className="mb-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {rateLimitError}
          </div>
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
              <label htmlFor="rl-per-user" className="text-xs text-muted">
                Queries / min / user
              </label>
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
              <label htmlFor="rl-per-org" className="text-xs text-muted">
                AI calls / day / org
              </label>
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
