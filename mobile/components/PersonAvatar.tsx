import React from 'react';
import { Image } from 'expo-image';
import { useTheme } from '../contexts/ThemeContext';
import type { PublicUserSummary } from '../types/social';
import { defaultAvatar } from '../lib/defaultAvatar';

interface Props {
  user: Pick<PublicUserSummary, 'uid' | 'displayName' | 'photoURL'>;
  size?: number;
  /** A ring in the page colour, for overlapping piles. */
  ring?: boolean;
}

/** Round avatar: the photo, or a drawn portrait (lib/defaultAvatar) for someone without one. */
export default function PersonAvatar({ user, size = 44, ring = false }: Props) {
  const { colors } = useTheme();
  const ringStyle = ring ? { borderWidth: 2, borderColor: colors.background } : null;
  if (user.photoURL) {
    return (
      <Image
        source={{ uri: user.photoURL }}
        style={[{ width: size, height: size, borderRadius: size / 2 }, ringStyle]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        recyclingKey={user.uid}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <Image
      source={defaultAvatar(user.uid || user.displayName || '')}
      style={[{ width: size, height: size, borderRadius: size / 2 }, ringStyle]}
      contentFit="cover"
      accessibilityIgnoresInvertColors
    />
  );
}
