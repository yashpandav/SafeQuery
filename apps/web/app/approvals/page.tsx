'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'
import { getKeycloakToken } from '../../lib/keycloak'
import { Badge, type RiskTone } from '../components/badge'
import { Button } from '../components/button'
import { Card } from '../components/card'
import { CodeBlock } from '../components/code-block'

const STATUS_TONE: Record<string, RiskTone> = {
  PENDING: 'warning',
  APPROVED: 'safe',
  REJECTED: 'critical',
  EXPIRED: 'neutral',
}

export default function ApprovalsPage() {
  const { session } = useSession()
  const router = useRouter()
  const trpc = useTRPC()

  useEffect(() => {
    if (!session) router.replace('/login')
  }, [session, router])

  const approvals = useQuery({ ...trpc.approval.list.queryOptions(), enabled: Boolean(session) })
  const [approvalRequestId, setApprovalRequestId] = useState('')
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
    await decide.mutateAsync({ approvalRequestId, decision, note: note || undefined, reauthToken })
    await approvals.refetch()
  }

  if (!session) return null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Approval decisions</h1>
      <p className="text-sm text-muted">
        Reviewers see every request in the org; analysts only see the ones they submitted — Cerbos&apos;s
        `request_submitter`/`same_org_approver` rules decide that, not this page. Select a pending request
        below, then approve or reject. Four-eyes still applies — the original submitter gets FORBIDDEN if
        they try to decide their own request. Every decision requires re-entering your password — a stolen
        session alone is never enough to approve or reject a CRITICAL write.
      </p>

      <div className="flex flex-col gap-2">
        {approvals.isPending && <p className="text-sm text-muted">Loading…</p>}
        {approvals.isError && (
          <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {approvals.error.message}
          </div>
        )}
        {approvals.data?.length === 0 && <p className="text-sm text-muted">No approval requests visible to you yet.</p>}
        {approvals.data?.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setApprovalRequestId(a.id)}
            aria-pressed={approvalRequestId === a.id}
            className={`rounded-lg border bg-surface p-3 text-left text-sm transition hover:bg-black/[0.02] ${
              approvalRequestId === a.id ? 'border-ink' : 'border-border'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.naturalLanguage}</span>
              <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
            </div>
            <CodeBlock className="mt-2">{a.generatedSql}</CodeBlock>
          </button>
        ))}
      </div>

      <form aria-label="Decide approval request" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="approvalRequestId" className="text-sm text-muted">
            Approval request ID
          </label>
          <input
            id="approvalRequestId"
            type="text"
            required
            aria-required="true"
            value={approvalRequestId}
            onChange={(e) => setApprovalRequestId(e.target.value)}
            placeholder="Select a request above, or paste an ID"
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="note" className="text-sm text-muted">
            Note (optional)
          </label>
          <input
            id="note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reauth-password" className="text-sm text-muted">
            Confirm your password to decide
          </label>
          <input
            id="reauth-password"
            type="password"
            required
            aria-required="true"
            value={reauthPassword}
            onChange={(e) => setReauthPassword(e.target.value)}
            placeholder="Re-authentication required for every decision"
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        {reauthError && (
          <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
            {reauthError}
          </div>
        )}
        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={decide.isPending || !approvalRequestId || !reauthPassword}
            onClick={(e) => handleDecide('APPROVED', e)}
          >
            Approve
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={decide.isPending || !approvalRequestId || !reauthPassword}
            onClick={(e) => handleDecide('REJECTED', e)}
          >
            Reject
          </Button>
        </div>
      </form>

      {decide.isError && (
        <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
          {decide.error.message}
        </div>
      )}

      {decide.data && (
        <Card role="status" className="text-sm">
          <p>
            Status: <strong>{decide.data.status}</strong>
          </p>
          <p>Executed: {decide.data.executed ? 'yes' : 'no'}</p>
          {decide.data.rowCount !== null && <p>Rows affected: {decide.data.rowCount}</p>}
          {decide.data.error && <p className="text-critical">Error: {decide.data.error}</p>}
        </Card>
      )}
    </div>
  )
}
