/**
 * Verification System - Firestore & Storage Integration
 * Handles organizer verification requests and document uploads
 */

// Pure data (no Firebase), so a static import costs nothing.
import { blankVerificationSteps, OWNER_EDITABLE_STATUSES } from '@/lib/kyc/request-template'

/**
 * DELIBERATE LAZY FIREBASE — DO NOT MAKE THESE IMPORTS STATIC AGAIN.
 *
 * This module is a leaf of the client module graph: the verification wizard,
 * DocumentUploadCard and the ID/selfie forms all import it, and a static
 * `firebase/*` import here dragged the whole SDK onto the FIRST LOAD of every
 * page (measured: 444KB of Firebase across three chunks — 223 + 136 + 85KB —
 * out of ~988KB of shared JS). A route only sheds that weight when its LAST
 * static importer stops pulling the SDK, so the imports live inside the
 * functions that need them. `@/lib/firebase/client` counts too: it calls
 * initializeApp/getFirestore/getStorage at module scope, so importing `db` or
 * `storage` statically re-anchors the SDK just as firmly as `firebase/firestore`.
 *
 * The module-scope caches mean a page that calls several of these helpers pays
 * for the dynamic import exactly once. Every exported signature is unchanged —
 * consumers needed no edits.
 */
let _fs: typeof import('firebase/firestore') | null = null
async function fs() { return (_fs ??= await import('firebase/firestore')) }

let _storageSdk: typeof import('firebase/storage') | null = null
async function storageSdk() { return (_storageSdk ??= await import('firebase/storage')) }

let _fb: typeof import('@/lib/firebase/client') | null = null
async function fb() { return (_fb ??= await import('@/lib/firebase/client')) }

// Types
export type VerificationStatus = 
  | 'not_started' 
  | 'in_progress' 
  | 'pending' // legacy (migrate to pending_review)
  | 'pending_review'
  | 'in_review' 
  | 'approved' 
  | 'changes_requested' 
  | 'rejected'

export type StepStatus = 'incomplete' | 'complete' | 'needs_attention'

export interface VerificationStep {
  id: string
  title: string
  description: string
  status: StepStatus
  required: boolean
  fields: Record<string, any>
  missingFields?: string[]
  errorMessage?: string
}

export interface VerificationFiles {
  governmentId?: {
    front?: string // Storage path
    back?: string
    uploadedAt?: Date
  }
  selfie?: {
    path?: string
    uploadedAt?: Date
  }
  businessDocs?: {
    registration?: string
    taxId?: string
    uploadedAt?: Date
  }
}

export interface VerificationRequest {
  userId: string
  status: VerificationStatus
  steps: {
    organizerInfo: VerificationStep
    governmentId: VerificationStep
    selfie: VerificationStep
    businessDetails: VerificationStep
    payoutSetup: VerificationStep
  }
  files: VerificationFiles
  submittedAt?: string
  reviewedAt?: string
  reviewNotes?: string
  reasonCodes?: string[]
  createdAt: string
  updatedAt: string
}

// Helper: Get verification request for user
export async function getVerificationRequest(userId: string): Promise<VerificationRequest | null> {
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([fs(), fb()])
    const docRef = doc(db, 'verification_requests', userId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      return null
    }

    const data = docSnap.data()
    
    // Convert Firestore timestamps to ISO strings
    return {
      ...data,
      createdAt: (data.createdAt?.toDate?.() || new Date()).toISOString(),
      updatedAt: (data.updatedAt?.toDate?.() || new Date()).toISOString(),
      submittedAt: data.submittedAt?.toDate?.()?.toISOString() || undefined,
      reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || undefined,
    } as VerificationRequest
  } catch (error) {
    console.error('Error fetching verification request:', error)
    return null
  }
}

