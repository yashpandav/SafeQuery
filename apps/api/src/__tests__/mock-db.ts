import { randomUUID } from 'crypto'
export interface MockDbFixtures {
  organizationMembers?: unknown
  customRoles?: unknown
  databaseConnections?: unknown
  environments?: unknown
  schemaSnapshots?: unknown
  approvalRequests?: unknown
  queryLogs?: unknown
  approvalRequestsList?: unknown[]
  queryLogsList?: unknown[]
  organizationMembersList?: unknown[]
  organizationsList?: unknown[]
}

export function createMockDb(fixtures: MockDbFixtures) {
  const insertedByTable = new Map<unknown, Record<string, unknown>[]>()
  const updatedByTable = new Map<unknown, Record<string, unknown>[]>()

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
  function chainableUpdate(table: unknown) {
    const builder = {
      set: (data: Record<string, unknown>) => {
        const list = insertedByTable.get(table)
        const last = list?.[list.length - 1]
        if (last) Object.assign(last, data)
        const updates = updatedByTable.get(table) ?? []
        updates.push(data)
        updatedByTable.set(table, updates)
        return builder
      },
      where: () => Promise.resolve(),
    }
    return builder
  }

  interface MockDb {
    query: {
      organizationMembers: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      organizations: { findMany: () => Promise<unknown[]> }
      customRoles: { findFirst: () => Promise<unknown> }
      databaseConnections: { findFirst: () => Promise<unknown> }
      environments: { findFirst: () => Promise<unknown> }
      schemaSnapshots: { findFirst: () => Promise<unknown> }
      approvalRequests: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
      queryLogs: { findFirst: () => Promise<unknown>; findMany: () => Promise<unknown[]> }
    }
    select: () => ReturnType<typeof chainableSelect>
    insert: (table: unknown) => ReturnType<typeof chainableInsert>
    update: (table: unknown) => ReturnType<typeof chainableUpdate>
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
      customRoles: { findFirst: async () => fixtures.customRoles ?? null },
      databaseConnections: { findFirst: async () => fixtures.databaseConnections ?? null },
      environments: { findFirst: async () => fixtures.environments ?? null },
      schemaSnapshots: { findFirst: async () => fixtures.schemaSnapshots ?? null },
      approvalRequests: {
        findFirst: async () => fixtures.approvalRequests ?? null,
        findMany: async () => fixtures.approvalRequestsList ?? [],
      },
      queryLogs: {
        findFirst: async () => fixtures.queryLogs ?? null,
        findMany: async () => fixtures.queryLogsList ?? [],
      },
    },
    select: () => chainableSelect(),
    insert: (table: unknown) => chainableInsert(table),
    update: (table: unknown) => chainableUpdate(table),
    transaction: async (cb) => cb(db),
  }

  return { db, insertedByTable, updatedByTable }
}
