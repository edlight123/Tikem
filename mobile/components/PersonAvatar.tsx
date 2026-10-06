import React from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../contexts/ThemeContext';
import type { PublicUserSummary } from '../types/social';

interface Props {
  user: Pick<PublicUserSummary, 'uid' | 'displayName' | 'photoURL'>;
  size?: number;
  /** A ring in the page colour, for overlapping piles. */
  ring?: boolean;
}

/** Round avatar: the photo, or the initial on a raised fill (never a hairline box). */
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
  const initial = (user.displayName || 'U').trim().charAt(0).toUpperCase() || 'U';
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.surfaceRaised,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ringStyle,
      ]}
    >
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: size * 0.4 }}>{initial}</Text>
    </View>
  );
}
