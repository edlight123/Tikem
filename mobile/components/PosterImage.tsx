import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image, ImageLoadEventData } from 'expo-image';

/**
 * An event poster that never crops a flyer badly.
 *
 * Most organizers upload a flyer made for Instagram (square) or Stories
 * (9:16), and our cards are 4:5. Filling the card with `cover` cut the date or
 * venue off the edge of those flyers. Now a flyer whose shape is close to the
 * frame still fills it; one that isn't is shown WHOLE, centred on a blurred,
 * darkened copy of itself, so the card still reads as a full poster.
 *
 * The flyer's shape is only known once it loads, so it is remembered per URL:
 * a recycled or re-rendered card lays out right on the first frame instead of
 * jumping from cropped to fitted.
 */

// How far (relative) a flyer's shape may differ from the frame and still fill
// it. 12% loses a sliver at the edges, never a line of text.
const FILL_TOLERANCE = 0.12;

const knownRatios = new Map<string, number>();

interface Props {
  uri: string;
  /** Frame width / height (4:5 card = 0.8). */
  frameRatio: number;
  recyclingKey?: string;
  transition?: number;
}

export default function PosterImage({ uri, frameRatio, recyclingKey, transition = 200 }: Props) {
  const [ratio, setRatio] = useState<number | undefined>(knownRatios.get(uri));

  const onLoad = (e: ImageLoadEventData) => {
    const { width, height } = e.source;
    if (!width || !height) return;
    const r = width / height;
    knownRatios.set(uri, r);
    if (r !== ratio) setRatio(r);
  };

  const fits = ratio === undefined || Math.abs(ratio - frameRatio) / frameRatio <= FILL_TOLERANCE;

  if (fits) {
    return (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={transition}
        recyclingKey={recyclingKey}
        onLoad={onLoad}
      />
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        contentFit="cover"
        blurRadius={36}
        cachePolicy="memory-disk"
        recyclingKey={recyclingKey}
      />
      <View style={styles.scrim} />
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={transition}
        recyclingKey={recyclingKey}
        onLoad={onLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Slightly oversized so the blur's soft edge never shows inside the frame.
  backdrop: {
    transform: [{ scale: 1.15 }],
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
});
