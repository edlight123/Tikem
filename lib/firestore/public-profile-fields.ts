/**
 * H4 — Public profile projection (shared, side-effect free).
 *
 * `public_profiles/{uid}` is a cross-user-readable projection of a user's SAFE
 * display fields. It exists so that other users can render an organizer/host
 * public profile (name, avatar, verified badge, brand socials, location,
 * description, ...) WITHOUT reading `users/{uid}` (which holds PII: email,
 * phone_number, whatsapp/contact number, verification internals).
 *
 * The set below intentionally covers everything the cross-user organizer
 * profile UI renders and that is ALREADY public today (any signed-in user can
 * read the full users doc), so moving those reads to the projection is not a
 * regression.
 *
 * NEVER add: email, phone_number / phone, whatsapp / contact number,
 * verification internals, privacy settings, or the privacy-gated personal
 * `social_links` object.
 *
 * This module imports nothing from firebase so it is safe to use in both the
 * Admin SDK (server) and the client SDK (browser / React Native) sync paths.
 */

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
  // Brand / organization socials (top-level, NOT the personal social_links object)
  'website',
  'instagram',
  'facebook',
  'tiktok',
  // Location / meta (all currently public)
  'city',
  'country',
  'categories',
  'languages',
  'rating',
  'created_at',
] as const

/**
 * Given a (partial) users-doc-shaped object, return only the safe public
 * projection fields that are actually present. Undefined/missing fields are
 * omitted so this composes with `{ merge: true }` writes (partial patches such
 * as a photo-only update only touch photo_url).
 */
export function pickPublicProfileFields(
  data: Record<string, any> | null | undefined
): Record<string, any> {
  const out: Record<string, any> = {}
  if (!data) return out

  // Name: accept the various historical spellings but always store as full_name.
  const name = data.full_name ?? data.display_name ?? data.displayName
  if (name != null) out.full_name = name

  const photo = data.photo_url ?? data.photoURL
  if (photo != null) out.photo_url = photo

  // Location: the organizer UI reads `city`/`country`; profiles store those or
  // the `default_*` variants — normalize to the names the UI reads.
  const city = data.city ?? data.default_city
  if (city != null) out.city = city
  const country = data.country ?? data.default_country
  if (country != null) out.country = country

  // Account age → "hosting since". Accept snake/camel spellings.
  const createdAt = data.created_at ?? data.createdAt
  if (createdAt != null) out.created_at = createdAt

  if (data.is_verified != null) out.is_verified = data.is_verified
  if (data.username != null) out.username = data.username
  if (data.organization_name != null) out.organization_name = data.organization_name
  if (data.organization_logo != null) out.organization_logo = data.organization_logo
  if (data.description != null) out.description = data.description

  // Brand / organization socials (public), NOT the personal social_links object.
  if (data.website != null) out.website = data.website
  if (data.instagram != null) out.instagram = data.instagram
  if (data.facebook != null) out.facebook = data.facebook
  if (data.tiktok != null) out.tiktok = data.tiktok

  if (data.categories != null) out.categories = data.categories
  if (data.languages != null) out.languages = data.languages
  if (data.rating != null) out.rating = data.rating

  return out
}
