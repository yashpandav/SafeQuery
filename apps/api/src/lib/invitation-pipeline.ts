import { randomUUID } from 'crypto'
import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { invitations, organizationMembers } from '@repo/db/schema'
import type { DbClient } from '@repo/db'
import type { CerbosClient, CerbosPrincipal } from '@repo/policy-client'
import { checkInvitation } from '@repo/policy-client'
import { writeAuditLog } from '@repo/audit'
import type { CreateInvitation, RevokeInvitation, PlatformRole } from '@repo/types'

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export interface InvitationPipelineDeps {
  db: DbClient
  cerbosClient: CerbosClient
}

export interface InvitationPrincipal {
  userId: string
  orgId: string
  platformRole: PlatformRole
}

export interface InvitationSummary {
  id: string
  email: string
  platformRole: PlatformRole
  expired: boolean
  expiresAt: Date
  createdAt: Date
}

function toCerbosPrincipal(p: InvitationPrincipal): CerbosPrincipal {
  return { userId: p.userId, orgId: p.orgId, platformRole: p.platformRole }
}

function toSummary(row: typeof invitations.$inferSelect, now: Date): InvitationSummary {
  return { id: row.id, email: row.email, platformRole: row.platformRole, expired: row.expiresAt <= now, expiresAt: row.expiresAt, createdAt: row.createdAt }
}

export async function listInvitations(deps: InvitationPipelineDeps, principal: InvitationPrincipal): Promise<InvitationSummary[]> {
  const decision = await checkInvitation(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'list', orgId: principal.orgId }, ['read'])
  if (!decision.read) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view invitations' })

  const rows = await deps.db.query.invitations.findMany({ where: eq(invitations.orgId, principal.orgId) })
  const now = new Date()
  return rows.map((r) => toSummary(r, now))
}

export async function createInvitation(deps: InvitationPipelineDeps, principal: InvitationPrincipal, input: CreateInvitation): Promise<InvitationSummary> {
  const decision = await checkInvitation(deps.cerbosClient, toCerbosPrincipal(principal), { id: 'new', orgId: principal.orgId }, ['create'])
  if (!decision.create) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to invite members' })

  const email = input.email.toLowerCase()
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS)
  const [invitation] = await deps.db
    .insert(invitations)
    .values({ orgId: principal.orgId, email, platformRole: input.platformRole, token: randomUUID(), expiresAt })
    .returning()
  if (!invitation) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'USER_INVITED',
    resourceType: 'invitation',
    resourceId: invitation.id,
    metadata: { email, platformRole: input.platformRole },
  })

  return toSummary(invitation, new Date())
}

export async function revokeInvitation(deps: InvitationPipelineDeps, principal: InvitationPrincipal, input: RevokeInvitation): Promise<{ id: string }> {
  const existing = await deps.db.query.invitations.findFirst({
    where: and(eq(invitations.id, input.invitationId), eq(invitations.orgId, principal.orgId)),
  })
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })

  const decision = await checkInvitation(deps.cerbosClient, toCerbosPrincipal(principal), { id: existing.id, orgId: principal.orgId }, ['delete'])
  if (!decision.delete) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to revoke invitations' })

  await deps.db.delete(invitations).where(eq(invitations.id, existing.id))

  await writeAuditLog(deps.db, {
    orgId: principal.orgId,
    actorId: principal.userId,
    action: 'INVITATION_REVOKED',
    resourceType: 'invitation',
    resourceId: existing.id,
    metadata: { email: existing.email },
  })

  return { id: existing.id }
}

/**
 * Called from auth.exchangeToken on every login — no Cerbos check, since "do I have a pending
 * invitation by my own email" isn't an access-control decision (mirrors organization.list's
 * reasoning: membership rows, not Cerbos, are the source of truth here). Joins the user to every
 * org they have a still-valid invitation for, skipping orgs they're already a member of (an admin
 * re-inviting an existing member shouldn't crash on the composite-key insert), and always consumes
 * (deletes) the invitation row whether or not the membership already existed.
 */
export async function acceptPendingInvitations(deps: { db: DbClient }, userId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  const pending = await deps.db.query.invitations.findMany({ where: eq(invitations.email, normalizedEmail) })
  const now = new Date()
  const valid = pending.filter((invite) => invite.expiresAt > now)
  if (valid.length === 0) return

  const existingMemberships = await deps.db.query.organizationMembers.findMany({ where: eq(organizationMembers.userId, userId) })
  const memberOrgIds = new Set(existingMemberships.map((m) => m.orgId))

  for (const invite of valid) {
    if (!memberOrgIds.has(invite.orgId)) {
      await deps.db.insert(organizationMembers).values({ orgId: invite.orgId, userId, platformRole: invite.platformRole })
      await writeAuditLog(deps.db, {
        orgId: invite.orgId,
        actorId: userId,
        action: 'MEMBER_ADDED',
        resourceType: 'organization_member',
        resourceId: userId,
        metadata: { platformRole: invite.platformRole, viaInvitationId: invite.id },
      })
    }
    await deps.db.delete(invitations).where(eq(invitations.id, invite.id))
  }
}
