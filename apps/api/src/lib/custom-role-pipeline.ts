import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { customRoles, organizationMembers } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkCustomRole } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import type { CustomRoleConfig, CreateCustomRole, UpdateCustomRole, PlatformRole } from '@repo/types'

export interface CustomRolePipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface CustomRolePrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface CustomRoleSummary {
  id: string
  name: string
  description: string | null
  config: CustomRoleConfig
  memberCount: number
  createdAt: Date
  updatedAt: Date
}

function toCerbosPrincipal(p: CustomRolePrincipal): CerbosPrincipal {
  return { userId: p.userId, orgId: p.orgId, platformRole: p.platformRole }
}

function toConfig(input: { allowedTables: string[]; allowedColumns: Record<string, string[]>; allowedActions: CustomRoleConfig['allowedActions']; rowFilters: Record<string, string>; rowCap: number | null; maskPii: boolean }): CustomRoleConfig {
  return {
    allowedTables: input.allowedTables,
    allowedColumns: input.allowedColumns,
    allowedActions: input.allowedActions,
    rowFilters: input.rowFilters,
    rowCap: input.rowCap,
    maskPii: input.maskPii,
  }
}

async function withMemberCounts(deps: CustomRolePipelineDeps, orgId: string, roles: (typeof customRoles.$inferSelect)[]): Promise<CustomRoleSummary[]> {
  if (roles.length === 0) return []
  const memberships = await deps.db.query.organizationMembers.findMany({ where: eq(organizationMembers.orgId, orgId) })
  const countByRoleId = new Map<string, number>()
  for (const m of memberships) {
    if (!m.customRoleId) continue
    countByRoleId.set(m.customRoleId, (countByRoleId.get(m.customRoleId) ?? 0) + 1)
  }
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    config: r.config,
    memberCount: countByRoleId.get(r.id) ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
}

export async function listCustomRoles(deps: CustomRolePipelineDeps, principal: CustomRolePrincipal): Promise<CustomRoleSummary[]> {
  const decision = await checkCustomRole(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'list', orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view custom roles' })

  const roles = await deps.db.query.customRoles.findMany({ where: eq(customRoles.orgId, principal.orgId) })
  return withMemberCounts(deps, principal.orgId, roles)
}

export async function createCustomRole(deps: CustomRolePipelineDeps, principal: CustomRolePrincipal, input: CreateCustomRole): Promise<CustomRoleSummary> {
  const decision = await checkCustomRole(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'new', orgId: principal.orgId }, ['create'])
  if (!decision.create) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to create custom roles' })

  const [role] = await deps.db
    .insert(customRoles)
    .values({
      orgId: principal.orgId,
      name: input.name,
      description: input.description ?? null,
      config: toConfig(input),
    })
    .returning()
  if (!role) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'CUSTOM_ROLE_CREATED',
    resourceType: 'custom_role',
    resourceId: role.id,
    metadata: { name: role.name },
  })

  return { id: role.id, name: role.name, description: role.description, config: role.config, memberCount: 0, createdAt: role.createdAt, updatedAt: role.updatedAt }
}

export async function updateCustomRole(deps: CustomRolePipelineDeps, principal: CustomRolePrincipal, input: UpdateCustomRole): Promise<CustomRoleSummary> {
  const existing = await deps.db.query.customRoles.findFirst({
    where: and(eq(customRoles.id, input.customRoleId), eq(customRoles.orgId, principal.orgId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Custom role not found' })

  const decision = await checkCustomRole(deps.cerbosClient, toCerbosPrincipal(principal), { id: existing.id, orgId: principal.orgId }, ['update'])
  if (!decision.update) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update custom roles' })

  const [updated] = await deps.db
    .update(customRoles)
    .set({
      name: input.name,
      description: input.description ?? null,
      config: toConfig(input),
      updatedAt: new Date(),
    })
    .where(eq(customRoles.id, existing.id))
    .returning()
  if (!updated) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'CUSTOM_ROLE_UPDATED',
    resourceType: 'custom_role',
    resourceId: updated.id,
    metadata: { name: updated.name },
  })

  const [summary] = await withMemberCounts(deps, principal.orgId, [updated])
  if (!summary) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
  return summary
}

export async function deleteCustomRole(deps: CustomRolePipelineDeps, principal: CustomRolePrincipal, customRoleId: string): Promise<{ id: string }> {
  const existing = await deps.db.query.customRoles.findFirst({
    where: and(eq(customRoles.id, customRoleId), eq(customRoles.orgId, principal.orgId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Custom role not found' })

  const decision = await checkCustomRole(deps.cerbosClient, toCerbosPrincipal(principal), { id: existing.id, orgId: principal.orgId }, ['delete'])
  if (!decision.delete) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete custom roles' })

  await deps.db.delete(customRoles).where(eq(customRoles.id, existing.id))

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'CUSTOM_ROLE_DELETED',
    resourceType: 'custom_role',
    resourceId: existing.id,
    metadata: { name: existing.name },
  })

  return { id: existing.id }
}
