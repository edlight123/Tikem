/**
 * The face for someone with no profile photo: one of twelve hand-drawn
 * portraits (DiceBear "Notionists", CC0) served from public/avatars, always the
 * same one for the same person. Mirrors mobile/lib/defaultAvatar.ts, same
 * files and same hash, so a person has one face on both.
 */

export const DEFAULT_AVATAR_COUNT = 12

export function defaultAvatarIndex(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % DEFAULT_AVATAR_COUNT
}

export function defaultAvatarAt(index: number): string {
  const i = ((index % DEFAULT_AVATAR_COUNT) + DEFAULT_AVATAR_COUNT) % DEFAULT_AVATAR_COUNT
  return `/avatars/a${i + 1}.png`
}

export function defaultAvatarUrl(seed: string): string {
  return defaultAvatarAt(defaultAvatarIndex(seed || 'tikem'))
}
