/**
 * What a profile page shows under the name: ONE rule for web and app.
 *
 * Every profile URL (/profile/organizer/{uid} on the web, OrganizerProfile in
 * the app) belongs either to an ORGANIZATION or to a PERSON, and the two show
 * different things:
 *
 *   org     the organization's own details, entered in organizer settings
 *           (app/api/organizer/settings/organization/route.ts writes them to
 *           organizers/{orgId}): description, website, Instagram, Facebook,
 *           X/Twitter, LinkedIn, TikTok. Public by nature, no privacy gate.
 *           Older accounts carried brand fields on public_profiles/{uid}
 *           (description, website, instagram, facebook, tiktok, the mobile
 *           projection); those fill any field organizers/{uid} leaves empty.
 *
 *   person  the person's own bio and social handles (users/{uid}.bio and
 *           .social_links), ONLY when their privacy allows it: their
 *           privacy.profile_visibility is 'public', or the viewer is an
 *           accepted friend, or the viewer is themselves. Otherwise `person`
 *           is null. The same rule the web profile page has always applied.
 *
 * ORG vs PERSON. A profile is an org when ANY of these holds, else a person:
 *   1. users/{uid}.role is 'organizer';
 *   2. it has organization details: an organization name (public_profiles,
 *      users or organizers) or any org description/website/social;
 *   3. it has hosted at least one published event.
 * An organizer is a person too, but their profile is the organization's
 * storefront, so it shows the organization's details, not their personal ones.
 *
 * Never returned, for either kind: email, phone, WhatsApp, privacy settings or
 * anything else from users/{uid} beyond bio and the four social handles.
 *
 * Every link comes back as an absolute http(s) URL ready for an href (or ''),
 * so neither client builds or trusts a URL itself.
 */

import { adminDb } from '@/lib/firebase/admin'
import { getFriendshipState } from '@/lib/firestore/connections'
import { safeExternalUrl } from '@/lib/safeUrl'
import { DEFAULT_PRIVACY, socialUrlFor, type FriendshipState } from '@/types/social'

export type ProfileKind = 'org' | 'person'

export interface OrgPublicDetails {
  description: string
  website: string
  instagram: string
  facebook: string
  twitter: string
  linkedin: string
  tiktok: string
}

export interface PersonSocials {
  instagram: string
  tiktok: string
  twitter: string
  facebook: string
}

export interface PersonPublicDetails {
  bio: string
  socials: PersonSocials
}

export interface PublicProfileDetails {
  kind: ProfileKind
  /** Present when kind is 'org'. */
  org?: OrgPublicDetails
  /** Present when kind is 'person': null when their privacy hides it from this viewer. */
  person?: PersonPublicDetails | null
}

type Doc = Record<string, any> | null | undefined

const HANDLE_RE = /^@?[A-Za-z0-9._-]{1,100}$/
const MAX_DESCRIPTION = 2000
const MAX_BIO = 280

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export type SocialNetwork = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'tiktok'

/**
 * A stored social value (bare handle or link) as an href, or '' when it is
 * empty or not a safe http(s) link. Same reading as the settings route's
 * cleanSocial: no scheme, slash or dot-host means a handle.
 */
export function socialHref(network: SocialNetwork, raw: unknown): string {
  const s = str(raw)
  if (!s || s.length > 500) return ''
  if (HANDLE_RE.test(s)) {
    const handle = s.replace(/^@+/, '')
    if (!handle) return ''
    if (network === 'linkedin') return `https://www.linkedin.com/in/${handle}`
    return socialUrlFor(network, handle)
  }
  return safeExternalUrl(s) || ''
}

/** A website as an href, or ''. */
export function websiteHref(raw: unknown): string {
  const s = str(raw)
  if (!s || s.length > 500) return ''
  return safeExternalUrl(s) || ''
}

/** The org details, organizers/{uid} first, then the legacy public_profiles brand fields. */
export function resolveOrgDetails(orgDoc: Doc, publicDoc: Doc): OrgPublicDetails {
  const social = (orgDoc?.social_media && typeof orgDoc.social_media === 'object' ? orgDoc.social_media : {}) as Record<string, unknown>
  const pick = (network: SocialNetwork) => socialHref(network, str(social[network]) || str(publicDoc?.[network]))
  return {
    description: (str(orgDoc?.organization_description) || str(publicDoc?.description)).slice(0, MAX_DESCRIPTION),
    website: websiteHref(str(orgDoc?.website) || str(publicDoc?.website)),
    instagram: pick('instagram'),
    facebook: pick('facebook'),
    twitter: pick('twitter'),
    linkedin: pick('linkedin'),
    tiktok: pick('tiktok'),
  }
}

