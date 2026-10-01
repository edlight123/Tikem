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
import { X, Search, Camera, ImageUp } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { artForPicker, searchArt, worldForCategory, worldLabel, type ArtPiece } from '../lib/artLibrary';
import SectionHeader from './SectionHeader';
import { radius, spacing } from '../theme/tokens';

/** Shape of one photo as returned by GET /api/flyers/search. */
interface RemoteFlyer {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl: string;
  downloadLocation: string;
}

interface FlyerSearchResponse {
  configured?: boolean;
  results: RemoteFlyer[];
}

export interface SelectedFlyer {
  url: string;
  photographer: string;
  photographerUrl: string;
  downloadLocation: string;
}

interface FlyerLibrarySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the full-size image when the organizer taps a photo tile. */
  onSelect: (flyer: SelectedFlyer) => void;
  /**
   * Called when the organizer taps a piece of Tikèm art. The parent turns the
   * bundled asset into a real file and uploads it on save (see lib/artAsset).
   */
  onSelectArt?: (piece: ArtPiece) => void;
  /** Called when the organizer wants to pick their own image instead. */
  onUpload: () => void;
  /** The event's category, so art from its world leads the grid. */
  category?: string;
}

const SEARCH_DEBOUNCE_MS = 400;

/** Pair items into rows of two for a hand-built grid inside one ScrollView. */
function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

/**
 * "Select a flyer" — a posh-style flyer library.
 *
 * Two sections in one scroll:
 *  1. tikèm art: our own text-free screenprints (lib/artLibrary), the ones
 *     matching the event's world first. Bundled, so they show offline.
 *  2. photos: portrait Unsplash photos proxied through /api/flyers/search (the
 *     API key stays server-side), photographer credit on every tile. When the
 *     server has no Unsplash key this section quietly says so.
 * The white "Upload an image" pill stays pinned for organizers who brought
 * their own artwork.
 */
export default function FlyerLibrarySheet({
  visible,
  onClose,
  onSelect,
  onSelectArt,
  onUpload,
  category,
}: FlyerLibrarySheetProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<RemoteFlyer[]>([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);

  const world = worldForCategory(category);
  const art = useMemo(
    () => (onSelectArt ? searchArt(artForPicker(category), debouncedQuery) : []),
    [onSelectArt, category, debouncedQuery]
  );

  // Debounce keystrokes so we hit the search API at most ~2.5x/second of
  // typing, not once per character.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setLoading(true);

    backendJson<FlyerSearchResponse>(
      `/api/flyers/search?q=${encodeURIComponent(debouncedQuery)}`
    )
      .then((data) => {
        if (cancelled) return;
        setConfigured(data?.configured !== false);
        setResults(Array.isArray(data?.results) ? data.results : []);
      })
      .catch(() => {
        // A failed search must never block the organizer: show the empty
        // state, keep the art and the upload pill working.
        if (cancelled) return;
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, debouncedQuery]);

  const handleSelect = (flyer: RemoteFlyer) => {
    // Unsplash's API terms require hitting download_location when a photo is
    // actually used. Fire-and-forget: attribution bookkeeping must not delay
    // (or be able to break) the organizer's flow.
    backendJson('/api/flyers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadLocation: flyer.downloadLocation }),
    }).catch(() => {});

    onSelect({
      url: flyer.fullUrl,
      photographer: flyer.photographer,
      photographerUrl: flyer.photographerUrl,
      downloadLocation: flyer.downloadLocation,
    });
    onClose();
  };

  const handleSelectArt = (piece: ArtPiece) => {
    onSelectArt?.(piece);
    onClose();
  };

  const renderArtTile = (piece: ArtPiece) => {
    // The world line reads "mizik" etc.; a piece from the event's own world
    // carries a dot so the organizer sees why it leads the grid.
    const label = worldLabel(piece.worlds[0]);
    const matches = !!world && (piece.worlds as string[]).includes(world);
    return (
      <TouchableOpacity
        key={piece.key}
        style={styles.tile}
        activeOpacity={0.85}
        onPress={() => handleSelectArt(piece)}
        accessibilityRole="imagebutton"
        accessibilityLabel={piece.alt}
      >
        <Image source={piece.source} style={styles.tileImage} contentFit="cover" cachePolicy="memory" />
        {!!label && (
          <>
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.72)']}
              style={styles.tileScrim}
              pointerEvents="none"
            />
            <View style={styles.credit} pointerEvents="none">
              {matches && <View style={styles.matchDot} />}
              <Text style={styles.creditText} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </>
        )}
      </TouchableOpacity>
    );
  };

  const renderPhotoTile = (item: RemoteFlyer) => (
    <TouchableOpacity
      key={item.id}
      style={styles.tile}
      activeOpacity={0.85}
      onPress={() => handleSelect(item)}
      accessibilityRole="imagebutton"
      accessibilityLabel={t('flyerLibrary.byPhotographer').replace('{name}', item.photographer)}
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
      {item.photographer ? (
        <View style={styles.credit} pointerEvents="none">
          <Camera size={11} color="#FFFFFF" />
          <Text style={styles.creditText} numberOfLines={1}>
            {item.photographer}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const grid = <T,>(items: T[], render: (item: T) => React.ReactNode) =>
    pairs(items).map((row, i) => (
      <View key={i} style={styles.gridRow}>
        {row.map(render)}
        {/* An odd last tile keeps its column width instead of stretching. */}
        {row.length === 1 && <View style={styles.tileSpacer} />}
      </View>
    ));

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
            {art.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={t('flyerLibrary.artTitle')} subtitle={t('flyerLibrary.artSubtitle')} />
                {grid(art, renderArtTile)}
              </View>
            )}

            <View style={styles.section}>
              {onSelectArt && <SectionHeader title={t('flyerLibrary.photosTitle')} />}
              {loading ? (
                <View style={styles.stateWrap}>
                  <ActivityIndicator color={colors.textSecondary} />
                </View>
              ) : !configured ? (
                <View style={styles.stateWrap}>
                  <Text style={styles.stateText}>{t('flyerLibrary.notConfigured')}</Text>
                </View>
              ) : results.length === 0 ? (
                <View style={styles.stateWrap}>
                  <Text style={styles.stateText}>{t('flyerLibrary.empty')}</Text>
                </View>
              ) : (
                grid(results, renderPhotoTile)
              )}
            </View>
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
    section: {
      marginBottom: spacing.xl,
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
    matchDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.white,
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
