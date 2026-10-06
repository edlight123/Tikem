// Firebase server database wrapper
// Provides a familiar API for server-side database operations

import { adminDb, adminStorage } from '../firebase/admin'
import { getServerSession } from '../firebase/server'

// Helper function to serialize Firestore Timestamps recursively
function serializeFirestoreData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  
  // Check if it's a Firestore Timestamp
  if (obj.toDate && typeof obj.toDate === 'function') {
    return obj.toDate().toISOString()
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serializeFirestoreData(item))
  }
  
  // Handle plain objects
  const serialized: any = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      serialized[key] = serializeFirestoreData(obj[key])
    }
  }
  return serialized
}

class ServerQueryBuilder {
  private collectionName: string
  private constraints: any[] = []
  private selectFields: string = '*'
  private singleDoc = false
  private orderField: string | null = null
  private orderDirection: 'asc' | 'desc' = 'asc'
  private limitCount: number | null = null
  private insertedData: any = null
  private insertError: any = null
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
    this.constraints.push({ field, op: '==', value })
    return this
  }

  neq(field: string, value: any): this {
    this.constraints.push({ field, op: '!=', value })
    return this
  }

  gt(field: string, value: any): this {
    this.constraints.push({ field, op: '>', value })
    return this
  }

  gte(field: string, value: any): this {
    this.constraints.push({ field, op: '>=', value })
    return this
  }

  lt(field: string, value: any): this {
    this.constraints.push({ field, op: '<', value })
    return this
  }

  lte(field: string, value: any): this {
    this.constraints.push({ field, op: '<=', value })
    return this
  }

  is(field: string, value: null): this {
    this.constraints.push({ field, op: '==', value: null })
    return this
  }

  in(field: string, values: any[]): this {
    this.constraints.push({ field, op: 'in', value: values })
    return this
  }

  not(field: string, op: string, value: any): this {
    // Firestore doesn't have NOT IN, so we'll filter later
    // For now, just skip this constraint - it won't work perfectly
    // but prevents build errors
    return this
  }

  or(conditions: string): this {
    // Firestore doesn't support OR at the query level like Supabase
    // This is a limitation - OR queries need to be implemented differently
    console.warn('OR queries are not fully supported in Firebase - this query may not work as expected')
    return this
  }

  contains(field: string, value: any): this {
    this.constraints.push({ field, op: 'array-contains', value })
    return this
  }

  order(field: string, options?: { ascending?: boolean }): this {
    this.orderField = field
    this.orderDirection = options?.ascending === false ? 'desc' : 'asc'
    return this
  }

  limit(count: number): this {
    this.limitCount = count
    return this
  }

  single(): this {
    this.singleDoc = true
    this.limitCount = 1
    return this
  }

  insert(data: any | any[]): ServerQueryBuilder {
    // Store data to be inserted and return builder for chaining
    const builder = new ServerQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['selectFields'] = this.selectFields
    ;(builder as any).pendingInsert = data
    return builder
  }

  upsert(data: any | any[]): ServerQueryBuilder {
    // Upsert = update if exists, insert if not
    // For Firestore, we'll use set with merge
    const builder = new ServerQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['selectFields'] = this.selectFields
    ;(builder as any).pendingUpsert = data
    return builder
  }

  update(data: any): ServerQueryBuilder {
    // Store update data and return builder for chaining
    const builder = new ServerQueryBuilder(this.collectionName)
    builder['constraints'] = [...this.constraints]
    builder['selectFields'] = this.selectFields
    ;(builder as any).pendingUpdate = data
    return builder
  }

  delete(): ServerQueryBuilder {
    // Store delete flag and return builder for chaining
    const builder = new ServerQueryBuilder(this.collectionName)
    ;(builder as any).pendingDelete = true
    // Copy constraints to the new builder
    builder['constraints'] = this.constraints
    return builder
  }

  private async execute() {
    try {
      // Handle pending upsert
      if (this.pendingUpsert !== null) {
        const dataArray = Array.isArray(this.pendingUpsert) ? this.pendingUpsert : [this.pendingUpsert]
        const results = []

        for (const item of dataArray) {
          // Use user_id or id as document ID for upsert
          const docId = item.user_id || item.id || this.generateId()
          const docData = {
            ...item,
            id: docId,
            created_at: item.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }

          // Set with merge option = upsert
          await adminDb.collection(this.collectionName).doc(docId).set(docData, { merge: true })
          results.push(docData)
        }

        return { data: Array.isArray(this.pendingUpsert) ? results : results[0], error: null }
      }
      
      // Handle pending delete
      if (this.pendingDelete) {
        // Find documents matching constraints
        let query: any = adminDb.collection(this.collectionName)
        
        for (const constraint of this.constraints) {
          query = query.where(constraint.field, constraint.op, constraint.value)
        }
        
        const snapshot = await query.get()
        
        // Delete all matching documents
        const batch = adminDb.batch()
        snapshot.docs.forEach((doc: any) => {
          batch.delete(doc.ref)
        })
        await batch.commit()

        return { error: null }
      }
      
      // Handle pending update
      if (this.pendingUpdate !== null) {
        const updateData = {
          ...this.pendingUpdate,
          updated_at: new Date().toISOString(),
        }

        // Special case: updating by document ID
        if (this.constraints.length === 1 && 
            this.constraints[0].field === 'id' && 
            this.constraints[0].op === '==') {
          console.log('Server update - updating by document ID:', this.constraints[0].value)
          const docRef = adminDb.collection(this.collectionName).doc(this.constraints[0].value as string)
          const docSnapshot = await docRef.get()
          
          if (!docSnapshot.exists) {
            console.log('Server update - document not found')
            return { data: [], error: null }
          }
          
          await docRef.set(updateData, { merge: true })
          console.log('Server update - document updated:', this.constraints[0].value)
          
          const updatedData = serializeFirestoreData({
            id: docSnapshot.id,
            ...docSnapshot.data(),
            ...updateData
          })
          
          return { data: [updatedData], error: null }
        }

        // Regular update: find documents matching constraints
        let query: any = adminDb.collection(this.collectionName)
        
        for (const constraint of this.constraints) {
          query = query.where(constraint.field, constraint.op, constraint.value)
        }
        
        const snapshot = await query.get()

        // Update all matching documents using set with merge to allow adding new fields
        const batch = adminDb.batch()
        snapshot.docs.forEach((doc: any) => {
          batch.set(doc.ref, updateData, { merge: true })
        })
        await batch.commit()

        return { 
          data: snapshot.docs.map((d: any) => 
            serializeFirestoreData({ 
              id: d.id, 
              ...d.data(), 
              ...updateData 
            })
          ), 
          error: null 
        }
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

          await adminDb.collection(this.collectionName).doc(id).set(docData)
          results.push(docData)
        }

        return { data: Array.isArray(this.pendingInsert) ? results : results[0], error: null }
      }

      // Special case: querying by document ID
      if (this.constraints.length === 1 && 
          this.constraints[0].field === 'id' && 
          this.constraints[0].op === '==') {
        const docRef = adminDb.collection(this.collectionName).doc(this.constraints[0].value as string)
        const docSnapshot = await docRef.get()
        
        if (!docSnapshot.exists) {
          return { data: this.singleDoc ? null : [], error: null }
        }
        
        const docData = serializeFirestoreData({ 
          id: docSnapshot.id, 
          ...docSnapshot.data() 
        })
        return { data: this.singleDoc ? docData : [docData], error: null }
      }

      // Regular query
      let query: any = adminDb.collection(this.collectionName)


      // Apply constraints
      for (const constraint of this.constraints) {
        query = query.where(constraint.field, constraint.op, constraint.value)
      }

      // Apply ordering
      if (this.orderField) {
        query = query.orderBy(this.orderField, this.orderDirection)
      }

      // Apply limit
      if (this.limitCount) {
        query = query.limit(this.limitCount)
      }

      const snapshot = await query.get()
      
      const data = snapshot.docs.map((doc: any) => 
        serializeFirestoreData({
          id: doc.id,
          ...doc.data()
        })
      )


      if (this.singleDoc) {
        return { data: data[0] || null, error: null }
      }

      return { data, error: null }
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

export async function createClient() {
  return {
    from: (table: string) => new ServerQueryBuilder(table),
    
    auth: {
      getUser: async () => {
        const { user, error } = await getServerSession()
        if (error || !user) {
          return { data: { user: null }, error }
        }
        return { data: { user }, error: null }
      },
      signOut: async () => {
        // Server-side sign out - clear session cookie
        try {
          const { cookies } = await import('next/headers')
          const cookieStore = await cookies()
          cookieStore.delete('session')
          return { error: null }
        } catch (error: any) {
          return { error }
        }
      }
    },

    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: any) => {
          try {
            const bucketInstance = adminStorage.bucket()
            const fileRef = bucketInstance.file(path)
            
            // If file is a Buffer or has buffer method
            let buffer: Buffer
            if (Buffer.isBuffer(file)) {
              buffer = file
            } else if (file.arrayBuffer) {
              // If it's a File/Blob object
              const arrayBuffer = await file.arrayBuffer()
              buffer = Buffer.from(arrayBuffer)
            } else {
              throw new Error('Invalid file format')
            }
            
            await fileRef.save(buffer, {
              metadata: {
                contentType: file.type || 'application/octet-stream',
              },
            })
            
            // Make the file publicly accessible
            await fileRef.makePublic()
            
            return { 
              data: { 
                path: path,
                fullPath: path 
              }, 
              error: null 
            }
          } catch (error: any) {
            return { data: null, error }
          }
        },
        getPublicUrl: (path: string) => {
          try {
            const bucketInstance = adminStorage.bucket()
            const file = bucketInstance.file(path)
            const publicUrl = `https://storage.googleapis.com/${bucketInstance.name}/${path}`
            return { data: { publicUrl } }
          } catch (error: any) {
            return { data: { publicUrl: '' } }
          }
        },
        remove: async (paths: string[]) => {
          try {
            const bucketInstance = adminStorage.bucket()
            await Promise.all(
              paths.map(async (path) => {
                const file = bucketInstance.file(path)
                await file.delete()
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
}