/** Rule 2 of ORG vs PERSON: any organization detail at all. */
function hasOrgDetails(userDoc: Doc, orgDoc: Doc, publicDoc: Doc): boolean {
  if (str(publicDoc?.organization_name) || str(userDoc?.organization_name) || str(orgDoc?.organization_name)) return true
  const d = resolveOrgDetails(orgDoc, publicDoc)
  return Object.values(d).some(Boolean)
}

export function resolveProfileKind(input: {
  userDoc: Doc
  orgDoc: Doc
  publicDoc: Doc
  hasPublishedEvents: boolean
}): ProfileKind {
  if (str(input.userDoc?.role) === 'organizer') return 'org'
  if (hasOrgDetails(input.userDoc, input.orgDoc, input.publicDoc)) return 'org'
  if (input.hasPublishedEvents) return 'org'
  return 'person'
}

/** The privacy gate for a person's bio and socials. */
export function canViewPersonDetails(userDoc: Doc, friendship: FriendshipState): boolean {
  const privacy = { ...DEFAULT_PRIVACY, ...((userDoc?.privacy as object) || {}) }
  return privacy.profile_visibility === 'public' || friendship === 'friends' || friendship === 'self'
}

export function resolvePersonDetails(userDoc: Doc): PersonPublicDetails {
  const links = (userDoc?.social_links && typeof userDoc.social_links === 'object' ? userDoc.social_links : {}) as Record<string, unknown>
  return {
    bio: str(userDoc?.bio).slice(0, MAX_BIO),
    socials: {
      instagram: socialHref('instagram', links.instagram),
      tiktok: socialHref('tiktok', links.tiktok),
      twitter: socialHref('twitter', links.twitter),
      facebook: socialHref('facebook', links.facebook),
    },
  }
}

/** Pure: build the response from already-read documents. */
export function buildPublicProfileDetails(input: {
  userDoc: Doc
  orgDoc: Doc
  publicDoc: Doc
  hasPublishedEvents: boolean
  friendship: FriendshipState
}): PublicProfileDetails {
  const kind = resolveProfileKind(input)
  if (kind === 'org') return { kind, org: resolveOrgDetails(input.orgDoc, input.publicDoc) }
  return {
    kind,
    person: canViewPersonDetails(input.userDoc, input.friendship) ? resolvePersonDetails(input.userDoc) : null,
  }
}

/**
 * Read everything and answer for this viewer (null when signed out). Returns
 * null when no such user exists. `hasPublishedEvents` may be passed by a
 * caller that already counted them, which skips the events read.
 */
export async function loadPublicProfileDetails(
  uid: string,
  viewerId: string | null,
  opts: { hasPublishedEvents?: boolean } = {}
): Promise<{ details: PublicProfileDetails; friendship: FriendshipState } | null> {
  const id = String(uid || '').trim()
  if (!id) return null
  const [userSnap, orgSnap, publicSnap] = await adminDb.getAll(
    adminDb.collection('users').doc(id),
    adminDb.collection('organizers').doc(id),
    adminDb.collection('public_profiles').doc(id)
  )
  if (!userSnap?.exists && !publicSnap?.exists) return null
  const userDoc = userSnap?.exists ? userSnap.data() : null
  const orgDoc = orgSnap?.exists ? orgSnap.data() : null
  const publicDoc = publicSnap?.exists ? publicSnap.data() : null

  let friendship: FriendshipState = 'none'
  if (viewerId && viewerId === id) friendship = 'self'
  else if (viewerId) {
    try {
      friendship = await getFriendshipState(viewerId, id)
    } catch {
      friendship = 'none'
    }
  }

  // Only read events when the cheaper signals have not already decided it.
  let hasPublishedEvents = opts.hasPublishedEvents ?? false
  if (
    opts.hasPublishedEvents === undefined &&
    resolveProfileKind({ userDoc, orgDoc, publicDoc, hasPublishedEvents: false }) === 'person'
  ) {
    try {
      const snap = await adminDb
        .collection('events')
        .where('organizer_id', '==', id)
        .where('is_published', '==', true)
        .limit(1)
        .get()
      hasPublishedEvents = !snap.empty
    } catch {
      hasPublishedEvents = false
    }
  }

  return {
    details: buildPublicProfileDetails({ userDoc, orgDoc, publicDoc, hasPublishedEvents, friendship }),
    friendship,
  }
}
