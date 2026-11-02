import { randomUUID } from 'crypto'
import type { File } from '@google-cloud/storage'

/**
 * A public link to a file we just stored.
 *
 * The bucket has uniform bucket-level access (locked since 2026-02-21), so
 * `file.makePublic()` always throws ("Cannot update access control for an
 * object when uniform bucket-level access is enabled") and a
 * storage.googleapis.com link to the file is a 403. A Firebase download
 * token works regardless of bucket ACLs: the same kind of link the client
 * SDK's getDownloadURL() and the guest uploads hand out.
 */
export async function downloadUrl(file: File): Promise<string> {
  const token = randomUUID()
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
  return linkFor(file, token)
}

/**
 * The link an object already hands out, or null when it doesn't exist or has
 * no token. Re-saving an object drops its custom metadata (and so the token
 * every stored link carries), so a file that may be written twice under the
 * same name should be reused rather than overwritten.
 */
export async function existingDownloadUrl(file: File): Promise<string | null> {
  const [exists] = await file.exists()
  if (!exists) return null
  const [meta] = await file.getMetadata()
  const token = String(meta.metadata?.firebaseStorageDownloadTokens || '').split(',')[0]
  return token ? linkFor(file, token) : null
}

/**
 * The object path inside `bucketName` that a stored link points at: a
 * download link (firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>) or a
 * legacy storage.googleapis.com/<bucket>/<path> one. Null for anything else.
 */
export function storagePathFromUrl(url: string, bucketName: string): string | null {
  try {
    const m = url.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/)
    if (m) return m[1] === bucketName ? decodeURIComponent(m[2]) : null
    const legacy = `https://storage.googleapis.com/${bucketName}/`
    return url.startsWith(legacy) ? decodeURIComponent(url.slice(legacy.length).split('?')[0]) : null
  } catch {
    return null
  }
}

const linkFor = (file: File, token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`
