import { eq, and, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { organizationMembers, customRoles, users } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkOrganizationMember } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import type { UpdateMemberRole, RemoveMember, PlatformRole } from '@repo/types'

export interface MemberPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface MemberPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface MemberSummary {
  userId: string
  email: string
  name: string | null
  platformRole: PlatformRole
  customRoleId: string | null
  customRoleName: string | null
  joinedAt: Date
}

function toCerbosPrincipal(p: MemberPrincipal): CerbosPrincipal {
  return { userId: p.userId, orgId: p.orgId, platformRole: p.platformRole }
}

async function composeSummaries(
  deps: MemberPipelineDeps,
  memberships: (typeof organizationMembers.$inferSelect)[],
): Promise<MemberSummary[]> {
  if (memberships.length === 0) return []

  const userRows = await deps.db.query.users.findMany({
    where: inArray(users.id, memberships.map((m) => m.userId)),
  })
  const userById = new Map(userRows.map((u) => [u.id, u]))

  const customRoleIds = memberships
    .map((m) => m.customRoleId)
    .filter((id): id is string => id !== null)
  const roleRows = customRoleIds.length > 0
    ? await deps.db.query.customRoles.findMany({ where: inArray(customRoles.id, customRoleIds) })
    : []
  const roleById = new Map(roleRows.map((r) => [r.id, r]))

  return memberships
    .map((m) => {
      const user = userById.get(m.userId)
      const role = m.customRoleId ? roleById.get(m.customRoleId) : undefined
      return {
        userId: m.userId,
        email: user?.email ?? '',
        name: user?.name ?? null,
        platformRole: m.platformRole,
        customRoleId: m.customRoleId,
        customRoleName: role?.name ?? null,
        joinedAt: m.createdAt,
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))
}

export interface MyMembership {
  customRoleId: string | null
  customRoleName: string | null
  platformRole: PlatformRole
}

export async function getMyMembership(deps: MemberPipelineDeps, principal: MemberPrincipal): Promise<MyMembership> {
  const membership = await deps.db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.userId, principal.userId)),
  })
  if (!membership) throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' })

  let customRoleName: string | null = null
  if (membership.customRoleId) {
    const role = await deps.db.query.customRoles.findFirst({ where: eq(customRoles.id, membership.customRoleId) })
    customRoleName = role?.name ?? null
  }

  return { customRoleId: membership.customRoleId, customRoleName, platformRole: membership.platformRole as PlatformRole }
}

export async function listMembers(deps: MemberPipelineDeps, principal: MemberPrincipal): Promise<MemberSummary[]> {
  const decision = await checkOrganizationMember(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'list', orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view organization members' })

  const memberships = await deps.db.query.organizationMembers.findMany({ where: eq(organizationMembers.orgId, principal.orgId) })
  return composeSummaries(deps, memberships)
}

export async function updateMemberRole(
  deps: MemberPipelineDeps,
  principal: MemberPrincipal,
  input: UpdateMemberRole,
): Promise<MemberSummary> {
  const existing = await deps.db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.userId, input.userId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this organization' })

  const decision = await checkOrganizationMember(deps.cerbosClient, toCerbosPrincipal(principal), { id: input.userId, orgId: principal.orgId }, ['update'])
  if (!decision.update) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update organization members' })

  if (input.platformRole !== undefined) {
    const grantingOrRevokingOwner = input.platformRole === 'owner' || existing.platformRole === 'owner'
    if (grantingOrRevokingOwner && principal.platformRole !== 'owner') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only an owner can grant or revoke the owner role' })
    }
  }

  if (input.customRoleId !== undefined && input.customRoleId !== null) {
    const role = await deps.db.query.customRoles.findFirst({
      where: and(eq(customRoles.id, input.customRoleId), eq(customRoles.orgId, principal.orgId)),
    })
    if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Custom role not found in this organization' })
  }

  const isDemotingOwner = existing.platformRole === 'owner' && input.platformRole !== undefined && input.platformRole !== 'owner'
  if (isDemotingOwner) {
    const owners = await deps.db.query.organizationMembers.findMany({
      where: and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.platformRole, 'owner')),
    })
    if (owners.length === 1) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot demote the last owner of an organization' })
    }
  }

  const setValues: Partial<typeof organizationMembers.$inferInsert> = {}
  if (input.platformRole !== undefined) setValues.platformRole = input.platformRole
  if (input.customRoleId !== undefined) setValues.customRoleId = input.customRoleId

  const [updated] = await deps.db
    .update(organizationMembers)
    .set(setValues)
    .where(and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.userId, input.userId)))
    .returning()
  if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'MEMBER_ROLE_CHANGED',
    resourceType: 'organization_member',
    resourceId: input.userId,
    metadata: {
      previousPlatformRole: existing.platformRole,
      newPlatformRole: input.platformRole ?? existing.platformRole,
      previousCustomRoleId: existing.customRoleId,
      newCustomRoleId: input.customRoleId !== undefined ? input.customRoleId : existing.customRoleId,
    },
  })

  const [summary] = await composeSummaries(deps, [updated])
  if (!summary) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
  return summary
}

export async function removeMember(
  deps: MemberPipelineDeps,
  principal: MemberPrincipal,
  input: RemoveMember,
): Promise<{ userId: string }> {
  const existing = await deps.db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.userId, input.userId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this organization' })

  const decision = await checkOrganizationMember(deps.cerbosClient, toCerbosPrincipal(principal), { id: input.userId, orgId: principal.orgId }, ['delete'])
  if (!decision.delete) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to remove organization members' })

  if (existing.platformRole === 'owner') {
    const owners = await deps.db.query.organizationMembers.findMany({
      where: and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.platformRole, 'owner')),
    })
    if (owners.length === 1) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot remove the last owner of an organization' })
    }
  }

  await deps.db.delete(organizationMembers).where(and(eq(organizationMembers.orgId, principal.orgId), eq(organizationMembers.userId, input.userId)))

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'MEMBER_REMOVED',
    resourceType: 'organization_member',
    resourceId: input.userId,
    metadata: { platformRole: existing.platformRole },
  })

  return { userId: input.userId }
}
