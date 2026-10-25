/**
 * H4 — Public profile projection sync (mobile client).
 *
 * `public_profiles/{uid}` is a cross-user-readable projection of a user's SAFE
 * display fields so other users can render an organizer/host public profile
 * (name, avatar, verified badge, brand socials, location, description, ...)
 * WITHOUT reading `users/{uid}` (which holds PII: email, phone_number,
 * whatsapp/contact number, verification internals, and the privacy-gated
 * personal `social_links` object).
 *
 * NEVER add email, phone_number/phone, whatsapp/contact number, verification
 * internals, privacy settings, or the personal social_links object here. The
 * owner writes their own projection doc (allowed by the Firestore rules).
 * Best-effort: never throws.
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export const PUBLIC_PROFILE_FIELDS = [
  'full_name',
  'photo_url',
  'is_verified',
  // NOT 'bio': a person's bio is privacy-gated (profile_visibility), and this
  // doc is readable by every signed-in user. Profiles get it, gated, from
  // GET /api/profiles/{uid}/public-details (lib/profile/public-details.ts).
  'username',
  'organization_name',
  'organization_logo',
  'description',
  'website',
  'instagram',
  'facebook',
  'tiktok',
  'city',
  'country',
  'categories',
  'languages',
  'rating',
  'created_at',
] as const;

/**
 * Extract only the safe public projection fields that are present in a (partial)
 * users-doc-shaped object. Missing fields are omitted so this composes with
 * merge writes.
 */
export function pickPublicProfileFields(
  data: Record<string, any> | null | undefined
): Record<string, any> {
  const out: Record<string, any> = {};
  if (!data) return out;

  const name = data.full_name ?? data.display_name ?? data.displayName;
  if (name != null) out.full_name = name;

  const photo = data.photo_url ?? data.photoURL;
  if (photo != null) out.photo_url = photo;

  const city = data.city ?? data.default_city;
  if (city != null) out.city = city;
  const country = data.country ?? data.default_country;
  if (country != null) out.country = country;

  const createdAt = data.created_at ?? data.createdAt;
  if (createdAt != null) out.created_at = createdAt;

  if (data.is_verified != null) out.is_verified = data.is_verified;
  if (data.username != null) out.username = data.username;
  if (data.organization_name != null) out.organization_name = data.organization_name;
  if (data.organization_logo != null) out.organization_logo = data.organization_logo;
  if (data.description != null) out.description = data.description;

  // Brand / organization socials (public), NOT the personal social_links object.
  if (data.website != null) out.website = data.website;
  if (data.instagram != null) out.instagram = data.instagram;
  if (data.facebook != null) out.facebook = data.facebook;
  if (data.tiktok != null) out.tiktok = data.tiktok;

  if (data.categories != null) out.categories = data.categories;
  if (data.languages != null) out.languages = data.languages;
  if (data.rating != null) out.rating = data.rating;

  return out;
}

/**
 * Mirror the SAFE public fields of a users doc into public_profiles/{uid}.
 * Best-effort — logs and swallows errors so the primary users-doc write wins.
 */
export async function syncPublicProfile(
  uid: string,
  data: Record<string, any> | null | undefined
): Promise<void> {
  try {
    if (!uid) return;
    const fields = pickPublicProfileFields(data);
    if (Object.keys(fields).length === 0) return;
    await setDoc(doc(db, 'public_profiles', uid), fields, { merge: true });
  } catch (err) {
    console.error('[public_profiles] mobile sync failed for', uid, err);
  }
}
