import type { Client } from 'pg'
import type { CaptureSchemaJobData, CaptureSchemaJobResult, ColumnDefinition } from '@repo/queue'
import { defaultClientFactory, type ClientFactory } from './pg-client'
const PII_COLUMN_PATTERN = /email|phone|ssn|social_security|credit_card|password|street_address|date_of_birth|\bdob\b|national_id/i

interface InformationSchemaRow {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
}

export function buildSnapshot(rows: InformationSchemaRow[]): Record<string, ColumnDefinition[]> {
  const snapshot: Record<string, ColumnDefinition[]> = {}
  for (const row of rows) {
    const columns = snapshot[row.table_name] ?? []
    columns.push({
      column: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      isPii: PII_COLUMN_PATTERN.test(row.column_name),
    })
    snapshot[row.table_name] = columns
  }
  return snapshot
}

export async function handleCaptureSchema(
  data: CaptureSchemaJobData,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<CaptureSchemaJobResult> {
  const client: Client = clientFactory(data.connection)
  try {
    await client.connect()
    const result = await client.query<InformationSchemaRow>(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `)
    return { success: true, error: null, snapshot: buildSnapshot(result.rows) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Schema discovery failed', snapshot: null }
  } finally {
    await client.end().catch(() => {})
  }
}
