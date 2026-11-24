/**
 * The organization page's banner art, shared by the page itself and the
 * banner sheet's live preview so the two always agree.
 *
 *  1. The org's banner (a template or their upload), with a soft top scrim for
 *     the controls and a fade into the canvas at the foot.
 *  2. No banner: their newest poster, heavily blurred and veiled, so the top
 *     of the page carries their own colours instead of an empty dark void
 *     (TestFlight 2026-11-24, "not like Tikra").
 *  3. No poster either: a quiet canvas gradient with the name's first letter
 *     as a large serif monogram. Never a teal glow.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors as T, font, withAlpha } from '../../theme/tokens';

export default function OrgHeroBackdrop({
  coverSource,
  posterUri,
  name,
  monogramSize = 180,
  fadeTo = T.bg,
}: {
  coverSource: number | { uri: string } | null;
  posterUri?: string | null;
  name?: string;
  monogramSize?: number;
  /** The colour the band fades into at its foot (the page, or a sheet). */
  fadeTo?: string;
}) {
  const fade = (
    <LinearGradient
      colors={[withAlpha(T.bg, 0.45), withAlpha(fadeTo, 0), withAlpha(fadeTo, 0), fadeTo]}
      locations={[0, 0.42, 0.62, 1]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );

  if (coverSource) {
    return (
      <>
        <Image source={coverSource} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        {fade}
      </>
    );
  }

  if (posterUri) {
    return (
      <>
        <Image
          source={{ uri: posterUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={36}
          transition={200}
          accessible={false}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(T.bg, 0.5) }]} pointerEvents="none" />
        {fade}
      </>
    );
  }

  const initial = (name || '').trim().charAt(0).toUpperCase();
  return (
    <>
      <LinearGradient
        colors={[T.surfaceRaised, T.surface, fadeTo]}
        locations={[0, 0.55, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {initial ? (
        <View style={styles.monogramWrap} pointerEvents="none">
          <Text
            style={[styles.monogram, { fontSize: monogramSize, lineHeight: monogramSize * 1.05 }]}
            numberOfLines={1}
            accessible={false}
          >
            {initial}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  monogramWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
    overflow: 'hidden',
  },
  monogram: {
    fontFamily: font.serif,
    color: withAlpha(T.white, 0.05),
  },
});
