import React, { useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import { WORLDS, artForWorld, type WorldKey } from '../lib/artLibrary';
import { radius, spacing } from '../theme/tokens';

/**
 * "worlds": a peeking rail of the eight cultural worlds, each a tall 4:5 tile
 * wearing its own Tikèm screenprint.
 *
 * Premium rules (owner, 2026-10-01: "keep the premium and lux feel"):
 * - The art stays vivid. No wash over the whole image, only a short gradient at
 *   the foot, just deep enough to carry the label.
 * - Crisp type: a bold lowercase world name and one quiet line under it.
 * - Small poster corners, no borders, no shadows, no badges.
 * - The image fades in and the tile gives way slightly under the finger.
 *
 * Every world is always shown (browsing by vibe never depends on tonight's
 * inventory). Its art is seeded by the world key, so a tile never changes and
 * matches the hero of the world page it opens.
 */
const TILE_W = 150;
const TILE_H = Math.round((TILE_W * 5) / 4);

export default function WorldRail({ onWorldPress }: { onWorldPress: (world: WorldKey, label: string) => void }) {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('home.worlds.title')} subtitle={t('home.worlds.subtitle')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.row}
        decelerationRate="fast"
        snapToInterval={TILE_W + spacing.sm}
        snapToAlignment="start"
      >
        {WORLDS.map((w) => (
          <WorldTile
            key={w.key}
            world={w.key}
            label={w.label}
            sublabel={t(`home.worlds.sub.${w.key}`)}
            onPress={() => onWorldPress(w.key, w.label)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function WorldTile({
  world,
  label,
  sublabel,
  onPress,
}: {
  world: WorldKey;
  label: string;
  sublabel: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const art = artForWorld(world, world);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(0.97)}
      onPressOut={() => press(1)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sublabel}`}
    >
      <Animated.View style={[styles.tile, { transform: [{ scale }] }]}>
        <Image
          source={art.source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={250}
          cachePolicy="memory"
          accessibilityIgnoresInvertColors
        />
        {/* Only the lower third darkens; the art above it stays untouched. */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']}
          locations={[0.55, 0.8, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.caption}>
          <Text style={styles.name} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sublabel}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Same bleed as EventRail: the caller's section already pads 16, so the
  // scroll view steps back out to the screen edge and the content pads in
  // again. The first tile then lines up with the header and the screen gutter,
  // and the last peeks off the right edge (padding it twice put the first tile
  // 32pt in, double the gutter).
  scroll: {
    marginHorizontal: -spacing.lg,
  },
  row: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: radius.poster,
    overflow: 'hidden',
    backgroundColor: '#141414',
  },
  caption: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  sub: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
