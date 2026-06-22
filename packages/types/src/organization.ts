import { z } from 'zod'
import { PlatformRole } from './enums'

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Organization = z.infer<typeof OrganizationSchema>

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
})
export type CreateOrganization = z.infer<typeof CreateOrganizationSchema>

export const OrganizationMemberSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  platformRole: PlatformRole,
  createdAt: z.date(),
})
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  platformRole: PlatformRole,
  customRoleId: z.string().uuid().nullable(),
  token: z.string(),
  expiresAt: z.date(),
  createdAt: z.date(),
})
export type Invitation = z.infer<typeof InvitationSchema>

export const CreateInvitationSchema = z.object({
  email: z.string().email(),
  platformRole: PlatformRole,
  customRoleId: z.string().uuid().nullable().optional(),
})
export type CreateInvitation = z.infer<typeof CreateInvitationSchema>

export const RevokeInvitationSchema = z.object({
  invitationId: z.string().uuid(),
})
export type RevokeInvitation = z.infer<typeof RevokeInvitationSchema>

export const UpdateMemberRoleSchema = z
  .object({
    userId: z.string().uuid(),
    platformRole: PlatformRole.optional(),
    customRoleId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => data.platformRole !== undefined || data.customRoleId !== undefined, {
    message: 'Provide at least one of platformRole or customRoleId to update',
  })
export type UpdateMemberRole = z.infer<typeof UpdateMemberRoleSchema>

export const RemoveMemberSchema = z.object({ userId: z.string().uuid() })
export type RemoveMember = z.infer<typeof RemoveMemberSchema>
