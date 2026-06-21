'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '../components/button'

export interface ConnectionFormValues {
  name: string
  environmentId: string
  host: string
  port: string
  database: string
  username: string
  password: string
  ssl: boolean
}

const EMPTY_VALUES: ConnectionFormValues = {
  name: '',
  environmentId: '',
  host: '',
  port: '5432',
  database: '',
  username: '',
  password: '',
  ssl: false,
}

interface ConnectionFormProps {
  environments: { id: string; name: string }[]
  submitLabel: string
  pending: boolean
  onCancel?: () => void
  onSubmit: (values: {
    name: string
    environmentId: string
    host: string
    port: number
    database: string
    username: string
    password: string
    ssl: boolean
  }) => Promise<void>
}

export function ConnectionForm({ environments, submitLabel, pending, onCancel, onSubmit }: ConnectionFormProps) {
  const [values, setValues] = useState<ConnectionFormValues>({
    ...EMPTY_VALUES,
    environmentId: environments[0]?.id ?? '',
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await onSubmit({
      name: values.name,
      environmentId: values.environmentId,
      host: values.host,
      port: Number(values.port),
      database: values.database,
      username: values.username,
      password: values.password,
      ssl: values.ssl,
    })
  }

  return (
    <form onSubmit={handleSubmit} aria-label={submitLabel} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="conn-name" className="text-sm text-muted">
            Name
          </label>
          <input
            id="conn-name"
            type="text"
            required
            aria-required="true"
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="conn-env" className="text-sm text-muted">
            Environment
          </label>
          <select
            id="conn-env"
            required
            aria-required="true"
            value={values.environmentId}
            onChange={(e) => setValues((v) => ({ ...v, environmentId: e.target.value }))}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          >
            <option value="" disabled>
              Select an environment
            </option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="conn-host" className="text-sm text-muted">
            Host
          </label>
          <input
            id="conn-host"
            type="text"
            required
            aria-required="true"
            value={values.host}
            onChange={(e) => setValues((v) => ({ ...v, host: e.target.value }))}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="conn-port" className="text-sm text-muted">
            Port
          </label>
          <input
            id="conn-port"
            type="number"
            min={1}
            max={65535}
            required
            aria-required="true"
            value={values.port}
            onChange={(e) => setValues((v) => ({ ...v, port: e.target.value }))}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="conn-database" className="text-sm text-muted">
          Database
        </label>
        <input
          id="conn-database"
          type="text"
          required
          aria-required="true"
          value={values.database}
          onChange={(e) => setValues((v) => ({ ...v, database: e.target.value }))}
          className="rounded-lg border border-border bg-transparent px-3 py-2"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="conn-username" className="text-sm text-muted">
            Username
          </label>
          <input
            id="conn-username"
            type="text"
            required
            aria-required="true"
            value={values.username}
            onChange={(e) => setValues((v) => ({ ...v, username: e.target.value }))}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="conn-password" className="text-sm text-muted">
            Password
          </label>
          <input
            id="conn-password"
            type="password"
            required
            aria-required="true"
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            className="rounded-lg border border-border bg-transparent px-3 py-2"
          />
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={values.ssl} onChange={(e) => setValues((v) => ({ ...v, ssl: e.target.checked }))} />
        Require SSL
      </label>
      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={pending || !values.environmentId}>
          {pending ? 'Testing connection…' : submitLabel}
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
