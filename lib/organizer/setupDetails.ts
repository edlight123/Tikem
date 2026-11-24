/**
 * The optional details captured on the one "create your organization" step
 * (web app/organizer/actions.ts becomeOrganizer, app POST
 * /api/account/become-organizer): one line about the organization, a
 * website, Instagram and Facebook. All optional. Links are kept as https URLs
 * only (lib/organizer/links.ts); a link that cannot be read is dropped rather
 * than failing the step, since it can be fixed later in settings.
 *
 * Written where organization settings and the public page read them:
 * organizers/{uid}.organization_description, .website, .social_media.
 */
import { adminDb } from '@/lib/firebase/admin'
import { socialToHttpsUrl, toHttpsUrl } from './links'

export const MAX_SETUP_LINE = 300

export interface OrgSetupDetails {
  description?: unknown
  website?: unknown
  instagram?: unknown
  facebook?: unknown
}

/** Pure: the organizers/{uid} patch for these details, or null when there is nothing to save. */
export function orgSetupPatch(details: OrgSetupDetails | null | undefined): Record<string, unknown> | null {
  if (!details) return null
  const patch: Record<string, unknown> = {}
  const line = typeof details.description === 'string' ? details.description.replace(/\s+/g, ' ').trim().slice(0, MAX_SETUP_LINE) : ''
  if (line) patch.organization_description = line
  const website = toHttpsUrl(details.website)
  if (website) patch.website = website
  const social: Record<string, string> = {}
  const ig = socialToHttpsUrl('instagram', details.instagram)
  if (ig) social.instagram = ig
  const fb = socialToHttpsUrl('facebook', details.facebook)
  if (fb) social.facebook = fb
  if (Object.keys(social).length) patch.social_media = social
  return Object.keys(patch).length ? patch : null
}

/** Save them for `uid`'s organization. Non-fatal by design: logs and returns false. */
export async function saveOrgSetupDetails(uid: string, details: OrgSetupDetails | null | undefined): Promise<boolean> {
  const patch = orgSetupPatch(details)
  if (!patch) return true
  try {
    await adminDb
      .collection('organizers')
      .doc(uid)
      .set({ ...patch, updated_at: new Date().toISOString() }, { merge: true })
    return true
  } catch (e) {
    console.error('[org-setup] details not saved', (e as any)?.message)
    return false
  }
}
