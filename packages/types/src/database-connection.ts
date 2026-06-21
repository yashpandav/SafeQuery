import { z } from 'zod'
import { EnvironmentType } from './enums'

const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export const EnvironmentSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: EnvironmentType,
  writeWindowStart: z.string().regex(TIME_OF_DAY_REGEX).nullable(),
  writeWindowEnd: z.string().regex(TIME_OF_DAY_REGEX).nullable(),
  writeWindowTimezone: z.string().nullable(),
  createdAt: z.date(),
})
export type Environment = z.infer<typeof EnvironmentSchema>

export const CreateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  type: EnvironmentType,
})
export type CreateEnvironment = z.infer<typeof CreateEnvironmentSchema>

export const UpdateEnvironmentTypeSchema = z.object({
  environmentId: z.string().uuid(),
  type: EnvironmentType,
})
export type UpdateEnvironmentType = z.infer<typeof UpdateEnvironmentTypeSchema>

export const UpdateEnvironmentWriteWindowSchema = z.object({
  environmentId: z.string().uuid(),
  writeWindow: z
    .object({
      start: z.string().regex(TIME_OF_DAY_REGEX, 'Use 24-hour HH:MM'),
      end: z.string().regex(TIME_OF_DAY_REGEX, 'Use 24-hour HH:MM'),
      timezone: z.string().min(1),
    })
    .nullable(),
})
export type UpdateEnvironmentWriteWindow = z.infer<typeof UpdateEnvironmentWriteWindowSchema>

export const DatabaseConnectionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  environmentId: z.string().uuid(),
  name: z.string().min(1).max(100),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  ssl: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type DatabaseConnection = z.infer<typeof DatabaseConnectionSchema>

export const DatabaseConnectionMetadataSchema = DatabaseConnectionSchema.pick({
  id: true,
  orgId: true,
  environmentId: true,
  name: true,
  host: true,
  port: true,
  database: true,
  ssl: true,
  createdAt: true,
})
export type DatabaseConnectionMetadata = z.infer<typeof DatabaseConnectionMetadataSchema>

export const CreateDatabaseConnectionSchema = z.object({
  name: z.string().min(1).max(100),
  environmentId: z.string().uuid(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().default(false),
})
export type CreateDatabaseConnection = z.infer<typeof CreateDatabaseConnectionSchema>

export const ColumnDefinitionSchema = z.object({
  column: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  isPii: z.boolean().default(false),
})
export type ColumnDefinition = z.infer<typeof ColumnDefinitionSchema>

export const SchemaSnapshotSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().uuid(),
  orgId: z.string().uuid(),
  snapshot: z.record(z.string(), z.array(ColumnDefinitionSchema)),
  capturedAt: z.date(),
})
export type SchemaSnapshot = z.infer<typeof SchemaSnapshotSchema>
