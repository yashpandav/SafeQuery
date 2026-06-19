'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../trpc/client'
import { useSession } from '../../lib/session'

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'border-warning/40 bg-warning-bg text-warning',
  APPROVED: 'border-safe/40 bg-safe-bg text-safe',
  REJECTED: 'border-danger/40 bg-danger-bg text-danger',
  EXPIRED: 'border-border text-muted',
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
  const decide = useMutation(trpc.approval.decide.mutationOptions())

  async function handleDecide(decision: 'APPROVED' | 'REJECTED', e: FormEvent) {
    e.preventDefault()
    await decide.mutateAsync({ approvalRequestId, decision, note: note || undefined })
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
        they try to decide their own request.
      </p>

      <div className="flex flex-col gap-2">
        {approvals.isPending && <p className="text-sm text-muted">Loading…</p>}
        {approvals.isError && (
          <div role="alert" className="rounded border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger">
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
            className={`rounded border p-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 ${
              approvalRequestId === a.id ? 'border-primary' : 'border-border'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.naturalLanguage}</span>
              <span className={`rounded border px-2 py-0.5 text-xs ${STATUS_CLASS[a.status] ?? 'border-border'}`}>{a.status}</span>
            </div>
            <code className="mt-1 block text-xs text-muted">{a.generatedSql}</code>
          </button>
        ))}
      </div>

      <form aria-label="Decide approval request" className="flex flex-col gap-3 rounded-lg border border-border p-4">
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
            className="rounded border border-border bg-transparent px-3 py-2"
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
            className="rounded border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={decide.isPending || !approvalRequestId}
            onClick={(e) => handleDecide('APPROVED', e)}
            className="rounded bg-safe px-4 py-2 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="submit"
            disabled={decide.isPending || !approvalRequestId}
            onClick={(e) => handleDecide('REJECTED', e)}
            className="rounded bg-danger px-4 py-2 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </form>

      {decide.isError && (
        <div role="alert" className="rounded border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger">
          {decide.error.message}
        </div>
      )}

      {decide.data && (
        <div role="status" className="rounded border border-border p-4 text-sm">
          <p>
            Status: <strong>{decide.data.status}</strong>
          </p>
          <p>Executed: {decide.data.executed ? 'yes' : 'no'}</p>
          {decide.data.rowCount !== null && <p>Rows affected: {decide.data.rowCount}</p>}
          {decide.data.error && <p className="text-danger">Error: {decide.data.error}</p>}
        </div>
      )}
    </div>
  )
}
