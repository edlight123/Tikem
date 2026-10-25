/**
 * The face for someone with no profile photo: one of twelve hand-drawn
 * portraits (DiceBear "Notionists", CC0, bundled so nothing loads from a third
 * party), always the same one for the same person (owner feedback
 * 2026-10-25: avatars, not an initial). The web mirrors this in
 * lib/defaultAvatar.ts with the same files under public/avatars.
 */
import type { ImageSourcePropType } from 'react-native';

const AVATARS: ImageSourcePropType[] = [
  require('../assets/avatars/a1.png'),
  require('../assets/avatars/a2.png'),
  require('../assets/avatars/a3.png'),
  require('../assets/avatars/a4.png'),
  require('../assets/avatars/a5.png'),
  require('../assets/avatars/a6.png'),
  require('../assets/avatars/a7.png'),
  require('../assets/avatars/a8.png'),
  require('../assets/avatars/a9.png'),
  require('../assets/avatars/a10.png'),
  require('../assets/avatars/a11.png'),
  require('../assets/avatars/a12.png'),
];

export const DEFAULT_AVATAR_COUNT = AVATARS.length;

export function defaultAvatarAt(index: number): ImageSourcePropType {
  return AVATARS[((index % AVATARS.length) + AVATARS.length) % AVATARS.length];
}

/** Stable index 0..11 for a seed (a uid, or any string). */
export function defaultAvatarIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % AVATARS.length;
}

export function defaultAvatar(seed: string): ImageSourcePropType {
  return AVATARS[defaultAvatarIndex(seed || 'tikem')];
}
