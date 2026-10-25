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

export interface PublicProfileDetails {
  kind: 'org' | 'person';
  org?: OrgPublicDetails;
  person?: PersonPublicDetails | null;
}

/** GET /api/profiles/{uid}/public-details; null when it cannot be loaded. */
export async function fetchPublicProfileDetails(uid: string): Promise<PublicProfileDetails | null> {
  if (!uid) return null;
  try {
    const data = await backendJson<PublicProfileDetails>(
      `/api/profiles/${encodeURIComponent(uid)}/public-details`
    );
    return data && (data.kind === 'org' || data.kind === 'person') ? data : null;
  } catch {
    return null;
  }
}
