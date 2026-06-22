
export const JOB_NAMES = {
  TEST_CONNECTION: 'test_connection',
  CAPTURE_SCHEMA: 'capture_schema',
  EXECUTE_READ: 'execute_read',
  EXECUTE_WRITE: 'execute_write',
} as const

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES]
export interface ConnectionTarget {
  host: string
  port: number
  database: string
  ssl: boolean
  encryptedCredentials: string
}

export interface ColumnDefinition {
  column: string
  type: string
  nullable: boolean
  isPii: boolean
}
export interface TestConnectionJobData {
  type: typeof JOB_NAMES.TEST_CONNECTION
  orgId: string
  host: string
  port: number
  database: string
  ssl: boolean
  username: string
  password: string
}
export interface TestConnectionJobResult {
  success: boolean
  error: string | null
  encryptedCredentials: string | null
}
export interface CaptureSchemaJobData {
  type: typeof JOB_NAMES.CAPTURE_SCHEMA
  orgId: string
  connection: ConnectionTarget
}
export interface CaptureSchemaJobResult {
  success: boolean
  error: string | null
  snapshot: Record<string, ColumnDefinition[]> | null
}
export interface ExecuteReadJobData {
  type: typeof JOB_NAMES.EXECUTE_READ
  orgId: string
  connection: ConnectionTarget
  sql: string
  rowCap: number | null
  maskedColumns: string[]
  explainOnly?: boolean
}
export interface ExecuteReadJobResult {
  success: boolean
  error: string | null
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
  maskedColumns: string[]
  executionMs: number
  plan: string | null
  estimatedRowCount: number | null
}
export interface ExecuteWriteJobData {
  type: typeof JOB_NAMES.EXECUTE_WRITE
  orgId: string
  connection: ConnectionTarget
  sql: string
  dryRun: boolean
}
export interface ExecuteWriteJobResult {
  success: boolean
  error: string | null
  affectedRows: number
  previewRows: Record<string, unknown>[]
  executionMs: number
  committed: boolean
}

export type ExecutionJobData = TestConnectionJobData | CaptureSchemaJobData | ExecuteReadJobData | ExecuteWriteJobData
export type ExecutionJobResult =
  | TestConnectionJobResult
  | CaptureSchemaJobResult
  | ExecuteReadJobResult
  | ExecuteWriteJobResult
export interface JobResultMap {
  [JOB_NAMES.TEST_CONNECTION]: TestConnectionJobResult
  [JOB_NAMES.CAPTURE_SCHEMA]: CaptureSchemaJobResult
  [JOB_NAMES.EXECUTE_READ]: ExecuteReadJobResult
  [JOB_NAMES.EXECUTE_WRITE]: ExecuteWriteJobResult
}
