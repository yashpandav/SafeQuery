import { randomUUID } from 'node:crypto'

export interface FakeAuditRow {
  id: string
  orgId: string
  actorId: string
  action: string
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  prevHash: string | null
  hash: string
  createdAt: Date
}

export interface FakeAuditDb {
  select: (projection?: unknown) => {
    from: () => ReturnType<FakeAuditDb['select']>
    where: () => ReturnType<FakeAuditDb['select']>
    orderBy: () => ReturnType<FakeAuditDb['select']>
    limit: (n: number) => ReturnType<FakeAuditDb['select']>
    for: (mode: 'update') => Promise<(FakeAuditRow | { hash: string })[]>
    then: (resolve: (value: FakeAuditRow[]) => void) => void
  }
  insert: () => { values: (v: Omit<FakeAuditRow, 'id' | 'createdAt'>) => Promise<void> }
  transaction: <T>(cb: (tx: FakeAuditDb) => Promise<T>) => Promise<T>
}

export function createFakeAuditDb(): { db: FakeAuditDb; rows: FakeAuditRow[] } {
  const rows: FakeAuditRow[] = []

  function selectBuilder(projection?: unknown): ReturnType<FakeAuditDb['select']> {
    let limitN: number | null = null
    const builder: ReturnType<FakeAuditDb['select']> = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: (n: number) => {
        limitN = n
        return builder
      },
      for: async () => {
        const last = rows[rows.length - 1]
        if (!last) return []
        return [projection ? { hash: last.hash } : last]
      },
      then: (resolve: (value: FakeAuditRow[]) => void) => {
        const ordered = [...rows]
        resolve(limitN !== null ? ordered.slice(0, limitN) : ordered)
      },
    }
    return builder
  }

  const db: FakeAuditDb = {
    select: (projection?: unknown) => selectBuilder(projection),
    insert: () => ({
      values: (v: Omit<FakeAuditRow, 'id' | 'createdAt'>) => {
        rows.push({ id: randomUUID(), createdAt: new Date(Date.now() + rows.length), ...v })
        return Promise.resolve()
      },
    }),
    transaction: async <T>(cb: (tx: FakeAuditDb) => Promise<T>) => cb(db),
  }

  return { db, rows }
}
