'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../trpc/client'
import { useSession } from '../lib/session'
import { QueryResult, type SubmitResult } from './query-result'
import { Button } from './components/button'

export default function ChatPage() {
  const { session } = useSession()
  const router = useRouter()
  const trpc = useTRPC()

  useEffect(() => {
    if (!session) router.replace('/login')
  }, [session, router])

  const connections = useQuery({ ...trpc.databaseConnection.list.queryOptions(), enabled: Boolean(session) })
  const [connectionId, setConnectionId] = useState('')
  const [naturalLanguage, setNaturalLanguage] = useState('')
  const [result, setResult] = useState<SubmitResult | null>(null)

  const submitQuery = useMutation(trpc.query.submit.mutationOptions())
  const acknowledgeQuery = useMutation(trpc.query.acknowledge.mutationOptions())

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!connectionId) return
    const data = await submitQuery.mutateAsync({ connectionId, naturalLanguage })
    setResult(data)
  }

  async function handleAcknowledge() {
    if (!result) return
    const data = await acknowledgeQuery.mutateAsync({ queryLogId: result.queryLogId })
    setResult(data)
  }

  if (!session) return null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Ask a question</h1>
      <form
        onSubmit={handleSubmit}
        aria-label="Submit a query"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="connection" className="text-sm text-muted">
            Database connection
          </label>
          <select
            id="connection"
            required
            aria-required="true"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          >
            <option value="">Select a connection…</option>
            {connections.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nl" className="text-sm text-muted">
            Question
          </label>
          <textarea
            id="nl"
            required
            aria-required="true"
            rows={3}
            value={naturalLanguage}
            onChange={(e) => setNaturalLanguage(e.target.value)}
            placeholder="e.g. Show me all active customers"
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        <Button type="submit" variant="primary" disabled={submitQuery.isPending} className="self-start">
          {submitQuery.isPending ? 'Submitting…' : 'Submit'}
        </Button>
      </form>

      {submitQuery.isError && (
        <div role="alert" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
          {submitQuery.error.message}
        </div>
      )}

      {result && <QueryResult result={result} onAcknowledge={handleAcknowledge} acknowledging={acknowledgeQuery.isPending} />}
    </div>
  )
}
