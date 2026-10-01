/**
 * The event's song, as a track card that opens Spotify.
 *
 * The web renders Spotify's iframe embed (components/events/SpotifyEmbed). On
 * a phone that iframe is a heavy, off-brand green slab that plays only a
 * preview, so here the same `spotify_url` becomes a quiet card instead —
 * artwork, title and a play affordance — and a tap hands off to the Spotify
 * app (or the web player). Title and artwork come from Spotify's public oEmbed
 * endpoint, since the composer stores only the link; until it answers (or if
 * it never does) the card still renders with a generic face.
 *
 * Renders nothing for a missing or unparseable link.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import { fetchSpotifyOEmbed, parseSpotifyUrl, spotifyOpenUrl, type SpotifyOEmbed } from '../lib/spotify';
import { radius } from '../theme/tokens';

// Spotify's brand green: their guidelines keep the mark this colour rather
// than tinting it to the host UI (same rule as SpotifySongPicker).
const SPOTIFY_GREEN = '#1DB954';

export default function SpotifyTrackCard({ url }: { url?: string | null }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const parsed = useMemo(() => parseSpotifyUrl(url), [url]);
  const openUrl = parsed ? spotifyOpenUrl(parsed) : null;
  const [meta, setMeta] = useState<SpotifyOEmbed | null>(null);

  useEffect(() => {
    setMeta(null);
    if (!openUrl) return;
    const controller = new AbortController();
    fetchSpotifyOEmbed(openUrl, controller.signal).then((m) => {
      if (!controller.signal.aborted) setMeta(m);
    });
    return () => controller.abort();
  }, [openUrl]);

  if (!openUrl) return null;

  const title = meta?.title || t('eventDetail.song.fallbackTitle');

  return (
    <View style={styles.section}>
      <SectionHeader title={t('eventDetail.song.title')} />
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => Linking.openURL(openUrl).catch(() => undefined)}
        accessibilityRole="link"
        accessibilityLabel={`${t('eventDetail.song.open')}: ${title}`}
      >
        <View style={styles.art}>
          {meta?.thumbnailUrl ? (
            <Image
              source={{ uri: meta.thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : (
            <FontAwesome5 name="spotify" size={26} color={SPOTIFY_GREEN} />
          )}
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.sourceRow}>
            <FontAwesome5 name="spotify" size={12} color={SPOTIFY_GREEN} />
            <Text style={styles.source}>{t('eventDetail.song.onSpotify')}</Text>
          </View>
        </View>
        <View style={styles.play}>
          <Ionicons name="play" size={18} color={colors.text} style={styles.playGlyph} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    section: { paddingTop: 22, paddingBottom: 6 },
    // A filled card one step off the canvas — no outline.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    art: {
      width: 64,
      height: 64,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { flex: 1, minWidth: 0, gap: 6 },
    title: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.text },
    sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    source: { fontSize: 12, color: colors.textSecondary },
    play: {
      width: 42,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The play triangle's optical centre sits left of its box.
    playGlyph: { marginLeft: 2 },
  });
