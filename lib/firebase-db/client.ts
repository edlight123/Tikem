// Firebase client database wrapper
// Provides a familiar API for client-side database operations

import { db, auth, storage } from '../firebase/client'
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  QueryConstraint,
  Timestamp,
  documentId,
} from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'

class FirebaseQueryBuilder {
  private collectionName: string
  private constraints: QueryConstraint[] = []
  private selectFields: string = '*'
  private singleDoc = false
  private pendingInsert: any = null
  private pendingUpdate: any = null
  private pendingDelete: boolean = false
  private pendingUpsert: any = null

  constructor(tableName: string) {
    this.collectionName = tableName
  }

  select(fields: string = '*'): this {
    this.selectFields = fields
    return this
  }

  eq(field: string, value: any): this {
    // `id` means the document ID: docs made with addDoc (every app-made
    // event) have no `id` field, so where('id', ...) matched nothing and an
    // update through .eq('id', x) saved nowhere while reporting success.
    this.constraints.push(where(field === 'id' ? documentId() : field, '==', value))
    return this
  }

  neq(field: string, value: any): this {
    this.constraints.push(where(field, '!=', value))
    return this
  }

  gt(field: string, value: any): this {
    this.constraints.push(where(field, '>', value))
    return this
  }

  gte(field: string, value: any): this {
    this.constraints.push(where(field, '>=', value))
    return this
  }

  lt(field: string, value: any): this {
    this.constraints.push(where(field, '<', value))
    return this
  }

  lte(field: string, value: any): this {
    this.constraints.push(where(field, '<=', value))
    return this
  }

  is(field: string, value: null): this {
    this.constraints.push(where(field, '==', null))
    return this
  }

  in(field: string, values: any[]): this {
    this.constraints.push(where(field, 'in', values))
    return this
  }

  contains(field: string, value: any): this {
    this.constraints.push(where(field, 'array-contains', value))
    return this
  }

  order(field: string, options?: { ascending?: boolean }): this {
    const direction = options?.ascending === false ? 'desc' : 'asc'
    this.constraints.push(orderBy(field, direction))
    return this
  }

  limit(count: number): this {
    this.constraints.push(firestoreLimit(count))
    return this
  }

  single(): this {
    this.singleDoc = true
    return this
  }

  insert(data: any | any[]): FirebaseQueryBuilder {
    const builder = new FirebaseQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['selectFields'] = this.selectFields
    builder['pendingInsert'] = data
    return builder
  }

  upsert(data: any | any[]): FirebaseQueryBuilder {
    const builder = new FirebaseQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['selectFields'] = this.selectFields
    builder['pendingUpsert'] = data
    return builder
  }

  update(data: any): FirebaseQueryBuilder {
    const builder = new FirebaseQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['selectFields'] = this.selectFields
    builder['pendingUpdate'] = data
    return builder
  }

  delete(): FirebaseQueryBuilder {
    const builder = new FirebaseQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['pendingDelete'] = true
    return builder
  }

