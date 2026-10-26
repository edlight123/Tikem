/**
 * The avatar for someone with no profile photo: a single neutral person
 * silhouette (Apple-style) on a softly lit dark disc, the same for everyone.
 * Served from public/avatars/default.svg. Mirrors mobile/lib/defaultAvatar.ts
 * (mobile/assets/avatars/default.png), so a person looks the same on both.
 */

export const DEFAULT_AVATAR = '/avatars/default.svg'

// Kept at 1 and the index helpers kept (always 0) so existing callers that
// reference them keep compiling; there is now one avatar for everyone.
export const DEFAULT_AVATAR_COUNT = 1

export function defaultAvatarIndex(_seed?: string): number {
  return 0
}

export function defaultAvatarAt(_index?: number): string {
  return DEFAULT_AVATAR
}

export function defaultAvatarUrl(_seed?: string): string {
  return DEFAULT_AVATAR
}
