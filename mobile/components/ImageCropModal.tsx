import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RotateCcw } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { AFTER_ALERT_MS } from '../lib/moderationActions';
import { colors, radius, type, withAlpha } from '../theme/tokens';
import {
  clampCrop,
  coverScale,
  cropRect,
  fitFrame,
  outputSize,
  POSTER_ASPECT,
  SQUARE_ASPECT,
  zoomAt,
  type Size,
} from '../lib/imageCrop';
import { CanvasCropper, type CropJob } from './CanvasCropper';

/**
 * Full-screen framing step after picking a flyer (4:5) or a logo / profile
 * photo (1:1). Ported from Tikra (efdf8259), restyled to the Tikèm tokens.
 *
 * Pinch with two fingers to zoom (around the pinch), drag to move, double-tap
 * to reset. Gestures run on the UI thread (react-native-gesture-handler +
 * Reanimated, both already in the store binary) through the shared crop math
 * in lib/imageCrop.ts, which keeps the photo covering the frame at all times.
 * A thirds grid fades in while a finger is down.
 *
 * Done crops in JS only (no new native module, so this ships over the air):
 * the framed slice is drawn on a canvas inside an invisible WebView
 * (CanvasCropper) at up to 1280x1600 for a flyer or 800x800 for a logo, never
 * upscaled past the source slice, and the JPEG lands in the cache directory as
 * a file:// URI that the existing upload path takes unchanged. If that fails
 * the original photo is returned (`cropped: false`).
 *
 * Use it through `useImageCrop()` (the provider is mounted once in App.tsx).
 */

export type CropAsset = { uri: string; width: number; height: number; mimeType?: string | null };
export type CropResult = { uri: string; cropped: boolean; width?: number; height?: number } | null;
type CropFn = (asset: CropAsset, aspect?: number) => Promise<CropResult>;

const FRAME_MARGIN = 20;
const DIM = withAlpha(colors.black, 0.66);
const GRID = withAlpha(colors.white, 0.45);

const CropContext = createContext<CropFn | null>(null);

/**
 * Resolves to the framed image ({ uri, cropped }), or null when the person
 * cancels. Without the provider (tests, an early screen) it hands the original
 * back unchanged.
 */
export function useImageCrop(): CropFn {
  const fn = useContext(CropContext);
  return useCallback<CropFn>(
    (asset, aspect) => (fn ? fn(asset, aspect) : Promise.resolve({ uri: asset.uri, cropped: false })),
    [fn],
  );
}

export function ImageCropProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<{ asset: CropAsset; aspect: number; resolve: (r: CropResult) => void } | null>(
    null,
  );
  const crop = useCallback<CropFn>(
    (asset, aspect = POSTER_ASPECT) =>
      new Promise<CropResult>((resolve) => {
        // A photo without dimensions can't be framed: keep it as is.
        if (!(asset.width > 0 && asset.height > 0)) return resolve({ uri: asset.uri, cropped: false });
        // The picker is still animating away when it resolves; presenting a
        // modal over it then can be dropped on iOS (dead-button pattern).
        setTimeout(() => setRequest({ asset, aspect, resolve }), AFTER_ALERT_MS);
      }),
    [],
  );
  const finish = useCallback(
    (r: CropResult) => {
      request?.resolve(r);
      setRequest(null);
    },
    [request],
  );
  return (
    <CropContext.Provider value={crop}>
      {children}
      {request && (
        <ImageCropModal
          key={request.asset.uri}
          asset={request.asset}
          aspect={request.aspect}
          onCancel={() => finish(null)}
          onDone={(r) => finish(r)}
        />
      )}
    </CropContext.Provider>
  );
}

