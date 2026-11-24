import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image, ImageLoadEventData } from 'expo-image';
import { posterFit } from '../lib/posterFit';
import { Skeleton } from './Skeleton';

/**
 * An event poster that fills its frame and never crops a flyer badly.
 *
 * - An image close to the frame's shape fills it (`cover`).
 * - A landscape image (wider than tall) is a photo, not a flyer: it fills the
 *   frame too (TestFlight 2026-11-23: "the picture should fill entire thing";
 *   a landscape photo sat in grey bands above and below).
 * - A square or Stories flyer, whose date and venue a crop would cut off, is
 *   shown WHOLE (`contain`) over a blurred, cover-filled copy of itself, so
 *   the frame is never an empty band: the art's own colours run to the edges.
 *
 * The image's shape is only known once it loads, so it is remembered per URL:
 * a recycled or re-rendered card lays out right on the first frame instead of
 * jumping from cropped to fitted.
 */

const knownRatios = new Map<string, number>();

interface Props {
  uri: string;
  /** Frame width / height (4:5 card = 0.8). */
  frameRatio: number;
  recyclingKey?: string;
  transition?: number;
  /**
   * What a screen reader says for the poster (lib/posterAlt). With it the
   * image is its own focus stop; without it the image is decorative and
   * hidden (the card around it carries the words).
   */
  accessibilityLabel?: string;
}

export default function PosterImage({ uri, frameRatio, recyclingKey, transition = 200, accessibilityLabel }: Props) {
  const a11y = accessibilityLabel
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel } as const)
    : ({ accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);
  const [ratio, setRatio] = useState<number | undefined>(knownRatios.get(uri));
  // The poster shimmers until it paints (like the feed skeleton it replaces)
  // instead of showing a flat grey frame. Tracked per URI so a recycled card
  // starts shimmering again; a URL that has loaded before is in the memory
  // cache, so it skips the shimmer rather than flicker for one frame.
  const [paintedUri, setPaintedUri] = useState<string | null>(knownRatios.has(uri) ? uri : null);
  const painted = paintedUri === uri || knownRatios.has(uri);
  const shimmer = painted ? null : (
    <Skeleton radius={0} style={StyleSheet.absoluteFill as any} />
  );
  const onError = () => setPaintedUri(uri);

  const onLoad = (e: ImageLoadEventData) => {
    setPaintedUri(uri);
    const { width, height } = e.source;
    if (!width || !height) return;
    const r = width / height;
    knownRatios.set(uri, r);
    if (r !== ratio) setRatio(r);
  };

  if (posterFit(ratio, frameRatio) === 'cover') {
    return (
      <>
        {shimmer}
        <Image
          {...a11y}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={transition}
          recyclingKey={recyclingKey}
          onLoad={onLoad}
          onError={onError}
        />
      </>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} {...a11y}>
      {shimmer}
      {/* The same flyer, filled and blurred, behind the whole one. */}
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        contentFit="cover"
        blurRadius={30}
        cachePolicy="memory-disk"
        transition={transition}
        recyclingKey={recyclingKey ? `bg-${recyclingKey}` : undefined}
      />
      <View style={styles.backdropShade} />
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={transition}
        recyclingKey={recyclingKey}
        onLoad={onLoad}
        onError={onError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Zoomed a little so the blur's soft edge never shows inside the frame.
  backdrop: { transform: [{ scale: 1.2 }] },
  // Keeps the blurred copy behind the sharp flyer rather than competing with it.
  backdropShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
});
