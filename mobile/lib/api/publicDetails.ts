/**
 * What a profile shows under the name, decided by the server for this viewer:
 * an organization's own details (description + links from organizer
 * settings), or a person's bio + socials when their privacy allows (null
 * otherwise). The app cannot read users/{uid} (owner-only in firestore.rules),
 * so the privacy check lives server-side, shared with the web profile page:
 * lib/profile/public-details.ts. Every link is an absolute http(s) href.
 */
import { backendJson } from './backend';

export interface OrgPublicDetails {
  description: string;
  website: string;
  instagram: string;
  facebook: string;
  twitter: string;
  linkedin: string;
  tiktok: string;
}

export interface PersonPublicDetails {
  bio: string;
  socials: { instagram: string; tiktok: string; twitter: string; facebook: string };
}

/** The personal name and photo (person view): never the organization's brand. */
export interface PersonIdentity {
  full_name: string;
  photo_url: string;
  is_verified: boolean;
  joined_at: string | null;
}

export interface OrgCard {
  organization_name: string;
  organization_logo: string;
  is_verified: boolean;
  coverTemplate: string | null;
  coverImageUrl: string | null;
  gallery: unknown[];
  city: string;
  country: string;
}

export interface PublicProfileDetails {
  kind: 'org' | 'person';
  org?: OrgPublicDetails;
  /** Org only: the page's display card (public_profiles' safe fields), for guests. */
  card?: OrgCard;
  person?: PersonPublicDetails | null;
  /** The person view (view: 'person'), also for an organization's owner. */
  view?: 'person';
  identity?: PersonIdentity;
  /** Person view of an org owner: the organization they run (its page is the same uid). */
  also_runs?: { name: string; logo: string } | null;
}

/** GET /api/profiles/{uid}/public-details; null when it cannot be loaded. */
export async function fetchPublicProfileDetails(
  uid: string,
  opts: { view?: 'person' } = {}
): Promise<PublicProfileDetails | null> {
  if (!uid) return null;
  try {
    // view 'person': the personal page, even when the account runs an org.
    const data = await backendJson<PublicProfileDetails>(
      `/api/profiles/${encodeURIComponent(uid)}/public-details${opts.view === 'person' ? '?view=person' : ''}`
    );
    return data && (data.kind === 'org' || data.kind === 'person') ? data : null;
  } catch {
    return null;
  }
}
