import { z } from 'zod'
import { ColumnDefinitionSchema, GeneratedSqlSchema } from '@repo/types'
import { createTRPCRouter, serviceProcedure } from '../init'
import { generateSql } from '../../lib/generate-sql'
import { generationModel, screeningModel } from '../../lib/model'

const FilteredSchemaSchema = z.record(z.string(), z.array(ColumnDefinitionSchema))

export const generateRouter = createTRPCRouter({
  generate: serviceProcedure
    .input(
      z.object({
        naturalLanguage: z.string().min(1).max(2000),
        schema: FilteredSchemaSchema,
        policyNotes: z.array(z.string()).default([]),
      }),
    )
    .output(GeneratedSqlSchema)
    .mutation(async ({ input }) => {
      return generateSql(
        { naturalLanguage: input.naturalLanguage, schema: input.schema, policyNotes: input.policyNotes },
        { generation: generationModel, screening: screeningModel },
      )
    }),
})
