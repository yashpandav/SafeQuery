import { describe, it, expect } from 'vitest'
import { renderSchemaForPrompt, buildSystemPrompt, type FilteredSchema } from '../lib/schema-prompt'

const schema: FilteredSchema = {
  customers: [
    { column: 'id', type: 'uuid', nullable: false, isPii: false },
    { column: 'email', type: 'text', nullable: false, isPii: true },
  ],
}

describe('renderSchemaForPrompt', () => {
  it('renders tables and columns with type/nullable/PII annotations', () => {
    const text = renderSchemaForPrompt(schema)
    expect(text).toContain('Table "customers"')
    expect(text).toContain('id (uuid)')
    expect(text).toContain('email (text, PII)')
  })

  it('handles an empty schema explicitly rather than rendering nothing', () => {
    expect(renderSchemaForPrompt({})).toContain('no tables')
  })

  it('never mentions a table that was not included in the filtered schema', () => {
    const text = renderSchemaForPrompt(schema)
    expect(text).not.toContain('orders')
    expect(text).not.toContain('pg_')
  })
})

describe('buildSystemPrompt', () => {
  it('includes the rendered schema and policy notes', () => {
    const prompt = buildSystemPrompt(schema, ['Row caps are enforced separately'])
    expect(prompt).toContain('Table "customers"')
    expect(prompt).toContain('Row caps are enforced separately')
  })

  it('instructs the model never to reference system catalogs', () => {
    const prompt = buildSystemPrompt(schema, [])
    expect(prompt.toLowerCase()).toContain('information_schema')
  })

  it('omits the policy notes section when none are given', () => {
    const prompt = buildSystemPrompt(schema, [])
    expect(prompt).not.toContain('Additional policy notes')
  })
})
