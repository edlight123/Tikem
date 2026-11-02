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
  return `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`
}
