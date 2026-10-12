/**
 * In-memory Firestore with REAL transaction semantics, for concurrency tests.
 *
 * The other fakes run a transaction's callback straight through, so two
 * "concurrent" transactions can never conflict and a race can never show up.
 * This one is serializable the way Firestore is: every document carries a
 * version, a transaction records the version of everything it read, and at
 * commit time it aborts (ABORTED, code 10) if any of those documents changed
 * underneath it. runTransaction retries an aborted attempt up to `maxAttempts`
 * (Firestore's default is 5) and then throws, exactly like the Admin SDK. Every
 * read yields to the event loop, so Promise.all of many transactions really
 * interleaves.
 *
 * Supports: collection/doc refs (nested subcollections), get/set(merge)/update/
 * delete, where (==, <, <=, >, >=) + limit queries, getAll, and transactions with
 * get/set/update/delete.
 */

type Data = Record<string, any>

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

export interface ConcurrentFirestoreOptions {
  /** Attempts per runTransaction before it throws (Firestore default: 5). */
  maxAttempts?: number
}

export function createConcurrentFirestore(opts: ConcurrentFirestoreOptions = {}) {
  const docs = new Map<string, Data>()
  const versions = new Map<string, number>()
  const stats = { commits: 0, aborts: 0, failedTransactions: 0 }
  let failNext = 0

  const versionOf = (path: string) => versions.get(path) || 0
  const writeDoc = (path: string, data: Data | null) => {
    if (data === null) docs.delete(path)
    else docs.set(path, clone(data))
    versions.set(path, versionOf(path) + 1)
  }
  const snapOf = (path: string, ref: any) => {
    const data = docs.get(path)
    return { id: ref.id, ref, exists: data !== undefined, data: () => (data ? clone(data) : undefined) }
  }
  const merged = (path: string, data: Data, merge?: boolean) =>
    merge ? { ...(docs.get(path) || {}), ...clone(data) } : clone(data)

  function docRef(path: string): any {
    const id = path.split('/').pop() as string
    const ref: any = {
      id,
      path,
      async get() {
        await tick()
        return snapOf(path, ref)
      },
      async set(data: Data, o?: { merge?: boolean }) {
        await tick()
        writeDoc(path, merged(path, data, o?.merge))
      },
      async update(data: Data) {
        await tick()
        if (!docs.has(path)) throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
        writeDoc(path, { ...docs.get(path), ...clone(data) })
      },
      async delete() {
        await tick()
        writeDoc(path, null)
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    }
    return ref
  }

  const matchesOp = (v: any, op: string, value: any) =>
    op === '<=' ? typeof v === 'number' && v <= value
    : op === '<' ? typeof v === 'number' && v < value
    : op === '>=' ? typeof v === 'number' && v >= value
    : op === '>' ? typeof v === 'number' && v > value
    : v === value

  function query(path: string, filters: Array<[string, string, unknown]>, max: number | null): any {
    return {
      where: (field: string, op: string, value: unknown) => query(path, [...filters, [field, op, value]], max),
      orderBy: () => query(path, filters, max),
      limit: (n: number) => query(path, filters, n),
      async get() {
        await tick()
        const depth = path.split('/').length + 1
        let matches = Array.from(docs.keys()).filter(
          (p) => p.startsWith(`${path}/`) && p.split('/').length === depth && filters.every(([f, op, v]) => matchesOp(docs.get(p)?.[f], op, v))
        )
        if (max != null) matches = matches.slice(0, max)
        const out = matches.map((p) => snapOf(p, docRef(p)))
        return { docs: out, empty: out.length === 0, size: out.length }
      },
    }
  }

  function collectionRef(path: string): any {
    let auto = 0
    return {
      ...query(path, [], null),
      doc: (id?: string) => docRef(`${path}/${id || `auto_${Date.now()}_${++auto}`}`),
    }
  }

  const db: any = {
    collection: (name: string) => collectionRef(name),
    async getAll(...refs: any[]) {
      await tick()
      return refs.map((r) => snapOf(r.path, r))
    },
    async runTransaction(fn: (tx: any) => Promise<any>, o?: { maxAttempts?: number }) {
      const attempts = o?.maxAttempts ?? opts.maxAttempts ?? 5
      let lastError: any = null
      for (let attempt = 0; attempt < attempts; attempt++) {
        const reads = new Map<string, number>()
        const writes: Array<[string, Data | null, 'set' | 'merge' | 'update' | 'delete']> = []
        const tx = {
          async get(ref: any) {
            if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.')
            await tick()
            if (!reads.has(ref.path)) reads.set(ref.path, versionOf(ref.path))
            return snapOf(ref.path, ref)
          },
          async getAll(...refs: any[]) {
            return Promise.all(refs.map((r) => tx.get(r)))
          },
          set(ref: any, data: Data, so?: { merge?: boolean }) {
            writes.push([ref.path, data, so?.merge ? 'merge' : 'set'])
            return tx
          },
          update(ref: any, data: Data) {
            writes.push([ref.path, data, 'update'])
            return tx
          },
          delete(ref: any) {
            writes.push([ref.path, null, 'delete'])
            return tx
          },
        }
        // A callback that throws aborts the transaction with nothing written.
        const result = await fn(tx)
        await tick()
        // Commit: atomic (no await between validation and apply).
        if (failNext > 0) {
          failNext -= 1
          stats.aborts += 1
          lastError = Object.assign(new Error('ABORTED: injected failure'), { code: 10 })
          continue
        }
        const conflict = Array.from(reads.entries()).some(([p, v]) => versionOf(p) !== v)
        if (conflict) {
          stats.aborts += 1
          lastError = Object.assign(new Error('ABORTED: Too much contention on these documents.'), { code: 10 })
          continue
        }
        for (const [p, data, kind] of writes) {
          if (kind === 'delete') writeDoc(p, null)
          else if (kind === 'update') {
            if (!docs.has(p)) throw Object.assign(new Error(`NOT_FOUND: ${p}`), { code: 5 })
            writeDoc(p, { ...docs.get(p), ...clone(data as Data) })
          } else writeDoc(p, merged(p, data as Data, kind === 'merge'))
        }
        stats.commits += 1
        return result
      }
      stats.failedTransactions += 1
      throw lastError
    },
  }

  return {
    db,
    stats,
    /** Abort the next `n` transaction commits (simulated contention). */
    failCommits(n: number) {
      failNext = n
    },
    seed(path: string, data: Data) {
      writeDoc(path, data)
    },
    get(path: string): Data | undefined {
      return clone(docs.get(path))
    },
    paths(prefix: string): string[] {
      return Array.from(docs.keys()).filter((p) => p.startsWith(prefix))
    },
    reset() {
      docs.clear()
      versions.clear()
      stats.commits = 0
      stats.aborts = 0
      stats.failedTransactions = 0
      failNext = 0
    },
  }
}
