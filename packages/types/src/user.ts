import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().uuid(),
  keycloakId: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type User = z.infer<typeof UserSchema>

export const UpsertUserSchema = z.object({
  keycloakId: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
})
export type UpsertUser = z.infer<typeof UpsertUserSchema>