// Helper: Initialize new verification request
export async function initializeVerificationRequest(userId: string): Promise<VerificationRequest> {
  const initialRequest: VerificationRequest = {
    userId,
    status: 'in_progress',
    steps: blankVerificationSteps(),
    files: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  
  const [{ doc, setDoc, serverTimestamp }, { db }] = await Promise.all([fs(), fb()])
  const docRef = doc(db, 'verification_requests', userId)
  await setDoc(docRef, {
    ...initialRequest,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  return initialRequest
}

// Helper: Update verification step
export async function updateVerificationStep(
  userId: string,
  stepId: keyof VerificationRequest['steps'],
  stepData: Partial<VerificationStep>
): Promise<void> {
  try {
    const [{ doc, getDoc, updateDoc, serverTimestamp }, { db }] = await Promise.all([fs(), fb()])
    const docRef = doc(db, 'verification_requests', userId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      throw new Error('Verification request not found')
    }

    const currentData = docSnap.data() as VerificationRequest
    const updatedSteps = {
      ...currentData.steps,
      [stepId]: {
        ...currentData.steps[stepId],
        ...stepData
      }
    }
    
    await updateDoc(docRef, {
      steps: updatedSteps,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating verification step:', error)
    throw error
  }
}

/**
 * Image types storage.rules accepts under verification/{uid}/ (no SVG, no GIF,
 * no PDF). Checked here too so the organizer gets a clear message instead of a
 * bare permission error.
 */
export const VERIFICATION_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
export const VERIFICATION_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'
export const VERIFICATION_IMAGE_MAX_BYTES = 15 * 1024 * 1024

// Helper: Upload verification document
//
// Every upload gets a NEW object name (type + timestamp + random suffix):
// storage.rules make KYC uploads create-only, so a re-upload while changes are
// requested can never overwrite — and so never silently swap — a file an
// admin may already have looked at.
export async function uploadVerificationDocument(
  userId: string,
  file: File,
  documentType: 'id_front' | 'id_back' | 'selfie' | 'business_registration' | 'tax_id'
): Promise<string> {
  try {
    const type = String(file.type || '').toLowerCase()
    const extension = VERIFICATION_IMAGE_TYPES[type]
    if (!extension) {
      throw new Error('Please upload a JPEG, PNG, WebP or HEIC photo.')
    }
    if (file.size > VERIFICATION_IMAGE_MAX_BYTES) {
      throw new Error('This photo is too large. The maximum size is 15MB.')
    }
    const suffix = Math.random().toString(36).slice(2, 8)
    const fileName = `${documentType}_${Date.now()}_${suffix}.${extension}`
    const storagePath = `verification/${userId}/${fileName}`

    const [{ ref, uploadBytes }, { storage }] = await Promise.all([storageSdk(), fb()])
    const storageRef = ref(storage, storagePath)
    await uploadBytes(storageRef, file, { contentType: type === 'image/jpg' ? 'image/jpeg' : type })

    // Return the storage path (not the download URL for security)
    return storagePath
  } catch (error) {
    console.error('Error uploading verification document:', error)
    throw error
  }
}

// Helper: Get document download URL (admin only in production)
export async function getDocumentDownloadURL(storagePath: string): Promise<string> {
  try {
    const [{ ref, getDownloadURL }, { storage }] = await Promise.all([storageSdk(), fb()])
    const storageRef = ref(storage, storagePath)
    return await getDownloadURL(storageRef)
  } catch (error) {
    console.error('Error getting document download URL:', error)
    throw error
  }
}

/** Can the owner still edit this request's steps/files? Mirrors firestore.rules. */
export function isOwnerEditableStatus(status: string | null | undefined): boolean {
  return (OWNER_EDITABLE_STATUSES as readonly string[]).includes(String(status || ''))
}

async function authedPost(path: string): Promise<any> {
  const { auth } = await fb()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const current = auth.currentUser
  if (current) headers.Authorization = `Bearer ${await current.getIdToken()}`
  const res = await fetch(path, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(current ? { userId: current.uid } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`) as Error & { code?: string; status?: number }
    err.code = data?.code
    err.status = res.status
    throw err
  }
  return data
}

// Helper: Update verification files
export async function updateVerificationFiles(
  userId: string,
  files: Partial<VerificationFiles>
): Promise<void> {
  try {
    const [{ doc, getDoc, updateDoc, serverTimestamp }, { db }] = await Promise.all([fs(), fb()])
    const docRef = doc(db, 'verification_requests', userId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      throw new Error('Verification request not found')
    }

    const currentData = docSnap.data() as VerificationRequest
    const updatedFiles = {
      ...currentData.files,
      ...files
    }
    
    await updateDoc(docRef, {
      files: updatedFiles,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating verification files:', error)
    throw error
  }
}

// Helper: Submit verification for review
//
// Goes through /api/organizer/submit-verification: the request's status is
// server-owned (firestore.rules), and the server reviews the documents STORED
// on the request rather than anything the browser sends.
export async function submitVerificationForReview(userId: string): Promise<void> {
  try {
    const current = await getVerificationRequest(userId)
    if (!current) {
      throw new Error('Verification request not found')
    }
    if (!canSubmitForReview(current)) {
      throw new Error('Please complete all required steps before submitting')
    }
    await authedPost('/api/organizer/submit-verification')
  } catch (error) {
    console.error('Error submitting verification:', error)
    throw error
  }
}

// Helper: Calculate overall completion percentage
export function calculateCompletionPercentage(request: VerificationRequest): number {
  const allSteps = Object.values(request.steps)
  const requiredSteps = allSteps.filter(step => step.required)

  // Progress should reflect required steps so optional steps don't block submission UX.
  const denominator = requiredSteps.length > 0 ? requiredSteps.length : allSteps.length
  const numerator = (requiredSteps.length > 0 ? requiredSteps : allSteps).filter(step => step.status === 'complete').length
  return Math.round((numerator / denominator) * 100)
}

// Helper: Get blocking issues (for submit button)
export function getBlockingIssues(request: VerificationRequest): string[] {
  const issues: string[] = []
  
  Object.values(request.steps).forEach(step => {
    if (step.required && step.status !== 'complete') {
      issues.push(`${step.title}: ${step.missingFields?.join(', ') || 'Not complete'}`)
    }
  })
  
  return issues
}

// Helper: Check if can submit
export function canSubmitForReview(request: VerificationRequest): boolean {
  const requiredSteps = Object.values(request.steps).filter(step => step.required)
  return requiredSteps.every(step => step.status === 'complete')
}

// Helper: Restart a rejected / changes-requested verification (fresh draft).
// Server-side: it resets status and review fields and removes the previous
// attempt's uploads, none of which the owner may do from the client.
export async function restartVerification(_userId: string): Promise<void> {
  try {
    await authedPost('/api/organizer/reset-verification')
  } catch (error) {
    console.error('Error restarting verification:', error)
    throw error
  }
}
