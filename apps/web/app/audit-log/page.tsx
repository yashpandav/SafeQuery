'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'
import { Badge, type RiskTone } from '../components/badge'
import { Button } from '../components/button'

function humanizeAction(action: string): string {
  const lower = action.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function shortHash(hash: string | null): string {
  if (!hash) return '—'
  return hash.length <= 12 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function riskTone(action: string, metadata: Record<string, unknown>): RiskTone | null {
  if (action === 'SECURITY_INCIDENT_DETECTED') return 'incident'
  const riskLevel = metadata['riskLevel']
  if (riskLevel === 'SAFE') return 'safe'
  if (riskLevel === 'WARNING') return 'warning'
  if (riskLevel === 'CRITICAL') return 'critical'
  return null
}

export default function AuditLogPage() {
  const { session } = useSession()
  const router = useRouter()
  const trpc = useTRPC()

  useEffect(() => {
    if (!session) router.replace('/login')
  }, [session, router])

  const auditLog = useQuery({ ...trpc.audit.list.queryOptions(), enabled: Boolean(session) })
  const verify = useMutation(trpc.audit.verifyIntegrity.mutationOptions())

  if (!session) return null

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Audit log</h1>
          <p className="mt-1 text-sm text-muted">Every action, hash-chained and append-only.</p>
        </div>
        <div className="flex items-center gap-3">
          {verify.data && (
            verify.data.valid ? (
              <span className="text-xs text-safe font-medium">Chain verified · {verify.data.checkedCount} entries</span>
            ) : (
              <span className="text-xs text-critical font-medium">
                Tampered · mismatch at entry {(verify.data.firstMismatchIndex ?? 0) + 1}
              </span>
            )
          )}
          {verify.isError && (
            <span className="text-xs text-critical">{verify.error.message}</span>
          )}
          <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? 'Verifying…' : 'Verify chain'}
          </Button>
        </div>
      </div>

      {auditLog.isPending && <p className="text-sm text-muted">Loading…</p>}
      {auditLog.isError && (
        <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
          {auditLog.error.message}
        </div>
      )}
      {auditLog.data?.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">No audit entries visible to you yet.</p>
      )}

      {auditLog.data && auditLog.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Time</th>
                <th className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Event</th>
                <th className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Actor</th>
                <th className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Risk</th>
                <th className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Hash</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.data.map((row) => {
                const tampered = verify.data && !verify.data.valid && verify.data.firstMismatchId === row.id
                const tone = riskTone(row.action, row.metadata)
                return (
                  <tr
                    key={row.id}
                    className={tampered ? 'bg-critical-bg' : 'hover:bg-black/[0.02]'}
                  >
                    <td className={`border-b px-3 py-2.5 align-top whitespace-nowrap text-xs text-muted ${tampered ? 'border-critical/30 border-l-2 border-l-critical' : 'border-border'}`}>
                      <span className="block">{new Date(row.createdAt).toLocaleDateString()}</span>
                      <span className="block">{new Date(row.createdAt).toLocaleTimeString()}</span>
                    </td>
                    <td className={`border-b border-border px-3 py-2.5 align-top ${tampered ? 'border-critical/30' : ''}`}>
                      <div className="font-medium text-ink">{humanizeAction(row.action)}</div>
                      <div className="text-xs text-muted">{row.resourceType}</div>
                      {tampered && (
                        <div className="mt-1 text-xs font-medium text-critical">Hash mismatch — record modified after the fact</div>
                      )}
                    </td>
                    <td className={`border-b border-border px-3 py-2.5 align-top text-xs text-muted ${tampered ? 'border-critical/30' : ''}`}>
                      {row.actorName ?? row.actorEmail ?? row.actorId}
                    </td>
                    <td className={`border-b border-border px-3 py-2.5 align-top ${tampered ? 'border-critical/30' : ''}`}>
                      {tampered ? (
                        <Badge tone="critical" dot={false}>Tampered</Badge>
                      ) : tone ? (
                        <Badge tone={tone} dot={false}>{tone.charAt(0).toUpperCase() + tone.slice(1)}</Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className={`border-b border-border px-3 py-2.5 align-top font-mono text-xs text-muted ${tampered ? 'border-critical/30' : ''}`}>
                      {shortHash(row.hash)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
