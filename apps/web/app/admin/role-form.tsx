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
  columnRestrictions: Record<string, string>
  rowFilters: Record<string, string>
}

const EMPTY_VALUES: RoleFormValues = {
  name: '',
  description: '',
  allowedTables: '',
  allowedActions: ['SELECT'],
  rowCap: '',
  maskPii: true,
  allowExport: false,
  columnRestrictions: {},
  rowFilters: {},
}

interface RoleFormProps {
  initial?: RoleFormValues
  submitLabel: string
  onSubmit: (values: {
    name: string
    description: string | null
    allowedTables: string[]
    allowedColumns: Record<string, string[]>
    allowedActions: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[]
    rowFilters: Record<string, string>
    rowCap: number | null
    maskPii: boolean
    allowExport: boolean
  }) => Promise<void>
  onCancel?: () => void
  pending: boolean
}

export function RoleForm({ initial, submitLabel, onSubmit, onCancel, pending }: RoleFormProps) {
  const [values, setValues] = useState<RoleFormValues>(initial ?? EMPTY_VALUES)

  const parsedTables = values.allowedTables
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  function toggleAction(action: string) {
    setValues((v) => ({
      ...v,
      allowedActions: v.allowedActions.includes(action)
        ? v.allowedActions.filter((a) => a !== action)
        : [...v.allowedActions, action],
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const allowedColumns: Record<string, string[]> = {}
    for (const table of parsedTables) {
      const cols = (values.columnRestrictions[table] ?? '').split(',').map((c) => c.trim()).filter(Boolean)
      if (cols.length > 0) allowedColumns[table] = cols
    }

    const rowFilters: Record<string, string> = {}
    for (const table of parsedTables) {
      const filter = (values.rowFilters[table] ?? '').trim()
      if (filter) rowFilters[table] = filter
    }

    await onSubmit({
      name: values.name,
      description: values.description.trim() ? values.description.trim() : null,
      allowedTables: parsedTables,
      allowedColumns,
      allowedActions: values.allowedActions as ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[],
      rowFilters,
      rowCap: values.rowCap.trim() ? Number(values.rowCap) : null,
      maskPii: values.maskPii,
      allowExport: values.allowExport,
    })
  }

  return (
    <form onSubmit={handleSubmit} aria-label={submitLabel} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="role-name" className="text-sm text-muted">Name</label>
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
        <label htmlFor="role-description" className="text-sm text-muted">Description (optional)</label>
        <input
          id="role-description"
          type="text"
          value={values.description}
          onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
          className="rounded-lg border border-border bg-transparent px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="role-tables" className="text-sm text-muted">Allowed tables (comma-separated)</label>
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

      {parsedTables.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted">Per-table access control</p>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              Column restrictions — comma-separated list of allowed columns per table. Leave blank to allow all columns.
            </p>
            {parsedTables.map((table) => (
              <div key={`col-${table}`} className="grid grid-cols-[8rem_1fr] items-center gap-2">
                <span className="truncate font-mono text-xs text-ink">{table}</span>
                <input
                  type="text"
                  placeholder="id, name, email (blank = all)"
                  value={values.columnRestrictions[table] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      columnRestrictions: { ...v.columnRestrictions, [table]: e.target.value },
                    }))
                  }
                  className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              Row filters — SQL WHERE predicate injected at query time. Leave blank for no row restriction.
            </p>
            {parsedTables.map((table) => (
              <div key={`rf-${table}`} className="grid grid-cols-[8rem_1fr] items-center gap-2">
                <span className="truncate font-mono text-xs text-ink">{table}</span>
                <input
                  type="text"
                  placeholder="e.g. org_id = 'abc' (blank = all rows)"
                  value={values.rowFilters[table] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      rowFilters: { ...v.rowFilters, [table]: e.target.value },
                    }))
                  }
                  className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}

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
        <label htmlFor="role-row-cap" className="text-sm text-muted">Row cap (optional)</label>
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
  config: {
    allowedTables: string[]
    allowedColumns?: Record<string, string[]>
    allowedActions: string[]
    rowFilters?: Record<string, string>
    rowCap: number | null
    maskPii?: boolean
    allowExport?: boolean
  }
}): RoleFormValues {
  const columnRestrictions: Record<string, string> = {}
  for (const [table, cols] of Object.entries(role.config.allowedColumns ?? {})) {
    columnRestrictions[table] = cols.join(', ')
  }
  return {
    name: role.name,
    description: role.description ?? '',
    allowedTables: role.config.allowedTables.join(', '),
    allowedActions: role.config.allowedActions,
    rowCap: role.config.rowCap?.toString() ?? '',
    maskPii: role.config.maskPii !== false,
    allowExport: role.config.allowExport === true,
    columnRestrictions,
    rowFilters: { ...(role.config.rowFilters ?? {}) },
  }
}
