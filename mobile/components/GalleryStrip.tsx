/**
 * An organization's photos (lib/galleryRules.ts): a sideways strip of 4:3
 * photos and a full-screen viewer on tap (swipe between photos, caption
 * underneath). Used on the organizer's public page; the website has the same
 * strip (components/organizer/page/GalleryStrip.tsx).
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { colors as T, radius } from '../theme/tokens';
import type { GalleryPhoto } from '../lib/galleryRules';

const CARD_W = 220;
const CARD_H = 165;

export default function GalleryStrip({ photos, style }: { photos: GalleryPhoto[]; style?: any }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState<number | null>(null);
  const [index, setIndex] = useState(0);

  if (!photos.length) return null;
  const show = (i: number) => {
    setIndex(i);
    setOpen(i);
  };

  return (
    <View style={style}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((p, i) => (
          <TouchableOpacity
            key={p.url}
            activeOpacity={0.85}
            onPress={() => show(i)}
            style={styles.card}
            accessibilityRole="imagebutton"
            accessibilityLabel={p.caption || t('orgPage.photoOf', { n: i + 1, total: photos.length })}
          >
            <Image source={{ uri: p.url }} style={styles.thumb} contentFit="cover" transition={150} />
            {p.caption ? (
              <Text style={styles.caption} numberOfLines={1}>
                {p.caption}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal
        visible={open != null}
        animationType="fade"
        onRequestClose={() => setOpen(null)}
        statusBarTranslucent
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.viewer}>
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={open ?? 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.url}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <Image
                  source={{ uri: item.url }}
                  style={{ width, height: height * 0.72 }}
                  contentFit="contain"
                  accessibilityLabel={item.caption || undefined}
                />
              </View>
            )}
          />
          <View style={[styles.viewerTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Text style={styles.counter} accessibilityLiveRegion="polite">
              {index + 1} / {photos.length}
            </Text>
            <TouchableOpacity
              onPress={() => setOpen(null)}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={20} color={T.white} />
            </TouchableOpacity>
          </View>
          {photos[index]?.caption ? (
            <View style={[styles.viewerCaption, { paddingBottom: insets.bottom + 20 }]} pointerEvents="none">
              <Text style={styles.viewerCaptionText}>{photos[index].caption}</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    row: { paddingHorizontal: 16, gap: 8 },
    card: { width: CARD_W },
    thumb: { width: CARD_W, height: CARD_H, borderRadius: radius.sm, backgroundColor: T.surface },
    caption: { marginTop: 6, fontSize: 13, color: colors.textSecondary },
    viewer: { flex: 1, backgroundColor: T.black },
    viewerTop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
    },
    counter: { color: T.white, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    close: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 16 },
    viewerCaptionText: { color: T.white, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  });
