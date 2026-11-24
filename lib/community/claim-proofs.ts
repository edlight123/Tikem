/**
 * Event-claim proof documents (a screenshot of the organizer's account, a
 * letter, an ID) live under the PRIVATE storage prefix claim-proofs/{uid}/
 * (storage.rules: owner create-only, no client read, not even the uploader).
 * Clients send the storage PATH, never a download URL (a download URL is a
 * bearer link that bypasses storage.rules); only admins ever see the file,
 * through a short-lived signed URL minted here behind requireAdmin.
 * Account deletion removes the prefix (lib/account/deletion.ts).
 *
 * Ported from Tikra e3ce5aef. Pure path checks are exported separately so
 * they are unit tested without the Admin SDK.
 */

export const CLAIM_PROOF_PREFIX = 'claim-proofs/'
/** How long an admin's signed link to a proof stays valid. */
export const CLAIM_PROOF_URL_TTL_MS = 10 * 60 * 1000

/**
 * True when `path` is a single file directly under claim-proofs/{uid}/:
 * no dot segments, no nesting, no backslashes, no scheme.
 */
export function isClaimProofPathFor(path: unknown, uid: string): path is string {
  if (typeof path !== 'string' || !uid) return false
  if (path.length > 300 || path.includes('\\') || path.includes('..')) return false
  const prefix = `${CLAIM_PROOF_PREFIX}${uid}/`
  if (!path.startsWith(prefix)) return false
  const name = path.slice(prefix.length)
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(name)
}

/** True for any well-formed claim-proofs/{uid}/{file} path (the owner taken from the path). */
export function isClaimProofPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith(CLAIM_PROOF_PREFIX)) return false
  const uid = path.slice(CLAIM_PROOF_PREFIX.length).split('/')[0]
  return isClaimProofPathFor(path, uid)
}

async function bucket() {
  const { adminStorage } = await import('@/lib/firebase/admin')
  return adminStorage.bucket()
}

/** Whether the uploaded proof object actually exists in our bucket. */
export async function claimProofExists(path: string): Promise<boolean> {
  try {
    const [exists] = await (await bucket()).file(path).exists()
    return exists === true
  } catch {
    return false
  }
}

/**
 * A 10-minute signed read URL for an admin reviewing a claim. Callers MUST
 * have checked the viewer is an admin. Null when the path is malformed or
 * signing fails.
 */
export async function signClaimProof(path: unknown): Promise<string | null> {
  if (!isClaimProofPath(path)) return null
  try {
    const [url] = await (await bucket()).file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + CLAIM_PROOF_URL_TTL_MS,
    })
    return url || null
  } catch (err: any) {
    console.warn('[claim-proofs] signing failed', { message: err?.message })
    return null
  }
}
