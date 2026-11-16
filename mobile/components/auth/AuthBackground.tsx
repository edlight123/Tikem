import React, { useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { authPhotos } from '../../lib/artLibrary';
import { themedArt } from '../../lib/nationalDaysRemote';

/**
 * The auth (login / sign-up) backdrop is a rotating real photograph of people
 * out together: a concert, a party, a dinner, a family, friends on a trip
 * (2026-11-14: the illustrated backdrops "read very AI"). A different photo
 * shows each time the auth screen mounts.
 *
 * The art keeps its own colours (each piece is different), unified by:
 *  1. a top+bottom darkening scrim so the wordmark (top) and form (bottom) stay
 *     legible over any image, and
 *  2. a faint upper-left teal wash — the POSH brand accent, sparing.
 *
 * All photos are BUNDLED assets, so the screen works offline and on first
 * launch; nothing streams. The rotation is authPhotos() in lib/artLibrary.ts.
 */
const ART = authPhotos();

export function AuthBackground({ children }: { children?: React.ReactNode }) {
  // Pick one piece per mount so users see the collection rotate across opens.
  // While a national day is active (lib/nationalDays) its art takes the slot.
  const [art] = useState(() => themedArt(ART[Math.floor(Math.random() * ART.length)]));

  return (
    <View style={styles.root}>
      <Image
        source={art.source}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />

      {/* 1 — legibility scrim: darker at top (wordmark) and bottom (form),
             letting the art breathe through the middle. */}
      <LinearGradient
        colors={['rgba(10,10,10,0.66)', 'rgba(10,10,10,0.12)', 'rgba(10,10,10,0.58)', '#0A0A0A']}
        locations={[0, 0.30, 0.66, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* 2 — sparing brand teal wash, anchored to the upper-left headline corner. */}
      <LinearGradient
        colors={['rgba(20,184,166,0.16)', 'transparent']}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.9, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
});

export default AuthBackground;
