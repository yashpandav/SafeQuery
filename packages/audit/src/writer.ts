import { createHash } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { DbClient } from '@repo/db'
import { auditLogs } from '@repo/db/schema'
import type { WriteAuditLog } from '@repo/types'

function canonicalJson(entry: WriteAuditLog): string {
  return JSON.stringify({
    orgId: entry.orgId,
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    metadata: entry.metadata,
  })
}

function computeHash(prevHash: string | null, canonical: string): string {
  return createHash('sha256')
    .update((prevHash ?? '') + canonical)
    .digest('hex')
}

export async function writeAuditLog(
  db: DbClient,
  entry: WriteAuditLog,
): Promise<void> {
  await db.transaction(async (tx) => {
    const last = await tx
      .select({ hash: auditLogs.hash })
      .from(auditLogs)
      .where(eq(auditLogs.orgId, entry.orgId))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(1)
      .for('update')

    const prevHash = last[0]?.hash ?? null
    const canonical = canonicalJson(entry)
    const hash = computeHash(prevHash, canonical)

    await tx.insert(auditLogs).values({
      orgId: entry.orgId,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata,
      prevHash,
      hash,
    })
  })
}
