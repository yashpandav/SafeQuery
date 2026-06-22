import { randomUUID } from 'crypto'
import { customRoles, environments, queryLogs, approvalRequests, policies, invitations } from '@repo/db/schema'

export interface MockDbFixtures {
  organizationMembers?: unknown
  customRoles?: unknown
  databaseConnections?: unknown
  environments?: unknown
  schemaSnapshots?: unknown
  approvalRequests?: unknown
  queryLogs?: unknown
  policies?: unknown
  invitations?: unknown
  approvalRequestsList?: unknown[]
  queryLogsList?: unknown[]
  organizationMembersList?: unknown[]
  organizationsList?: unknown[]
  auditLogsList?: unknown[]
  usersList?: unknown[]
  customRolesList?: unknown[]
  environmentsList?: unknown[]
  invitationsList?: unknown[]
}

export function createMockDb(fixtures: MockDbFixtures) {
  const insertedByTable = new Map<unknown, Record<string, unknown>[]>()
  const updatedByTable = new Map<unknown, Record<string, unknown>[]>()
  const deletedByTable = new Map<unknown, unknown[]>()

  function chainableSelect() {
    const builder = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      for: () => Promise.resolve([] as { hash: string }[]),
    }
    return builder
  }

  function chainableInsert(table: unknown) {
    let row: Record<string, unknown> = {}
    const builder = {
      values: (v: Record<string, unknown>) => {
        row = { id: randomUUID(), createdAt: new Date(), ...v }
        const list = insertedByTable.get(table) ?? []
        list.push(row)
        insertedByTable.set(table, list)
        return builder
      },
      returning: () => Promise.resolve([row]),
    }
    return builder
  }

  // Falls back to the relevant findFirst-style fixture when a test calls update() without first
  // having inserted a row for this table (e.g. update-after-findFirst, as opposed to the
  // insert-then-update pattern the rest of this mock was originally built around).
  function fallbackRowFor(table: unknown): Record<string, unknown> | undefined {
    if (table === customRoles) return fixtures.customRoles as Record<string, unknown> | undefined
    if (table === environments) return fixtures.environments as Record<string, unknown> | undefined
    if (table === queryLogs) return fixtures.queryLogs as Record<string, unknown> | undefined
    if (table === approvalRequests) return fixtures.approvalRequests as Record<string, unknown> | undefined
    if (table === policies) return fixtures.policies as Record<string, unknown> | undefined
    if (table === invitations) return fixtures.invitations as Record<string, unknown> | undefined
    return undefined
  }

  function chainableUpdate(table: unknown) {
    const builder = {
      set: (data: Record<string, unknown>) => {
        const list = insertedByTable.get(table)
        const last = list?.[list.length - 1]
        if (last) {
          Object.assign(last, data)
        } else {
          const base = fallbackRowFor(table)
          if (base) {
            const seeded = insertedByTable.get(table) ?? []
            seeded.push({ ...base, ...data })
            insertedByTable.set(table, seeded)
          }
        }
        const updates = updatedByTable.get(table) ?? []
        updates.push(data)
        updatedByTable.set(table, updates)
        return builder
      },
      where: () => whereResult,
    }
    const whereResult = {
      returning: () => Promise.resolve(insertedByTable.get(table)?.slice(-1) ?? []),
      then: (resolve: (value: undefined) => void) => resolve(undefined),
    }
    return builder
  }

  function chainableDelete(table: unknown) {
    const builder = {
      where: () => {
        const list = deletedByTable.get(table) ?? []
        list.push({})
        deletedByTable.set(table, list)
        return Promise.resolve()
      },
    }
    return builder
  }

  interface MockDb {
    query: {
      organizationMembers: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      organizations: { findMany: () => Promise<unknown[]> }
      customRoles: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      databaseConnections: { findFirst: () => Promise<unknown> }
      environments: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      schemaSnapshots: { findFirst: () => Promise<unknown> }
      approvalRequests: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      queryLogs: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      policies: { findFirst: () => Promise<unknown> }
      invitations: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      auditLogs: { findMany: () => Promise<unknown[]> }
      users: { findMany: () => Promise<unknown[]> }
    }
    select: () => ReturnType<typeof chainableSelect>
    insert: (table: unknown) => ReturnType<typeof chainableInsert>
    update: (table: unknown) => ReturnType<typeof chainableUpdate>
    delete: (table: unknown) => ReturnType<typeof chainableDelete>
    transaction: <T>(cb: (tx: MockDb) => Promise<T>) => Promise<T>
  }

  const db: MockDb = {
    query: {
      organizationMembers: {
        findFirst: async () => fixtures.organizationMembers ?? null,
        findMany: async () => fixtures.organizationMembersList ?? [],
      },
      organizations: {
        findMany: async () => fixtures.organizationsList ?? [],
      },
      customRoles: {
        findFirst: async () => fixtures.customRoles ?? null,
        findMany: async () => fixtures.customRolesList ?? [],
      },
      databaseConnections: { findFirst: async () => fixtures.databaseConnections ?? null },
      environments: {
        findFirst: async () => fixtures.environments ?? null,
        findMany: async () => fixtures.environmentsList ?? [],
      },
      schemaSnapshots: { findFirst: async () => fixtures.schemaSnapshots ?? null },
      approvalRequests: {
        findFirst: async () => fixtures.approvalRequests ?? null,
        findMany: async () => fixtures.approvalRequestsList ?? [],
      },
      queryLogs: {
        findFirst: async () => fixtures.queryLogs ?? null,
        findMany: async () => fixtures.queryLogsList ?? [],
      },
      policies: { findFirst: async () => fixtures.policies ?? null },
      invitations: {
        findFirst: async () => fixtures.invitations ?? null,
        findMany: async () => fixtures.invitationsList ?? [],
      },
      auditLogs: { findMany: async () => fixtures.auditLogsList ?? [] },
      users: { findMany: async () => fixtures.usersList ?? [] },
    },
    select: () => chainableSelect(),
    insert: (table: unknown) => chainableInsert(table),
    update: (table: unknown) => chainableUpdate(table),
    delete: (table: unknown) => chainableDelete(table),
    transaction: async (cb) => cb(db),
  }

  return { db, insertedByTable, updatedByTable, deletedByTable }
}
