import { eq, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { organizationMembers, organizations } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import { writeAuditLog } from '@repo/audit'
import type { PlatformRole, CreateOrganization } from '@repo/types'

export interface OrganizationPipelineDeps {
  db: DbClient
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  platformRole: PlatformRole
}

export async function createOrganization(deps: OrganizationPipelineDeps, userId: string, input: CreateOrganization): Promise<OrganizationSummary> {
  const [org] = await deps.db.insert(organizations).values({ name: input.name, slug: input.slug }).returning()
  if (!org) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await deps.db.insert(organizationMembers).values({ orgId: org.id, userId, platformRole: 'owner' })

  await writeAuditLog(deps.db, {
    orgId: org.id,
    actorId: userId,
    action: 'ORGANIZATION_CREATED',
    resourceType: 'organization',
    resourceId: org.id,
    metadata: { name: org.name, slug: org.slug },
  })
  await writeAuditLog(deps.db, {
    orgId: org.id,
    actorId: userId,
    action: 'MEMBER_ADDED',
    resourceType: 'organization_member',
    resourceId: userId,
    metadata: { platformRole: 'owner' },
  })

  return { id: org.id, name: org.name, slug: org.slug, platformRole: 'owner' }
}

export async function listMyOrganizations(deps: OrganizationPipelineDeps, userId: string): Promise<OrganizationSummary[]> {
  const memberships = await deps.db.query.organizationMembers.findMany({ where: eq(organizationMembers.userId, userId) })
  if (memberships.length === 0) return []

  const orgs = await deps.db.query.organizations.findMany({
    where: inArray(organizations.id, memberships.map((m) => m.orgId)),
  })
  const orgById = new Map(orgs.map((o) => [o.id, o]))

  return memberships
    .map((m) => {
      const org = orgById.get(m.orgId)
      return org ? { id: org.id, name: org.name, slug: org.slug, platformRole: m.platformRole } : null
    })
    .filter((o): o is OrganizationSummary => o !== null)
}
