import { JOB_NAMES, type ExecutionJobData, type ExecutionJobResult } from '@repo/queue'
import { handleTestConnection } from './test-connection'
import { handleCaptureSchema } from './capture-schema'
import { handleExecuteRead } from './execute-read'
import { handleExecuteWrite } from './execute-write'
export async function handleJob(data: ExecutionJobData): Promise<ExecutionJobResult> {
  switch (data.type) {
    case JOB_NAMES.TEST_CONNECTION:
      return handleTestConnection(data)
    case JOB_NAMES.CAPTURE_SCHEMA:
      return handleCaptureSchema(data)
    case JOB_NAMES.EXECUTE_READ:
      return handleExecuteRead(data)
    case JOB_NAMES.EXECUTE_WRITE:
      return handleExecuteWrite(data)
  }
}
