import { generateText, Output, type LanguageModel } from 'ai'
import { GeneratedSqlSchema, type GeneratedSql } from '@repo/types'
import { sanitizePrompt } from './sanitize'
import { screenPrompt } from './injection-screen'
import { buildSystemPrompt, type FilteredSchema } from './schema-prompt'

export interface GenerateSqlInput {
  naturalLanguage: string
  schema: FilteredSchema
  policyNotes: string[]
}

export interface GenerateSqlModels {
  generation: LanguageModel
  screening: LanguageModel
}
function blockedResult(reason: string): GeneratedSql {
  return {
    sql: '',
    explanation: '',
    riskLevel: 'SECURITY_INCIDENT',
    riskReason: reason,
    affectedTables: [],
    isWrite: false,
    estimatedRowCount: null,
  }
}
export async function generateSql(input: GenerateSqlInput, models: GenerateSqlModels): Promise<GeneratedSql> {
  const sanitized = sanitizePrompt(input.naturalLanguage)
  if (!sanitized) {
    return blockedResult('Empty or unintelligible prompt after sanitization')
  }

  const screen = await screenPrompt(sanitized, models.screening)
  if (screen.flagged) {
    return blockedResult(`Prompt-injection screen: ${screen.reason}`)
  }

  const { output } = await generateText({
    model: models.generation,
    output: Output.object({ schema: GeneratedSqlSchema }),
    system: buildSystemPrompt(input.schema, input.policyNotes),
    prompt: sanitized,
    maxOutputTokens: 2000,
  })

  return output
}
