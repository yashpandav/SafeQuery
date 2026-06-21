'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '../components/button'

const ALL_ACTIONS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const

export interface RoleFormValues {
  name: string
  description: string
  allowedTables: string
  allowedActions: string[]
  rowCap: string
  maskPii: boolean
  allowExport: boolean
}

const EMPTY_VALUES: RoleFormValues = {
  name: '',
  description: '',
  allowedTables: '',
  allowedActions: ['SELECT'],
  rowCap: '',
  maskPii: true,
  allowExport: false,
}

interface RoleFormProps {
  initial?: RoleFormValues
  submitLabel: string
  onSubmit: (values: {
    name: string
    description: string | null
    allowedTables: string[]
    allowedActions: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[]
    rowCap: number | null
    maskPii: boolean
    allowExport: boolean
  }) => Promise<void>
  onCancel?: () => void
  pending: boolean
}

export function RoleForm({ initial, submitLabel, onSubmit, onCancel, pending }: RoleFormProps) {
  const [values, setValues] = useState<RoleFormValues>(initial ?? EMPTY_VALUES)

  function toggleAction(action: string) {
    setValues((v) => ({
      ...v,
      allowedActions: v.allowedActions.includes(action) ? v.allowedActions.filter((a) => a !== action) : [...v.allowedActions, action],
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await onSubmit({
      name: values.name,
      description: values.description.trim() ? values.description.trim() : null,
      allowedTables: values.allowedTables
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      allowedActions: values.allowedActions as ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[],
      rowCap: values.rowCap.trim() ? Number(values.rowCap) : null,
      maskPii: values.maskPii,
      allowExport: values.allowExport,
    })
  }

  return (
    <form onSubmit={handleSubmit} aria-label={submitLabel} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="role-name" className="text-sm text-muted">
          Name
        </label>
        <input
          id="role-name"
          type="text"
          required
          aria-required="true"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          className="rounded-lg border border-border bg-transparent px-3 py-2"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="role-description" className="text-sm text-muted">
          Description (optional)
        </label>
        <input
          id="role-description"
          type="text"
          value={values.description}
          onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
          className="rounded-lg border border-border bg-transparent px-3 py-2"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="role-tables" className="text-sm text-muted">
          Allowed tables (comma-separated)
        </label>
        <input
          id="role-tables"
          type="text"
          required
          aria-required="true"
          value={values.allowedTables}
          onChange={(e) => setValues((v) => ({ ...v, allowedTables: e.target.value }))}
          placeholder="customers, orders"
          className="rounded-lg border border-border bg-transparent px-3 py-2"
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm text-muted">Capabilities</legend>
        <div className="flex gap-4">
          {ALL_ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={values.allowedActions.includes(action)} onChange={() => toggleAction(action)} />
              {action}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="role-row-cap" className="text-sm text-muted">
          Row cap (optional)
        </label>
        <input
          id="role-row-cap"
          type="number"
          min={1}
          value={values.rowCap}
          onChange={(e) => setValues((v) => ({ ...v, rowCap: e.target.value }))}
          className="rounded-lg border border-border bg-transparent px-3 py-2"
        />
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={values.maskPii} onChange={(e) => setValues((v) => ({ ...v, maskPii: e.target.checked }))} />
        Mask PII columns by default
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={values.allowExport} onChange={(e) => setValues((v) => ({ ...v, allowExport: e.target.checked }))} />
        Allow exporting results (CSV / JSON)
      </label>
      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={pending || values.allowedActions.length === 0}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

export function roleToFormValues(role: {
  name: string
  description: string | null
  config: { allowedTables: string[]; allowedActions: string[]; rowCap: number | null; maskPii?: boolean; allowExport?: boolean }
}): RoleFormValues {
  return {
    name: role.name,
    description: role.description ?? '',
    allowedTables: role.config.allowedTables.join(', '),
    allowedActions: role.config.allowedActions,
    rowCap: role.config.rowCap?.toString() ?? '',
    maskPii: role.config.maskPii !== false,
    allowExport: role.config.allowExport === true,
  }
}
