/**
 * The avatar for someone with no profile photo: a single neutral person
 * silhouette (Apple-style) on a softly lit dark disc, the same for everyone,
 * bundled so nothing loads from a third party. The web mirrors this in
 * lib/defaultAvatar.ts (public/avatars/default.svg).
 */
import type { ImageSourcePropType } from 'react-native';

const DEFAULT_AVATAR: ImageSourcePropType = require('../assets/avatars/default.png');

// Kept at 1 and the index helpers kept (always 0) so existing callers that
// reference them keep compiling; there is now one avatar for everyone.
export const DEFAULT_AVATAR_COUNT = 1;

export function defaultAvatarAt(_index?: number): ImageSourcePropType {
  return DEFAULT_AVATAR;
}

export function defaultAvatarIndex(_seed?: string): number {
  return 0;
}

export function defaultAvatar(_seed?: string): ImageSourcePropType {
  return DEFAULT_AVATAR;
}
