import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image, ImageLoadEventData } from 'expo-image';
import { API_BASE_URL } from '../lib/api/backend';

/**
 * An event poster that never crops a flyer badly.
 *
 * Most organizers upload a flyer made for Instagram (square) or Stories
 * (9:16), and our cards are 4:5. Filling the card with `cover` cut the date or
 * venue off the edge of those flyers. Now a flyer whose shape is close to the
 * frame still fills it; one that isn't is shown WHOLE on one even, deep tone
 * taken from the flyer (the website's /api/posters/tone; the app can't read
 * pixels without a native module). A blurred copy left uneven patches above
 * and below the art; a single tone reads as a deliberate mount.
 *
 * The flyer's shape is only known once it loads, so it is remembered per URL:
 * a recycled or re-rendered card lays out right on the first frame instead of
 * jumping from cropped to fitted.
 */

// How far (relative) a flyer's shape may differ from the frame and still fill
// it. 12% loses a sliver at the edges, never a line of text.
const FILL_TOLERANCE = 0.12;

const knownRatios = new Map<string, number>();
const knownTones = new Map<string, Promise<string>>();

// Neutral mount while the tone loads (and if it can't be read).
const MOUNT = '#141414';

function toneFor(uri: string): Promise<string> {
  let p = knownTones.get(uri);
  if (!p) {
    p = fetch(`${API_BASE_URL}/api/posters/tone?url=${encodeURIComponent(uri)}`)
      .then((r) => r.json())
      .then((j) => (typeof j?.tone === 'string' ? j.tone : MOUNT))
      .catch(() => MOUNT);
    knownTones.set(uri, p);
  }
  return p;
}

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
  const [tone, setTone] = useState(MOUNT);

  useEffect(() => {
    if (fits) return;
    let live = true;
    toneFor(uri).then((t) => live && setTone(t));
    return () => {
      live = false;
    };
  }, [fits, uri]);

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
    <View style={[StyleSheet.absoluteFill, { backgroundColor: tone }]}>
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
