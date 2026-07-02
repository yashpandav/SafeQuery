'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../trpc/client'
import { useSession } from '../lib/session'
import { QueryResult, type SubmitResult } from './query-result'

function IconSend() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path d="M2.278 1.285a.5.5 0 00-.704.637l1.994 5.578H11.5a.5.5 0 010 1H3.568l-1.994 5.578a.5.5 0 00.704.637l13-7a.5.5 0 000-.892l-13-7z" />
    </svg>
  )
}

export default function ChatPage() {
  const { session } = useSession()
  const router = useRouter()
  const trpc = useTRPC()
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!session) router.replace('/login')
  }, [session, router])

  const connections = useQuery({ ...trpc.databaseConnection.list.queryOptions(), enabled: Boolean(session) })
  const environments = useQuery({ ...trpc.environment.list.queryOptions(), enabled: Boolean(session) })
  const myMembership = useQuery({ ...trpc.member.me.queryOptions(), enabled: Boolean(session) })

  const [connectionId, setConnectionId] = useState('')
  const [naturalLanguage, setNaturalLanguage] = useState('')
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const submitQuery = useMutation(trpc.query.submit.mutationOptions())
  const acknowledgeQuery = useMutation(trpc.query.acknowledge.mutationOptions())

  useEffect(() => {
    if (!connectionId && connections.data && connections.data.length > 0) {
      setConnectionId(connections.data[0]!.id)
    }
  }, [connections.data, connectionId])

  useEffect(() => {
    if (result && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [result])

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    if (!connectionId || !naturalLanguage.trim()) return
    setLastQuestion(naturalLanguage.trim())
    setNaturalLanguage('')
    const data = await submitQuery.mutateAsync({ connectionId, naturalLanguage: naturalLanguage.trim() })
    setResult(data)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  async function handleAcknowledge() {
    if (!result) return
    const data = await acknowledgeQuery.mutateAsync({ queryLogId: result.queryLogId })
    setResult(data)
  }

  if (!session) return null

  const selectedConn = connections.data?.find((c) => c.id === connectionId)
  const selectedEnv = environments.data?.find((e) => e.id === selectedConn?.environmentId)
  const isProduction = selectedEnv?.type === 'production'
  const hasNoRole = myMembership.data?.customRoleId === null
  const isAdmin = session.platformRole === 'admin' || session.platformRole === 'owner'
  const canSubmit = !submitQuery.isPending && !hasNoRole && Boolean(connectionId) && Boolean(naturalLanguage.trim())

  return (
    <div className="flex h-full min-h-screen flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-5">
        <div className="flex items-center gap-3">
          {connections.data && connections.data.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-safe" />
              <select
                value={connectionId}
                onChange={(e) => { setConnectionId(e.target.value); setResult(null); setLastQuestion(null) }}
                className="appearance-none border-none bg-transparent text-sm font-medium text-ink focus:outline-none"
                aria-label="Select database connection"
              >
                {connections.data.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {selectedConn && (
                <span className="text-xs text-muted">· {selectedConn.host}/{selectedConn.database}</span>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted">
              {connections.isLoading ? 'Loading connections…' : 'No connections yet'}
            </span>
          )}
        </div>
        {isProduction && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-3 py-1 text-xs font-medium text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            Production environment
          </span>
        )}
      </div>

      {/* Content area */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-6">
        {!lastQuestion && !result && (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5 text-muted">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5.5A2.5 2.5 0 015.5 3h9A2.5 2.5 0 0117 5.5v7a2.5 2.5 0 01-2.5 2.5H10l-4 4v-4H5.5A2.5 2.5 0 013 12.5v-7z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-ink">Ask a question about your data</p>
            <p className="mt-1 text-xs text-muted">Type below — SafeQuery validates, routes, and audits every query.</p>
          </div>
        )}

        {hasNoRole && (
          <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-sm font-medium text-ink">No query role assigned</p>
            <p className="mt-0.5 text-xs text-muted">
              {isAdmin
                ? 'Go to Workspace settings to create a role and assign it to yourself.'
                : 'Ask your workspace admin to assign you a custom role before you can submit queries.'}
            </p>
          </div>
        )}

        {lastQuestion && (
          <div className="mb-4 flex justify-end">
            <div className="max-w-[72%] rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-sm leading-relaxed text-white">
              {lastQuestion}
            </div>
          </div>
        )}

        {submitQuery.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:0.2s]" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:0.4s]" />
          </div>
        )}

        {submitQuery.isError && (
          <div role="alert" className="rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical">
            {submitQuery.error.message}
          </div>
        )}

        {result && (
          <QueryResult result={result} onAcknowledge={handleAcknowledge} acknowledging={acknowledgeQuery.isPending} />
        )}
      </div>

      {/* Bottom input */}
      <div className="sticky bottom-0 flex-shrink-0 border-t border-border bg-background px-5 py-4">
        {connections.data?.length === 0 && !connections.isLoading && (
          <p className="mb-2 text-center text-xs text-muted">
            No database connections yet.{' '}
            {isAdmin ? (
              <a href="/admin" className="underline underline-offset-2 hover:text-ink">Add one in Workspace settings.</a>
            ) : (
              'Ask your admin to add a connection.'
            )}
          </p>
        )}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          aria-label="Ask a question"
          className="relative flex items-end gap-2 rounded-xl bg-ink px-4 py-3"
        >
          <textarea
            value={naturalLanguage}
            onChange={(e) => setNaturalLanguage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your data…"
            rows={1}
            disabled={submitQuery.isPending || hasNoRole || !connectionId}
            className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-white/40 focus:outline-none disabled:opacity-50"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80 transition-colors hover:bg-white/20 disabled:opacity-30"
            aria-label="Submit query"
          >
            <IconSend />
          </button>
        </form>
        <p className="mt-2 text-center text-[10px] text-muted">
          Press Enter to submit · Shift+Enter for new line · All queries are validated and logged
        </p>
      </div>
    </div>
  )
}
