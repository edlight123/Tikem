import React, { useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { authPhotos } from '../../lib/artLibrary';
import { themedArt } from '../../lib/nationalDaysRemote';
import { colors as T } from '../../theme/tokens';

/**
 * The auth (login / sign-up) backdrop: a rotating photograph of happy people
 * (friends, a party, a dinner, a crowd on a dune), a different one each time the
 * screen opens.
 *
 * The photo fills the TOP of the screen only and fades into the black canvas
 * behind the form (owner 2026-11-24: keep a photo, make it better quality,
 * make it people happy). Stretched over the whole phone the people sat behind
 * the form and one crop read as just a hand; this way the faces sit above it.
 * The photos are cut at 1290x1740 from the full-resolution originals
 * (assets/photos/auth), so they stay sharp on a 3x screen.
 *
 * All photos are BUNDLED assets, so the screen works offline and on first
 * launch. While a national day is active (lib/nationalDays) its art takes the
 * slot.
 */
const ART = authPhotos();

export function AuthBackground({ children }: { children?: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const [art] = useState(() => themedArt(ART[Math.floor(Math.random() * ART.length)]));
  // The photo band: about the top two thirds, fading out before the form.
  const bandH = Math.round(height * 0.66);

  return (
    <View style={styles.root}>
      <View style={[styles.band, { height: bandH }]} pointerEvents="none">
        <Image
          source={art.source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
          transition={200}
          accessibilityIgnoresInvertColors
        />
        {/* Darker at the very top for the close button and wordmark, clear
            through the faces, then into the canvas well before the form. */}
        <LinearGradient
          colors={['rgba(10,10,10,0.55)', 'rgba(10,10,10,0.05)', 'rgba(10,10,10,0.35)', T.bg]}
          locations={[0, 0.3, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  band: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
});

export default AuthBackground;
