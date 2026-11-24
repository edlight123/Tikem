/**
 * Upload an event-claim proof (website) to the PRIVATE prefix
 * claim-proofs/{uid}/ and resolve to its storage PATH, never a download URL
 * (a download URL is a bearer link that bypasses storage.rules). The claim API
 * checks the path is the caller's own; admins view it via a signed URL
 * (lib/community/claim-proofs). The Firebase SDK is imported at the point of
 * use so it stays off the page's first load.
 */
export const CLAIM_PROOF_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}
export const CLAIM_PROOF_MAX_BYTES = 10 * 1024 * 1024

export class ClaimProofError extends Error {
  constructor(public code: 'type' | 'size' | 'auth' | 'failed') {
    super(code)
  }
}

export async function uploadClaimProof(file: File): Promise<string> {
  const type = String(file.type || '').toLowerCase()
  const ext = CLAIM_PROOF_TYPES[type]
  if (!ext) throw new ClaimProofError('type')
  if (file.size > CLAIM_PROOF_MAX_BYTES) throw new ClaimProofError('size')
  const [{ ref, uploadBytes }, client] = await Promise.all([import('firebase/storage'), import('@/lib/firebase/client')])
  const uid = (await client.getSignedInUser())?.uid
  if (!uid) throw new ClaimProofError('auth')
  const path = `claim-proofs/${uid}/proof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  try {
    await uploadBytes(ref(client.storage, path), file, { contentType: type === 'image/jpg' ? 'image/jpeg' : type })
  } catch (err: any) {
    const code: string = err?.code || ''
    throw new ClaimProofError(code === 'storage/unauthorized' || code === 'storage/unauthenticated' ? 'auth' : 'failed')
  }
  return path
}
