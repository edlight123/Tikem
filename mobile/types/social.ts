/**
 * Client-side social types & helpers for the mobile app.
 * Mirrors the web `types/social.ts` (the mobile package can't import from the
 * Next.js workspace), keeping only what the client needs.
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'twitter' | 'facebook';

export interface SocialLinks {
  instagram?: string;
  tiktok?: string;
  twitter?: string;
  facebook?: string;
}

export type AttendanceVisibility = 'nobody' | 'friends' | 'everyone';
export type ProfileVisibility = 'private' | 'public';

export interface PrivacySettings {
  profile_visibility: ProfileVisibility;
  attendance_visibility: AttendanceVisibility;
  discoverable_by_phone: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  profile_visibility: 'private',
  attendance_visibility: 'nobody',
  discoverable_by_phone: true,
};

export type FriendshipState =
  | 'none'
  | 'friends'
  | 'request_sent'
  | 'request_received'
  | 'self';

export interface PublicUserSummary {
  uid: string;
  displayName: string;
  photoURL?: string;
  isVerified?: boolean;
}

/** Why a person is suggested. Never says WHICH events or friends. */
export type SuggestionReason = 'mutual_friends' | 'same_events';

/** GET /api/connections/suggestions item (mirrors types/social.ts on the web). */
export interface FriendSuggestion extends PublicUserSummary {
  username?: string;
  reason: SuggestionReason;
  mutualCount: number;
}

/** GET /api/events/[id]/friends-going: only the viewer's own connections. */
export interface FriendsGoingResponse {
  enabled: boolean;
  count: number;
  friends: PublicUserSummary[];
}

export interface ContactMatch extends PublicUserSummary {
  friendship: FriendshipState;
}

export interface EventSocialAttendance {
  totalGoing: number;
  viewerIsGoing: boolean;
  friendsGoing: PublicUserSummary[];
  publicGoing: PublicUserSummary[];
}

const HANDLE_CLEAN = /[^a-zA-Z0-9._]/g;

/** Normalize a user-entered handle or URL into a bare handle. */
export function normalizeSocialHandle(raw: string | null | undefined): string {
  if (!raw) return '';
  let value = String(raw).trim();
  if (!value) return '';

  if (/^https?:\/\//i.test(value) || value.includes('/')) {
    const segments = value.split('/').filter(Boolean);
    value = segments.length ? segments[segments.length - 1] : value;
  }

  value = value.replace(/^@+/, '').replace(HANDLE_CLEAN, '');
  return value.slice(0, 50);
}

/** Build the public-facing URL for a social handle. */
export function socialUrlFor(platform: SocialPlatform, handle: string): string {
  const h = handle.replace(/^@+/, '');
  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${h}`;
    case 'tiktok':
      return `https://tiktok.com/@${h}`;
    case 'twitter':
      return `https://twitter.com/${h}`;
    case 'facebook':
      return `https://facebook.com/${h}`;
    default:
      return '';
  }
}
