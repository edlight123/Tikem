/** In-memory Firestore for refund tests: refs, merge writes, where(==), transactions and batches. */
export type Doc = Record<string, any>

export class FakeFirestore {
  store = new Map<string, Doc>()
  private autoId = 0

  ref(path: string): any {
    const self = this
    const id = path.split('/').pop() as string
    return {
      id,
      _path: path,
      get: async () => self.snap(path),
      set: async (data: Doc, opts?: { merge?: boolean }) => self.write(path, data, opts),
      collection: (name: string) => self.collection(`${path}/${name}`),
    }
  }

  snap(path: string) {
    const data = this.store.get(path)
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data ? { ...data } : undefined), ref: this.ref(path) }
  }

  write(path: string, data: Doc, opts?: { merge?: boolean }) {
    const prev = opts?.merge ? this.store.get(path) || {} : {}
    this.store.set(path, { ...prev, ...data })
  }

  collection(name: string): any {
    const self = this
    return {
      doc: (id: string) => self.ref(`${name}/${id}`),
      add: async (data: Doc) => {
        const ref = self.ref(`${name}/auto_${++self.autoId}`)
        self.write(ref._path, data)
        return ref
      },
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: Array.from(self.store.entries())
            .filter(([p, d]) => p.startsWith(`${name}/`) && p.split('/').length === name.split('/').length + 1 && d[field] === value)
            .map(([p]) => self.snap(p)),
        }),
      }),
    }
  }

  docsIn(name: string): [string, Doc][] {
    return Array.from(this.store.entries()).filter(
      ([p]) => p.startsWith(`${name}/`) && p.split('/').length === name.split('/').length + 1
    )
  }

  async runTransaction(fn: (tx: any) => Promise<any>) {
    const writes: [string, Doc, any][] = []
    const tx = {
      get: async (ref: any) => this.snap(ref._path),
      set: (ref: any, data: Doc, opts?: any) => writes.push([ref._path, data, opts]),
    }
    const result = await fn(tx)
    for (const [p, d, o] of writes) this.write(p, d, o)
    return result
  }

  batch() {
    const writes: [string, Doc, any][] = []
    return {
      set: (ref: any, data: Doc, opts?: any) => writes.push([ref._path, data, opts]),
      commit: async () => {
        for (const [p, d, o] of writes) this.write(p, d, o)
      },
    }
  }
}
