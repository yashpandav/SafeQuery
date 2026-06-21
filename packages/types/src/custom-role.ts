import { z } from 'zod'
import { AllowedAction } from './enums'
import { CustomRoleConfigSchema } from './query'

export const CustomRoleSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable(),
  config: CustomRoleConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type CustomRole = z.infer<typeof CustomRoleSchema>

export const CreateCustomRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  allowedTables: z.array(z.string()),
  allowedColumns: z.record(z.string(), z.array(z.string())).default({}),
  allowedActions: z.array(AllowedAction).min(1),
  rowFilters: z.record(z.string(), z.string()).default({}),
  rowCap: z.number().int().positive().nullable(),
  maskPii: z.boolean().default(true),
  allowExport: z.boolean().default(false),
})
export type CreateCustomRole = z.infer<typeof CreateCustomRoleSchema>

export const UpdateCustomRoleSchema = z.object({
  customRoleId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  allowedTables: z.array(z.string()),
  allowedColumns: z.record(z.string(), z.array(z.string())).default({}),
  allowedActions: z.array(AllowedAction).min(1),
  rowFilters: z.record(z.string(), z.string()).default({}),
  rowCap: z.number().int().positive().nullable(),
  maskPii: z.boolean().default(true),
  allowExport: z.boolean().default(false),
})
export type UpdateCustomRole = z.infer<typeof UpdateCustomRoleSchema>
