'use client'

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@repo/api/router'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type SubmitResult = RouterOutputs['query']['submit']

interface QueryResultProps {
  result: SubmitResult
  onAcknowledge: () => void
  acknowledging: boolean
}

const BANNER_CLASS: Record<SubmitResult['riskLevel'], string> = {
  SAFE: 'border-safe/40 bg-safe-bg text-safe',
  WARNING: 'border-warning/40 bg-warning-bg text-warning',
  CRITICAL: 'border-critical/40 bg-critical-bg text-critical',
  SECURITY_INCIDENT: 'border-danger/40 bg-danger-bg text-danger',
}

function ResultTable({ result }: { result: NonNullable<SubmitResult['result']> }) {
  if (result.rowCount === 0) return <p className="text-sm text-muted">No rows returned.</p>
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th key={col} className="border border-border px-3 py-1.5 text-left font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                {result.columns.map((col) => (
                  <td key={col} className="border border-border px-3 py-1.5">
                    {String(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        {result.rowCount} row(s) in {result.executionMs}ms{result.truncated ? ' (truncated by row cap)' : ''}
        {result.maskedColumns.length > 0 ? ` — masked: ${result.maskedColumns.join(', ')}` : ''}
      </p>
    </>
  )
}

export function QueryResult({ result, onAcknowledge, acknowledging }: QueryResultProps) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div role="status" className={`rounded border px-3 py-2 text-sm ${BANNER_CLASS[result.riskLevel]}`}>
        <strong>{result.riskLevel}</strong>
        {result.explanation ? ` — ${result.explanation}` : ''}
      </div>

      {result.rewrittenSql && (
        <pre className="mt-3 overflow-x-auto rounded bg-black/5 p-3 text-xs whitespace-pre-wrap dark:bg-white/10">
          <code>{result.rewrittenSql}</code>
        </pre>
      )}

      {result.violations.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-muted">
          {result.violations.map((v) => (
            <li key={v.code}>{v.message}</li>
          ))}
        </ul>
      )}

      {result.riskLevel === 'WARNING' && result.requiresAcknowledgment && result.simulation && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm">
            Estimated rows: <strong>{result.simulation.estimatedRowCount ?? 'unknown'}</strong>
          </p>
          <button
            type="button"
            onClick={onAcknowledge}
            disabled={acknowledging}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {acknowledging ? 'Running…' : 'Acknowledge & Run'}
          </button>
        </div>
      )}

      {result.riskLevel === 'CRITICAL' && result.requiresApproval && (
        <div className="mt-3">
          <p className="text-sm">Awaiting reviewer approval. Request ID:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-xs dark:bg-white/10">
            <code>{result.approvalRequestId}</code>
          </pre>
          {result.simulation && (
            <>
              <p className="mt-2 text-sm text-muted">
                Dry-run affected {result.simulation.affectedRows ?? 0} row(s) — nothing committed yet.
              </p>
              {result.simulation.previewRows && result.simulation.previewRows.length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-xs dark:bg-white/10">
                  {JSON.stringify(result.simulation.previewRows, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {result.result && (
        <div className="mt-3">
          <ResultTable result={result.result} />
        </div>
      )}
    </div>
  )
}
