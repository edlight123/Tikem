import React, { useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { generalArt } from '../../lib/artLibrary';

/**
 * The auth (login / sign-up) backdrop is a rotating piece of Haitian artwork —
 * konpa nights, Jacmel streets, a tap-tap at sunset — so every entry into the
 * app opens on a moment of Haitian culture. A different piece shows each time
 * the auth screen mounts.
 *
 * The art keeps its own colours (each piece is different), unified by:
 *  1. a top+bottom darkening scrim so the wordmark (top) and form (bottom) stay
 *     legible over any image, and
 *  2. a faint upper-left teal wash — the POSH brand accent, sparing.
 *
 * All pieces are BUNDLED assets, so the screen works offline and on first
 * launch; nothing streams. The rotation is the art library's general pool
 * (lib/artLibrary.ts), so a piece added there joins the login screen too.
 */
const ART = generalArt();

export function AuthBackground({ children }: { children?: React.ReactNode }) {
  // Pick one piece per mount so users see the collection rotate across opens.
  const [art] = useState(() => ART[Math.floor(Math.random() * ART.length)]);

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
