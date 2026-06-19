'use client'

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@repo/api/router'
import { Badge, type RiskTone } from './components/badge'
import { Button } from './components/button'
import { Card } from './components/card'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type SubmitResult = RouterOutputs['query']['submit']

interface QueryResultProps {
  result: SubmitResult
  onAcknowledge: () => void
  acknowledging: boolean
}

const RISK_TONE: Record<SubmitResult['riskLevel'], RiskTone> = {
  SAFE: 'safe',
  WARNING: 'warning',
  CRITICAL: 'critical',
  SECURITY_INCIDENT: 'incident',
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-code-bg p-3 text-xs whitespace-pre-wrap text-code-fg">
      <code>{children}</code>
    </pre>
  )
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
                <th key={col} className="border-b border-border px-3 py-1.5 text-left font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="hover:bg-black/[0.02]">
                {result.columns.map((col) => (
                  <td key={col} className="border-b border-border px-3 py-1.5">
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
    <Card>
      <div role="status" className="flex items-center gap-2">
        <Badge tone={RISK_TONE[result.riskLevel]}>{result.riskLevel.replace('_', ' ')}</Badge>
        {result.explanation && <span className="text-sm text-muted">{result.explanation}</span>}
      </div>

      {result.rewrittenSql && <CodeBlock>{result.rewrittenSql}</CodeBlock>}

      {result.violations.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-muted">
          {result.violations.map((v) => (
            <li key={v.code}>{v.message}</li>
          ))}
        </ul>
      )}

      {result.riskLevel === 'WARNING' && result.requiresAcknowledgment && result.simulation && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-warning-bg px-3 py-2">
          <p className="text-sm text-warning">
            Estimated rows: <strong>{result.simulation.estimatedRowCount ?? 'unknown'}</strong> — nothing has run yet.
          </p>
          <Button variant="primary" onClick={onAcknowledge} disabled={acknowledging}>
            {acknowledging ? 'Running…' : 'Acknowledge & Run'}
          </Button>
        </div>
      )}

      {result.riskLevel === 'CRITICAL' && result.requiresApproval && (
        <div className="mt-3">
          <p className="text-sm text-muted">Awaiting reviewer approval. Request ID:</p>
          <CodeBlock>{result.approvalRequestId}</CodeBlock>
          {result.simulation && (
            <>
              <p className="mt-2 text-sm text-muted">
                Dry-run preview · rolled back, nothing committed — affected {result.simulation.affectedRows ?? 0} row(s).
              </p>
              {result.simulation.previewRows && result.simulation.previewRows.length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-neutral-bg p-2 text-xs text-foreground">
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
    </Card>
  )
}
