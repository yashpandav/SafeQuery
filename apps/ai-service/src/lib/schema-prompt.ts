import type { ColumnDefinition } from '@repo/types'

export type FilteredSchema = Record<string, ColumnDefinition[]>
export function renderSchemaForPrompt(schema: FilteredSchema): string {
  const tableNames = Object.keys(schema)
  if (tableNames.length === 0) return '(no tables are available to you)'

  return tableNames
    .map((table) => {
      const columns = schema[table] ?? []
      const columnList = columns
        .map((c) => `  - ${c.column} (${c.type}${c.nullable ? ', nullable' : ''}${c.isPii ? ', PII' : ''})`)
        .join('\n')
      return `Table "${table}":\n${columnList}`
    })
    .join('\n\n')
}

export function buildSystemPrompt(schema: FilteredSchema, policyNotes: string[]): string {
  const schemaText = renderSchemaForPrompt(schema)
  const notesText = policyNotes.length > 0 ? `\n\nAdditional policy notes:\n${policyNotes.map((n) => `- ${n}`).join('\n')}` : ''

  return [
    'You are a SQL generation assistant for SafeQuery, a database governance platform.',
    'Translate the user\'s natural-language request into a single PostgreSQL statement.',
    '',
    'Rules:',
    '- You may ONLY reference the tables and columns listed below. Never reference any other',
    '  table or column, including system catalogs (pg_*, information_schema) — you have not',
    '  been told they exist, and any reference to them will be rejected.',
    '- Generate exactly ONE statement. Never use semicolons to chain multiple statements.',
    '- Prefer SELECT, INSERT, UPDATE, or DELETE. Never generate DDL (CREATE/ALTER/DROP/TRUNCATE).',
    '- Always include a LIMIT on SELECT statements unless the user clearly wants every row.',
    '- Do not invent a WHERE clause to enforce permissions — that is handled separately.',
    '- Set isWrite to true for INSERT/UPDATE/DELETE, false for SELECT.',
    '- riskLevel/riskReason are your own best-effort assessment; they are advisory only and',
    '  will be independently re-verified — answer honestly, this is not the security boundary.',
    '',
    'Available schema:',
    schemaText,
    notesText,
  ]
    .join('\n')
    .trim()
}
