'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'
import { getKeycloakToken } from '../../lib/keycloak'
import { Badge, type RiskTone } from '../components/badge'
import { Button } from '../components/button'
import { CodeBlock } from '../components/code-block'

type TabFilter = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED'

const STATUS_TONE: Record<string, RiskTone> = {
  PENDING: 'warning',
  APPROVED: 'safe',
  REJECTED: 'critical',
  EXPIRED: 'neutral',
}

const TABS: { value: TabFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
]

export default function ApprovalsPage() {
  const { session } = useSession()
  const router = useRouter()
  const trpc = useTRPC()

  useEffect(() => {
    if (!session) router.replace('/login')
  }, [session, router])

  const approvals = useQuery({ ...trpc.approval.list.queryOptions(), enabled: Boolean(session) })
  const [tab, setTab] = useState<TabFilter>('PENDING')
  const [selectedId, setSelectedId] = useState('')
  const [note, setNote] = useState('')
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthError, setReauthError] = useState<string | null>(null)
  const decide = useMutation(trpc.approval.decide.mutationOptions())

  async function handleDecide(decision: 'APPROVED' | 'REJECTED', e: FormEvent) {
    e.preventDefault()
    if (!session) return
    setReauthError(null)
    let reauthToken: string
    try {
      reauthToken = await getKeycloakToken(session.email, reauthPassword)
    } catch (err) {
      setReauthError(err instanceof Error ? err.message : 'Re-authentication failed')
      return
    }
    setReauthPassword('')
    await decide.mutateAsync({ approvalRequestId: selectedId, decision, note: note || undefined, reauthToken })
    setSelectedId('')
    setNote('')
    await approvals.refetch()
  }

  if (!session) return null

  const filtered = approvals.data?.filter((a) => tab === 'all' || a.status === tab) ?? []
  const selected = approvals.data?.find((a) => a.id === selectedId)
  const canDecide = selected?.status === 'PENDING'

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Approvals</h1>
        <p className="mt-1 text-sm text-muted">
          CRITICAL writes require reviewer sign-off. Select a request to approve or reject.
        </p>
      </div>

      {/* Tab filter */}
      <div className="flex gap-0.5 border-b border-border">
        {TABS.map(({ value, label }) => {
          const count = value === 'all'
            ? (approvals.data?.length ?? 0)
            : (approvals.data?.filter((a) => a.status === value).length ?? 0)
          return (
            <button
              key={value}
              type="button"
              onClick={() => { setTab(value); setSelectedId('') }}
              className={`px-3 pb-2 text-sm transition-colors ${
                tab === value
                  ? 'border-b-2 border-ink font-medium text-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  tab === value ? 'bg-ink text-white' : 'bg-neutral-bg text-neutral'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex gap-6">
        {/* Request list */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {approvals.isPending && (
            <p className="text-sm text-muted py-4">Loading…</p>
          )}
          {approvals.isError && (
            <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
              {approvals.error.message}
            </div>
          )}
          {!approvals.isPending && filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted">
                {tab === 'PENDING' ? 'No pending approval requests.' : `No ${tab.toLowerCase()} requests.`}
              </p>
            </div>
          )}
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(selectedId === a.id ? '' : a.id)}
              aria-pressed={selectedId === a.id}
              className={`rounded-lg border bg-surface p-3 text-left transition hover:bg-black/[0.015] ${
                selectedId === a.id ? 'border-ink shadow-sm' : 'border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-ink leading-snug">{a.naturalLanguage}</p>
                <Badge tone={STATUS_TONE[a.status] ?? 'neutral'} dot={false}>{a.status}</Badge>
              </div>
              <CodeBlock className="mt-2 text-[11px]">{a.generatedSql}</CodeBlock>
            </button>
          ))}
        </div>

        {/* Decision panel */}
        {selected && (
          <div className="w-[300px] flex-shrink-0">
            <form
              aria-label="Decide approval request"
              className="sticky top-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-1">Selected request</p>
                <p className="text-sm font-medium text-ink leading-snug">{selected.naturalLanguage}</p>
                <p className="mt-1 text-xs text-muted">Status: <span className="font-medium">{selected.status}</span></p>
              </div>

              {canDecide && (
                <>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="note" className="text-xs text-muted">Note (optional)</label>
                    <input
                      id="note"
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Reason for decision…"
                      className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="reauth-password" className="text-xs text-muted">
                      Password — required for every decision
                    </label>
                    <input
                      id="reauth-password"
                      type="password"
                      required
                      aria-required="true"
                      value={reauthPassword}
                      onChange={(e) => setReauthPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                  {reauthError && (
                    <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
                      {reauthError}
                    </div>
                  )}
                  {decide.isError && (
                    <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
                      {decide.error.message}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="primary"
                      className="flex-1"
                      disabled={decide.isPending || !reauthPassword}
                      onClick={(e) => void handleDecide('APPROVED', e)}
                    >
                      {decide.isPending ? '…' : 'Approve'}
                    </Button>
                    <Button
                      type="submit"
                      variant="danger"
                      className="flex-1"
                      disabled={decide.isPending || !reauthPassword}
                      onClick={(e) => void handleDecide('REJECTED', e)}
                    >
                      {decide.isPending ? '…' : 'Reject'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted text-center">
                    Four-eyes applies — you cannot decide your own request.
                  </p>
                </>
              )}

              {!canDecide && (
                <p className="text-sm text-muted">
                  This request is already <strong>{selected.status.toLowerCase()}</strong> and cannot be re-decided.
                </p>
              )}

              {decide.data && (
                <div className="rounded-lg bg-safe-bg px-3 py-2 text-sm text-safe">
                  Decision recorded · {decide.data.status}
                  {decide.data.rowCount !== null && ` · ${decide.data.rowCount} rows affected`}
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