  private async execute() {
    try {
      // Handle pending upsert
      if (this.pendingUpsert !== null) {
        const dataArray = Array.isArray(this.pendingUpsert) ? this.pendingUpsert : [this.pendingUpsert]
        const results = []

        for (const item of dataArray) {
          const id = item.id || this.generateId()
          const docData = {
            ...item,
            id,
            created_at: item.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }

          await setDoc(doc(db, this.collectionName, id), docData, { merge: true })
          results.push(docData)
        }

        return { 
          data: Array.isArray(this.pendingUpsert) ? results : results[0], 
          error: null 
        }
      }

      // Handle pending delete
      if (this.pendingDelete) {
        const { data: docs, error } = await this.fetchData()
        if (error || !docs) throw error

        const docsArray = Array.isArray(docs) ? docs : [docs]
        for (const document of docsArray) {
          await deleteDoc(doc(db, this.collectionName, document.id))
        }
        return { error: null }
      }

      // Handle pending update
      if (this.pendingUpdate !== null) {
        const { data: docs, error } = await this.fetchData()
        if (error || !docs) throw error

        const docsArray = Array.isArray(docs) ? docs : [docs]
        const updateData = {
          ...this.pendingUpdate,
          updated_at: new Date().toISOString(),
        }

        for (const document of docsArray) {
          await updateDoc(doc(db, this.collectionName, document.id), updateData)
        }

        return { data: docsArray.map((d: any) => ({ ...d, ...updateData })), error: null }
      }

      // Handle pending insert
      if (this.pendingInsert !== null) {
        const dataArray = Array.isArray(this.pendingInsert) ? this.pendingInsert : [this.pendingInsert]
        const results = []

        for (const item of dataArray) {
          const id = this.generateId()
          const docData = {
            ...item,
            id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }

          console.log('Inserting document:', { collection: this.collectionName, id, docData })
          await setDoc(doc(db, this.collectionName, id), docData)
          console.log('Document inserted successfully:', id)
          results.push(docData)
        }

        return { 
          data: Array.isArray(this.pendingInsert) ? results : results[0], 
          error: null 
        }
      }

      // Normal select query
      return await this.fetchData()
    } catch (error: any) {
      return { data: null, error }
    }
  }

  private async fetchData() {
    try {
      const collectionRef = collection(db, this.collectionName)

      if (this.constraints.length === 0) {
        const snapshot = await getDocs(collectionRef)
        const docs = snapshot.docs.map((doc: any) => ({
          id: doc.id,
          ...doc.data()
        }))
        
        if (this.singleDoc) {
          return { data: docs[0] || null, error: null }
        }
        
        return { data: docs, error: null }
      }

      const q = query(collectionRef, ...this.constraints)
      const snapshot = await getDocs(q)
      
      const docs = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }))

      if (this.singleDoc) {
        return { data: docs[0] || null, error: null }
      }

      return { data: docs, error: null }
    } catch (error: any) {
      return { data: null, error }
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<any | TResult> {
    return this.execute().then(undefined, onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<any> {
    return this.execute().then(
      value => {
        if (onfinally) onfinally()
        return value
      },
      reason => {
        if (onfinally) onfinally()
        throw reason
      }
    )
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

export const firebaseDb = {
  from: (table: string) => new FirebaseQueryBuilder(table),
  
  auth: {
    getUser: async () => {
      const user = auth.currentUser
      if (!user) {
        return { data: { user: null }, error: null }
      }
      
      return {
        data: {
          user: {
            id: user.uid,
            email: user.email,
            user_metadata: {
              full_name: user.displayName,
            }
          }
        },
        error: null
      }
    },
    
    signOut: async () => {
      try {
        await signOut(auth)
        // Clear session cookie
        await fetch('/api/auth/session', { method: 'DELETE' })
        return { error: null }
      } catch (error: any) {
        return { error }
      }
    }
  },

  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: File, options?: any) => {
        try {
          const storageRef = ref(storage, path)
          console.log('Uploading to Firebase Storage:', path)
          const snapshot = await uploadBytes(storageRef, file, options)
          const downloadURL = await getDownloadURL(snapshot.ref)
          console.log('Upload complete, download URL:', downloadURL)
          
          return { 
            data: { 
              path: snapshot.ref.fullPath,
              fullPath: snapshot.ref.fullPath,
              publicUrl: downloadURL
            }, 
            error: null 
          }
        } catch (error: any) {
          console.error('Firebase Storage upload error:', error)
          return { data: null, error }
        }
      },
      getPublicUrl: async (path: string) => {
        try {
          const storageRef = ref(storage, path)
          const downloadURL = await getDownloadURL(storageRef)
          return { data: { publicUrl: downloadURL } }
        } catch (error: any) {
          console.error('Error getting download URL:', error)
          return { data: { publicUrl: '' } }
        }
      },
      remove: async (paths: string[]) => {
        try {
          await Promise.all(
            paths.map(async (path) => {
              const storageRef = ref(storage, path)
              await deleteObject(storageRef)
            })
          )
          return { data: null, error: null }
        } catch (error: any) {
          return { data: null, error }
        }
      }
    })
  }
}
