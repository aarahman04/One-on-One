// Minimal in-memory stand-in for the supabase-js calls the connection /
// message / user services make: enough PostgREST filters, an embedded
// connection_members select, the connections FK cascade, Storage list/remove
// and auth.getUser. Installed onto the real supabaseAdmin object so the
// services under test run unmodified. Not a general PostgREST emulator.
import { randomUUID } from 'node:crypto'

type Row = Record<string, any>
type Filter = (r: Row) => boolean

export interface FakeDb {
  tables: Record<string, Row[]>
  storage: Map<string, Set<string>> // bucket -> object paths
  storageCalls: { op: 'list' | 'remove'; arg: unknown }[]
  authUsers: Map<string, string> // token -> auth user id
}

function parseOr(expr: string): Filter {
  const parts = expr.split(',').map((p) => {
    const [col, op, ...rest] = p.split('.')
    const val = rest.join('.')
    if (op !== 'eq') throw new Error(`fake or(): unsupported op ${op}`)
    return (r: Row) => String(r[col]) === val
  })
  return (r) => parts.some((f) => f(r))
}

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = []
  private op: 'select' | 'update' | 'delete' | 'insert' = 'select'
  private patch: Row | Row[] | null = null
  private embed = false
  private orderBy: { col: string; asc: boolean } | null = null
  private max: number | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'select') this.embed = cols.includes('connection_members(')
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.patch = patch
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.patch = rows
    return this
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v)
    return this
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== null && r[c] !== undefined && r[c] !== v)
    return this
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]))
    return this
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v)
    return this
  }
  gt(c: string, v: string) {
    this.filters.push((r) => r[c] != null && r[c] > v)
    return this
  }
  lt(c: string, v: string) {
    this.filters.push((r) => r[c] != null && r[c] < v)
    return this
  }
  lte(c: string, v: string) {
    this.filters.push((r) => r[c] != null && r[c] <= v)
    return this
  }
  or(expr: string) {
    this.filters.push(parseOr(expr))
    return this
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy = { col, asc: opts.ascending !== false }
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= [])
  }

  private run(): Row[] {
    const all = this.rows()
    const now = new Date().toISOString()
    if (this.op === 'insert') {
      const list = (Array.isArray(this.patch) ? this.patch : [this.patch!]).map((r) => ({
        id: randomUUID(),
        created_at: now,
        updated_at: now,
        ...r,
      }))
      all.push(...list)
      return list
    }
    let hit = all.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'update') {
      for (const r of hit) Object.assign(r, this.patch)
      return hit
    }
    if (this.op === 'delete') {
      this.db.tables[this.table] = all.filter((r) => !hit.includes(r))
      if (this.table === 'connections') {
        // on delete cascade (migrations 003/004)
        const ids = new Set(hit.map((r) => r.id))
        for (const t of ['connection_members', 'messages']) {
          this.db.tables[t] = (this.db.tables[t] ?? []).filter((r) => !ids.has(r.connection_id))
        }
      }
      return hit
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      hit = [...hit].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
    }
    if (this.max !== null) hit = hit.slice(0, this.max)
    if (this.embed) {
      const members = this.db.tables.connection_members ?? []
      hit = hit.map((r) => ({ ...r, connection_members: members.filter((m) => m.connection_id === r.id) }))
    }
    return hit.map((r) => ({ ...r }))
  }

  then<A, B>(ok?: ((v: { data: any; error: any }) => A) | null, fail?: ((e: unknown) => B) | null): PromiseLike<A | B> {
    let result: { data: any; error: any }
    try {
      const rows = this.run()
      if (this.mode === 'many') result = { data: rows, error: null }
      else if (this.mode === 'maybe') result = { data: rows[0] ?? null, error: null }
      else result = rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'not one row' } }
    } catch (err) {
      return Promise.reject(err).then(ok, fail)
    }
    return Promise.resolve(result).then(ok, fail)
  }
}

export function installFakeSupabase(client: any): FakeDb {
  const db: FakeDb = { tables: {}, storage: new Map(), storageCalls: [], authUsers: new Map() }
  client.from = (table: string) => new Query(db, table)
  const bucket = (name: string) => {
    if (!db.storage.has(name)) db.storage.set(name, new Set())
    const objects = db.storage.get(name)!
    return {
      async list(prefix: string, opts: { limit?: number; offset?: number } = {}) {
        db.storageCalls.push({ op: 'list', arg: { prefix, ...opts } })
        const names = [...objects].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1)).sort()
        const offset = opts.offset ?? 0
        return { data: names.slice(offset, offset + (opts.limit ?? 100)).map((name) => ({ name })), error: null }
      },
      async remove(paths: string[]) {
        db.storageCalls.push({ op: 'remove', arg: paths.length })
        for (const p of paths) objects.delete(p)
        return { data: [], error: null }
      },
      async createSignedUrls(paths: string[]) {
        return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null }
      },
    }
  }
  Object.defineProperty(client, 'storage', { value: { from: bucket }, configurable: true })
  client.auth.getUser = async (token: string) => {
    const id = db.authUsers.get(token)
    return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }
  }
  return db
}
