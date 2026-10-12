import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { X, Search, ImageUp } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { radius, spacing } from '../theme/tokens';

/** One photo as returned by GET /api/flyers/library (web lib/flyerLibrary). */
interface LibraryFlyer {
  id: string;
  label: string;
  tags: string[];
  thumbUrl: string;
  fullUrl: string;
}

interface FlyerLibraryResponse {
  items: LibraryFlyer[];
}

export interface SelectedFlyer {
  url: string;
}

interface FlyerLibrarySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the full-size image when the organizer taps a photo tile. */
  onSelect: (flyer: SelectedFlyer) => void;
  /** Called when the organizer wants to pick their own image instead. */
  onUpload: () => void;
}

/** Accent-folded, so "fete" finds "fèt": nobody types the grave on a phone. */
const fold = (v: string) =>
  (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/** Pair items into rows of two for a hand-built grid inside one ScrollView. */
function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

/**
 * "Select a flyer": the same curated photo library the web composer offers,
 * fetched from /api/flyers/library so both devices show one shelf.
 *
 * Our own illustrations (lib/artLibrary) are deliberately NOT here: they are
 * Tikèm's brand art for the app's own screens (login, empty states, worlds),
 * and as a flyer every organizer who picked one got the same poster.
 *
 * Search works like the web picker: matches move to the front and the rest
 * stay underneath, because nobody browsing artwork wants less of it.
 * The white "Upload an image" pill stays pinned for organizers who brought
 * their own artwork.
 */
export default function FlyerLibrarySheet({ visible, onClose, onSelect, onUpload }: FlyerLibrarySheetProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<LibraryFlyer[]>([]);
  const [loading, setLoading] = useState(false);

  // The list is static and cached by the server; load it once per session,
  // retrying on the next open only if the first attempt came back empty.
  useEffect(() => {
    if (!visible || library.length > 0) return;
    let cancelled = false;
    setLoading(true);
    backendJson<FlyerLibraryResponse>('/api/flyers/library')
      .then((data) => {
        if (!cancelled) setLibrary(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        // Never block the organizer: the empty state shows and upload still works.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, library.length]);

  const items = useMemo(() => {
    const needle = fold(query);
    if (!needle) return library;
    const hits: LibraryFlyer[] = [];
    const rest: LibraryFlyer[] = [];
    for (const item of library) {
      const hay = fold([item.label, item.id, ...item.tags].join(' '));
      (hay.includes(needle) ? hits : rest).push(item);
    }
    return [...hits, ...rest];
  }, [library, query]);

  const handleSelect = (item: LibraryFlyer) => {
    onSelect({ url: item.fullUrl });
    onClose();
  };

  const renderTile = (item: LibraryFlyer) => (
    <TouchableOpacity
      key={item.id}
      style={styles.tile}
      activeOpacity={0.85}
      onPress={() => handleSelect(item)}
      accessibilityRole="imagebutton"
      accessibilityLabel={item.label}
    >
      <Image
        source={{ uri: item.thumbUrl }}
        style={styles.tileImage}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.72)']}
        style={styles.tileScrim}
        pointerEvents="none"
      />
      <View style={styles.credit} pointerEvents="none">
        <Text style={styles.creditText} numberOfLines={1}>
          {item.label}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>{t('flyerLibrary.title')}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBox}>
            <Search size={16} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('flyerLibrary.searchPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {loading && items.length === 0 ? (
              <View style={styles.stateWrap}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : items.length === 0 ? (
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{t('flyerLibrary.empty')}</Text>
              </View>
            ) : (
              pairs(items).map((row, i) => (
                <View key={i} style={styles.gridRow}>
                  {row.map(renderTile)}
                  {/* An odd last tile keeps its column width instead of stretching. */}
                  {row.length === 1 && <View style={styles.tileSpacer} />}
                </View>
              ))
            )}
          </ScrollView>

          <TouchableOpacity
            style={styles.uploadPill}
            onPress={onUpload}
            accessibilityRole="button"
          >
            <ImageUp size={18} color="#0A0A0B" />
            <Text style={styles.uploadPillText}>{t('flyerLibrary.uploadImage')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      height: '90%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: spacing.md,
      marginBottom: spacing.lg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.lg,
      marginBottom: spacing.lg,
    },
    title: {
      flex: 1,
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
    },
    // A fill, not a hairline (POSH brief): the field is one step brighter
    // than the sheet.
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      paddingHorizontal: spacing.md,
      height: 44,
      marginBottom: spacing.lg,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 0,
    },
    scroll: {
      flex: 1,
    },
    gridRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    gridContent: {
      paddingBottom: spacing.md,
    },
    tile: {
      flex: 1,
      aspectRatio: 4 / 5,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.surfaceRaised,
    },
    tileSpacer: {
      flex: 1,
    },
    tileImage: {
      ...StyleSheet.absoluteFillObject,
    },
    tileScrim: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: '38%',
    },
    credit: {
      position: 'absolute',
      left: spacing.sm,
      right: spacing.sm,
      bottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    creditText: {
      flexShrink: 1,
      fontSize: 11,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    stateWrap: {
      minHeight: 120,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    stateText: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      color: colors.textSecondary,
    },
    uploadPill: {
      marginTop: spacing.md,
      height: 56,
      borderRadius: radius.button,
      backgroundColor: colors.white,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    uploadPillText: {
      fontSize: 16,
      fontWeight: '700',
      // Fixed near-black: the pill is white in every theme, so the label must
      // not follow a palette color that could also be light.
      color: '#0A0A0B',
    },
  });
