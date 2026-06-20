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

  const createRole = useMutation(trpc.customRole.create.mutationOptions())
  const updateRole = useMutation(trpc.customRole.update.mutationOptions())
  const deleteRole = useMutation(trpc.customRole.delete.mutationOptions())
  const updateEnvType = useMutation(trpc.environment.updateType.mutationOptions())

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)

  async function refetchRoles() {
    await queryClient.invalidateQueries({ queryKey: trpc.customRole.list.queryKey() })
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
                      <td colSpan={6} className="border-b border-border p-3">
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
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-muted">
                    No custom roles yet.
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
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Environment</th>
                <th className="border-b border-border px-3 py-2">Type</th>
                <th className="border-b border-border px-3 py-2">Posture</th>
                <th className="border-b border-border px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {envs.data?.map((env) => (
                <tr key={env.id}>
                  <td className="border-b border-border px-3 py-2 font-medium">{env.name}</td>
                  <td className="border-b border-border px-3 py-2">
                    <Badge tone={ENV_TONE[env.type] ?? 'neutral'}>{env.type}</Badge>
                  </td>
                  <td className="border-b border-border px-3 py-2 text-xs text-muted">{env.posture}</td>
                  <td className="border-b border-border px-3 py-2 text-right">
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
                  </td>
                </tr>
              ))}
              {envs.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted">
                    No environments configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
