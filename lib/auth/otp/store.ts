/**
 * Storage for pending codes and rate-limit counters.
 *
 * The service only needs "read a few docs and write a few, atomically", so it
 * talks to this narrow interface. Production uses a Firestore transaction;
 * tests use the in-memory store below, which serialises transactions so the
 * same race guarantees hold.
 *
 * Collections (both server-only; firestore.rules denies every client):
 *   phone_otp       one pending code per (purpose, account, number)
 *   phone_otp_rate  fixed-window counters per phone, per IP and global
 */

export const OTP_COLLECTION = 'phone_otp'
export const RATE_COLLECTION = 'phone_otp_rate'

export type Doc = Record<string, any>

export interface OtpTx {
  get(collection: string, id: string): Promise<Doc | null>
  set(collection: string, id: string, data: Doc): void
  delete(collection: string, id: string): void
}

export interface OtpStore {
  transact<T>(fn: (tx: OtpTx) => Promise<T>): Promise<T>
  /** A single write outside a transaction (best-effort clean-ups). */
  patch(collection: string, id: string, data: Doc): Promise<void>
}

/** Firestore-backed store (firebase-admin). */
export function firestoreOtpStore(db: any): OtpStore {
  return {
    async transact(fn) {
      return db.runTransaction(async (t: any) => {
        // Firestore requires every read before any write, so writes are
        // buffered and applied once the callback has finished reading.
        const writes: Array<() => void> = []
        const tx: OtpTx = {
          async get(collection, id) {
            const snap = await t.get(db.collection(collection).doc(id))
            return snap.exists ? (snap.data() as Doc) : null
          },
          set(collection, id, data) {
            writes.push(() => t.set(db.collection(collection).doc(id), data))
          },
          delete(collection, id) {
            writes.push(() => t.delete(db.collection(collection).doc(id)))
          },
        }
        const result = await fn(tx)
        for (const w of writes) w()
        return result
      })
    },
    async patch(collection, id, data) {
      await db.collection(collection).doc(id).set(data, { merge: true })
    },
  }
}

/** In-memory store for tests and local experiments. */
export function memoryOtpStore() {
  const data = new Map<string, Doc>()
  let chain: Promise<unknown> = Promise.resolve()
  const key = (c: string, id: string) => `${c}/${id}`

  const store: OtpStore & { data: Map<string, Doc> } = {
    data,
    transact<T>(fn: (tx: OtpTx) => Promise<T>): Promise<T> {
      const run = async () => {
        const writes: Array<() => void> = []
        const tx: OtpTx = {
          async get(c, id) {
            const d = data.get(key(c, id))
            return d ? JSON.parse(JSON.stringify(d)) : null
          },
          set(c, id, d) {
            writes.push(() => data.set(key(c, id), JSON.parse(JSON.stringify(d))))
          },
          delete(c, id) {
            writes.push(() => data.delete(key(c, id)))
          },
        }
        const result = await fn(tx)
        for (const w of writes) w()
        return result
      }
      const p = chain.then(run, run)
      chain = p.catch(() => {})
      return p
    },
    async patch(c, id, d) {
      data.set(key(c, id), { ...(data.get(key(c, id)) || {}), ...d })
    },
  }
  return store
}
