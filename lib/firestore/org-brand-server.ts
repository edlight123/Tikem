/**
 * Server (Admin SDK) read and write of the organizer brand. Where it lives and
 * why: lib/profile/org-brand.ts.
 */

import { adminDb } from '@/lib/firebase/admin'
import { pickOrgBrandPatch, resolveOrgBrand, type OrgBrand } from '@/lib/profile/org-brand'

const EMPTY: OrgBrand = { organization_name: '', organization_logo: '' }

/**
 * Write the brand fields present in `patch` to the canonical
 * public_profiles/{uid} and the legacy users/{uid} copy, plus organizers/{uid}
 * when `organizers` is set (the web settings routes, which own that doc).
 * One batch, and it throws: the canonical write is the point, so it is not
 * best-effort like syncPublicProfileAdmin.
 */
export async function writeOrgBrandAdmin(
  uid: string,
  patch: Record<string, unknown>,
  opts: { organizers?: boolean } = {}
): Promise<Partial<OrgBrand>> {
  const fields = pickOrgBrandPatch(patch)
  if (!uid || Object.keys(fields).length === 0) return fields
  const updatedAt = new Date().toISOString()
  const batch = adminDb.batch()
  batch.set(adminDb.collection('public_profiles').doc(uid), fields, { merge: true })
  batch.set(adminDb.collection('users').doc(uid), { ...fields, updated_at: updatedAt }, { merge: true })
  if (opts.organizers) {
    batch.set(adminDb.collection('organizers').doc(uid), { ...fields, updated_at: updatedAt }, { merge: true })
  }
  await batch.commit()
  return fields
}

/**
 * Resolve the brand for each organizer id: public_profiles first, then the
 * legacy users and organizers copies. One getAll round trip. Ids that fail to
 * read resolve to empty strings, never throw.
 */
export async function readOrgBrandsAdmin(ids: string[]): Promise<Map<string, OrgBrand>> {
  const out = new Map<string, OrgBrand>()
  const unique = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)))
  if (!unique.length) return out
  try {
    const refs = unique.flatMap((id) => [
      adminDb.collection('public_profiles').doc(id),
      adminDb.collection('users').doc(id),
      adminDb.collection('organizers').doc(id),
    ])
    const snaps = await adminDb.getAll(...refs)
    unique.forEach((id, i) => {
      const [pub, user, org] = snaps.slice(i * 3, i * 3 + 3).map((s: any) => (s?.exists ? s.data() : null))
      out.set(id, resolveOrgBrand(pub, user, org))
    })
  } catch (err) {
    console.error('[org-brand] read failed', err)
    for (const id of unique) if (!out.has(id)) out.set(id, { ...EMPTY })
  }
  return out
}

export async function readOrgBrandAdmin(uid: string): Promise<OrgBrand> {
  return (await readOrgBrandsAdmin([uid])).get(uid) || { ...EMPTY }
}
