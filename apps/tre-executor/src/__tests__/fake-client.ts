import type { Client } from 'pg'
export interface FakeClientOptions {
  onQuery?: (sql: string) => { rows: unknown[]; rowCount?: number } | void
  failConnect?: Error
  failQuery?: (sql: string) => Error | void
}

export function createFakeClient(opts: FakeClientOptions = {}): { client: Client; queries: string[] } {
  const queries: string[] = []

  const client = {
    async connect() {
      if (opts.failConnect) throw opts.failConnect
    },
    async query(sql: string) {
      queries.push(sql)
      const failure = opts.failQuery?.(sql)
      if (failure) throw failure
      const response = opts.onQuery?.(sql)
      return { rows: response?.rows ?? [], rowCount: response?.rowCount ?? response?.rows.length ?? 0 }
    },
    async end() {},
  }

  return { client: client as unknown as Client, queries }
}
