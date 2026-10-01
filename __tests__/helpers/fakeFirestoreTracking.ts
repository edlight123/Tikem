/**
 * Minimal in-memory Firestore stand-in for route/lib tests: collections, docs,
 * equality `where`, `limit`, `add`, merge `set`, dotted-path `update`,
 * `FieldValue.increment` (via the sentinel below) and serial transactions.
 *
 * Pair with:
 *   jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)
 */

type Data = Record<string, any>

const INC = '__fake_increment__'

export const fieldValueModule = {
  FieldValue: {
    increment: (n: number) => ({ [INC]: n }),
    serverTimestamp: () => '__server_ts__',
  },
}

function isInc(v: any): v is Record<string, number> {
  return v && typeof v === 'object' && INC in v
}

function applyValue(current: any, v: any) {
  return isInc(v) ? (Number(current) || 0) + v[INC] : v
}

function applyUpdate(doc: Data, updates: Data): Data {
  const next = JSON.parse(JSON.stringify(doc))
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('.')
    let cursor = next
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {}
      cursor = cursor[parts[i]]
    }
    const leaf = parts[parts.length - 1]
    cursor[leaf] = applyValue(cursor[leaf], value)
  }
  return next
}

function resolveIncrements(data: Data): Data {
  const out: Data = {}
  for (const [k, v] of Object.entries(data)) out[k] = isInc(v) ? v[INC] : v
  return out
}

let autoId = 0
function nextId() {
  autoId += 1
  return `auto${String(autoId).padStart(16, '0')}`
}

export function createFakeFirestore() {
  const store = new Map<string, Map<string, Data>>()
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    return store.get(name)!
  }

  function docRef(collection: string, id: string): any {
    const ref: any = {
      id,
      path: `${collection}/${id}`,
      async get() {
        const data = col(collection).get(id)
        return { id, exists: data !== undefined, data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined), ref }
      },
      async set(data: Data, opts?: { merge?: boolean }) {
        const existing = col(collection).get(id)
        const resolved = resolveIncrements(data)
        col(collection).set(id, opts?.merge && existing ? { ...existing, ...resolved } : resolved)
      },
      async update(data: Data) {
        const existing = col(collection).get(id)
        if (!existing) throw new Error(`No document to update: ${collection}/${id}`)
        col(collection).set(id, applyUpdate(existing, data))
      },
      async delete() {
        col(collection).delete(id)
      },
    }
    return ref
  }

  function query(collection: string, filters: [string, any][], max: number | null): any {
    return {
      where(field: string, _op: string, value: any) {
        return query(collection, [...filters, [field, value]], max)
      },
      orderBy() {
        return query(collection, filters, max)
      },
      limit(n: number) {
        return query(collection, filters, n)
      },
      count() {
        return {
          async get() {
            const all = [...col(collection).values()].filter((d) => filters.every(([f, v]) => d[f] === v))
            return { data: () => ({ count: all.length }) }
          },
        }
      },
      async get() {
        let entries = [...col(collection).entries()].filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        if (max != null) entries = entries.slice(0, max)
        const docs = entries.map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)), ref: docRef(collection, id) }))
        return { empty: docs.length === 0, size: docs.length, docs }
      },
    }
  }

  const db: any = {
    collection(name: string) {
      const q = query(name, [], null)
      return {
        ...q,
        doc: (id?: string) => docRef(name, id || nextId()),
        async add(data: Data) {
          const ref = docRef(name, nextId())
          await ref.set(data)
          return ref
        },
      }
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
      const writes: (() => Promise<void>)[] = []
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Data, opts?: any) => writes.push(() => ref.set(data, opts)),
        update: (ref: any, data: Data) => writes.push(() => ref.update(data)),
        delete: (ref: any) => writes.push(() => ref.delete()),
      }
      const result = await fn(tx)
      for (const w of writes) await w()
      return result
    },
  }

  return {
    db,
    seed(collection: string, id: string, data: Data) {
      col(collection).set(id, JSON.parse(JSON.stringify(data)))
    },
    get(collection: string, id: string): Data | undefined {
      const d = col(collection).get(id)
      return d ? JSON.parse(JSON.stringify(d)) : undefined
    },
    all(collection: string): [string, Data][] {
      return [...col(collection).entries()]
    },
    reset() {
      store.clear()
    },
  }
}
