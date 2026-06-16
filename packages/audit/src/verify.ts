import { createHash } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { DbClient } from '@repo/db'
import { auditLogs } from '@repo/db/schema'

export interface IntegrityResult {
  valid: boolean
  checkedCount: number
  firstMismatchId?: string
  firstMismatchIndex?: number
}

export async function verifyIntegrity(
  db: DbClient,
  orgId: string,
): Promise<IntegrityResult> {
  // Order must be deterministic and match the order writer.ts uses to find prevHash.
  // Secondary sort by id breaks timestamp ties consistently.
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))

  for (let i = 0; i < logs.length; i++) {
    const row = logs[i]!
    const expectedPrevHash = i === 0 ? null : logs[i - 1]!.hash

    const canonical = JSON.stringify({
      orgId: row.orgId,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId ?? null,
      metadata: row.metadata,
    })

    const expectedHash = createHash('sha256')
      .update((expectedPrevHash ?? '') + canonical)
      .digest('hex')

    if (row.hash !== expectedHash || row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checkedCount: i + 1,
        firstMismatchId: row.id,
        firstMismatchIndex: i,
      }
    }
  }

  return { valid: true, checkedCount: logs.length }
}
