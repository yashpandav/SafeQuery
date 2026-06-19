'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'
import { Badge, type RiskTone } from '../components/badge'
import { Button } from '../components/button'
import { Card } from '../components/card'

function humanizeAction(action: string): string {
  const lower = action.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function shortHash(hash: string | null): string {
  if (!hash) return '—'
  return hash.length <= 12 ? hash : `${hash.slice(0, 4)}...${hash.slice(-4)}`
}

function riskTone(action: string, metadata: Record<string, unknown>): RiskTone | null {
  if (action === 'SECURITY_INCIDENT_DETECTED') return 'incident'
  const riskLevel = metadata['riskLevel']
  if (riskLevel === 'SAFE') return 'safe'
  if (riskLevel === 'WARNING') return 'warning'
  if (riskLevel === 'CRITICAL') return 'critical'
  return null
}

function metadataSummary(metadata: Record<string, unknown>): string | null {
  const entries = Object.entries(metadata).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) return null
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted">Every action, hash-chained and append-only.</p>
      </div>

      <Card className="flex items-center justify-between">
        <div>
          {verify.data ? (
            verify.data.valid ? (
              <p className="flex items-center gap-2 text-sm">
                <Badge tone="safe">Chain integrity verified</Badge>
                <span className="text-muted">checked {verify.data.checkedCount} entries</span>
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <Badge tone="critical">Tampering detected</Badge>
                <span className="text-muted">
                  first mismatch at entry {(verify.data.firstMismatchIndex ?? 0) + 1} (id {verify.data.firstMismatchId})
                </span>
              </p>
            )
          ) : (
            <p className="text-sm text-muted">Chain integrity not checked yet this session.</p>
          )}
          {verify.isError && <p className="mt-1 text-sm text-critical">{verify.error.message}</p>}
        </div>
        <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? 'Verifying…' : 'Re-verify chain'}
        </Button>
      </Card>

      {auditLog.isPending && <p className="text-sm text-muted">Loading…</p>}
      {auditLog.isError && (
        <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
          {auditLog.error.message}
        </div>
      )}
      {auditLog.data?.length === 0 && <p className="text-sm text-muted">No audit entries visible to you yet.</p>}

      {auditLog.data && auditLog.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border px-3 py-2">Time</th>
                <th className="border-b border-border px-3 py-2">Event</th>
                <th className="border-b border-border px-3 py-2">Risk</th>
                <th className="border-b border-border px-3 py-2">Hash</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.data.map((row) => {
                const tampered = verify.data && !verify.data.valid && verify.data.firstMismatchId === row.id
                const tone = riskTone(row.action, row.metadata)
                const summary = metadataSummary(row.metadata)
                return (
                  <tr key={row.id} className={tampered ? 'bg-critical-bg' : 'hover:bg-black/[0.02]'}>
                    <td className="border-b border-border px-3 py-2 align-top whitespace-nowrap text-xs text-muted">
                      {new Date(row.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="border-b border-border px-3 py-2 align-top">
                      <div className="font-medium">{humanizeAction(row.action)}</div>
                      <div className="text-xs text-muted">
                        {row.actorName ?? row.actorEmail ?? row.actorId} · {row.resourceType}
                        {summary ? ` · ${summary}` : ''}
                      </div>
                      {tampered && <div className="mt-1 text-xs font-medium text-critical">Hash mismatch — record modified after the fact</div>}
                    </td>
                    <td className="border-b border-border px-3 py-2 align-top">
                      {tampered ? (
                        <Badge tone="critical">Tampered</Badge>
                      ) : tone ? (
                        <Badge tone={tone}>{tone.charAt(0).toUpperCase() + tone.slice(1)}</Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2 align-top font-mono text-xs text-muted">{shortHash(row.hash)}</td>
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
