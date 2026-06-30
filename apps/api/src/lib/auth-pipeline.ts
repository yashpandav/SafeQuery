import { eq } from 'drizzle-orm'
import { organizationMembers } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import { writeAuditLog } from '@repo/audit'
import type { SessionBlocklist } from './session-blocklist'

export interface LogoutDeps {
  db: DbClient
  blocklist: SessionBlocklist
}

export async function logoutSession(deps: LogoutDeps, userId: string, sessionId: string): Promise<void> {
  await deps.blocklist.block(sessionId)

  const memberships = await deps.db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, userId),
    columns: { orgId: true },
  })

  await Promise.all(
    memberships.map((m) =>
      writeAuditLog(deps.db, {
        orgId: m.orgId,
        actorId: userId,
        action: 'USER_LOGOUT',
        resourceType: 'user',
        resourceId: userId,
        metadata: {},
      }),
    ),
  )
}