function ImageCropModal({
  asset,
  aspect,
  onCancel,
  onDone,
}: {
  asset: CropAsset;
  aspect: number;
  onCancel: () => void;
  onDone: (r: NonNullable<CropResult>) => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const image: Size = useMemo(() => ({ width: asset.width, height: asset.height }), [asset.width, asset.height]);

  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const frame = useMemo(
    () =>
      fitFrame(aspect, {
        width: Math.max(0, stage.width - FRAME_MARGIN * 2),
        height: Math.max(0, stage.height - FRAME_MARGIN * 2),
      }),
    [aspect, stage.width, stage.height],
  );
  const ready = frame.width > 0;
  const [job, setJob] = useState<CropJob | null>(null);

  // Gesture state lives on the UI thread.
  const zoom = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const grid = useSharedValue(0);
  const imgSV = useSharedValue(image);
  const frameSV = useSharedValue(frame);
  const stageSV = useSharedValue(stage);
  useEffect(() => {
    imgSV.value = image;
    frameSV.value = frame;
    stageSV.value = stage;
    // Re-clamp after a layout change.
    const c = clampCrop(image, frame, { zoom: zoom.value, x: x.value, y: y.value });
    zoom.value = c.zoom;
    x.value = c.x;
    y.value = c.y;
  }, [image, frame, stage, imgSV, frameSV, stageSV, zoom, x, y]);

  const pan = Gesture.Pan()
    .maxPointers(2)
    .onBegin(() => {
      grid.value = withTiming(1, { duration: 140 });
    })
    .onChange((e) => {
      const c = clampCrop(imgSV.value, frameSV.value, {
        zoom: zoom.value,
        x: x.value + e.changeX,
        y: y.value + e.changeY,
      });
      x.value = c.x;
      y.value = c.y;
    })
    .onFinalize(() => {
      grid.value = withTiming(0, { duration: 260 });
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      grid.value = withTiming(1, { duration: 140 });
    })
    .onChange((e) => {
      const s = stageSV.value;
      const c = zoomAt(
        imgSV.value,
        frameSV.value,
        { zoom: zoom.value, x: x.value, y: y.value },
        zoom.value * e.scaleChange,
        { x: e.focalX - s.width / 2, y: e.focalY - s.height / 2 },
      );
      zoom.value = c.zoom;
      x.value = c.x;
      y.value = c.y;
    })
    .onFinalize(() => {
      grid.value = withTiming(0, { duration: 260 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, success) => {
      if (!success) return;
      zoom.value = withTiming(1, { duration: 220 });
      x.value = withTiming(0, { duration: 220 });
      y.value = withTiming(0, { duration: 220 });
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  // The image is laid out at "just covers the frame" size, centred on the
  // stage, then moved and zoomed with a transform.
  const base = ready ? coverScale(image, frame) : 1;
  const display = { width: image.width * base, height: image.height * base };
  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: zoom.value }],
  }));
  const gridStyle = useAnimatedStyle(() => ({ opacity: grid.value }));

  const reset = () => {
    zoom.value = withTiming(1, { duration: 220 });
    x.value = withTiming(0, { duration: 220 });
    y.value = withTiming(0, { duration: 220 });
  };

  const done = () => {
    if (!ready || job) return;
    const rect = cropRect(image, frame, { zoom: zoom.value, x: x.value, y: y.value });
    setJob({
      uri: asset.uri,
      mimeType: asset.mimeType || 'image/jpeg',
      // As fractions: the WebView scales them to the pixels it actually decoded.
      rect: {
        x: rect.originX / image.width,
        y: rect.originY / image.height,
        width: rect.width / image.width,
        height: rect.height / image.height,
      },
      output: outputSize(aspect, rect),
    });
  };

  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage({ width, height });
  };

  const title = aspect === SQUARE_ASPECT ? t('imageCrop.titleSquare') : t('imageCrop.titlePoster');
  const left = (stage.width - frame.width) / 2;
  const top = (stage.height - frame.height) / 2;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onCancel}>
      <StatusBar style="light" />
      <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onCancel}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>{t('imageCrop.cancel')}</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Pressable
            onPress={done}
            disabled={!ready || !!job}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('imageCrop.done')}
            style={({ pressed }) => [styles.doneBtn, (pressed || !!job) && styles.pressed]}
          >
            {job ? (
              <ActivityIndicator size="small" color={colors.onWhite} />
            ) : (
              <Text style={styles.doneText}>{t('imageCrop.done')}</Text>
            )}
          </Pressable>
        </View>

        <GestureDetector gesture={gesture}>
          <View style={styles.stage} onLayout={onStageLayout} collapsable={false}>
            {ready && (
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: 'absolute',
                    left: stage.width / 2 - display.width / 2,
                    top: stage.height / 2 - display.height / 2,
                    width: display.width,
                    height: display.height,
                  },
                  imageStyle,
                ]}
              >
                {/* Full resolution, so a close zoom stays sharp. */}
                <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="fill" allowDownscaling={false} />
              </Animated.View>
            )}

            {ready && (
              <>
                {/* Dim everything outside the frame. */}
                <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: 0, height: top }]} />
                <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: top + frame.height, bottom: 0 }]} />
                <View pointerEvents="none" style={[styles.dim, { left: 0, width: left, top, height: frame.height }]} />
                <View pointerEvents="none" style={[styles.dim, { right: 0, width: left, top, height: frame.height }]} />
                <View
                  pointerEvents="none"
                  style={[styles.frame, { left, top, width: frame.width, height: frame.height }]}
                >
                  <Animated.View style={[StyleSheet.absoluteFill, gridStyle]}>
                    <View style={[styles.gridV, { left: '33.333%' }]} />
                    <View style={[styles.gridV, { left: '66.666%' }]} />
                    <View style={[styles.gridH, { top: '33.333%' }]} />
                    <View style={[styles.gridH, { top: '66.666%' }]} />
                  </Animated.View>
                </View>
              </>
            )}
          </View>
        </GestureDetector>

        <View style={styles.footer}>
          <Text style={styles.hint}>{t('imageCrop.hint')}</Text>
          <Pressable
            onPress={reset}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
          >
            <RotateCcw size={15} color={colors.textPrimary} strokeWidth={1.75} />
            <Text style={styles.resetText}>{t('imageCrop.reset')}</Text>
          </Pressable>
        </View>

        {job && (
          <CanvasCropper
            job={job}
            onResult={(uri) => {
              const out = job.output;
              setJob(null);
              onDone(
                uri
                  ? { uri, cropped: true, width: out.width, height: out.height }
                  : { uri: asset.uri, cropped: false },
              );
            }}
          />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  headerBtn: { minWidth: 64, height: 40, justifyContent: 'center' },
  cancelText: { color: colors.textSecondary, fontSize: type.body.fontSize },
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
    fontWeight: '600',
  },
  doneBtn: {
    minWidth: 64,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.button,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: colors.onWhite, fontSize: type.body.fontSize, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  stage: { flex: 1, overflow: 'hidden' },
  dim: { position: 'absolute', backgroundColor: DIM },
  frame: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: withAlpha(colors.white, 0.75),
    borderRadius: radius.poster,
  },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: GRID },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: GRID },
  footer: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12, gap: 10 },
  hint: { color: colors.textSecondary, fontSize: type.label.fontSize, textAlign: 'center' },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
  },
  resetText: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: '600' },
});
