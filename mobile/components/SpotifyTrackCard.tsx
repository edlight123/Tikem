/**
 * The event's song, as a track card that plays inside the app.
 *
 * At rest it is a quiet card (artwork, title, a play tile) rather than
 * Spotify's heavy iframe slab. Tapping play swaps in Spotify's official embed
 * player, in a WebView, and starts it through their iFrame API, so the song
 * plays right on the event page instead of throwing people out to Spotify
 * (owner feedback 2026-10-25). The player stays visible while it plays: their
 * terms do not allow driving a hidden embed. Without a Spotify login in the
 * WebView the embed plays Spotify's 30-second preview, so an "Open in
 * Spotify" link stays under it for the full song. Nothing autoplays: sound
 * only starts on a tap. Leaving the screen folds the player back into the
 * card, which stops it. Title and artwork come from Spotify's public oEmbed
 * endpoint, since the composer stores only the link; until it answers (or if
 * it never does) the card still renders with a generic face.
 *
 * Renders nothing for a missing or unparseable link.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useIsFocused } from '@react-navigation/native';
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

// Spotify's standard embed height (artwork, title, scrubber).
const PLAYER_HEIGHT = 152;

/** A page holding only the embed, started through Spotify's iFrame API. */
function playerHtml(uri: string, background: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:${background};overflow:hidden}</style></head>
<body><div id="e"></div>
<script>
window.onSpotifyIframeApiReady = function (API) {
  API.createController(document.getElementById('e'), { uri: ${JSON.stringify(uri)}, width: '100%', height: ${PLAYER_HEIGHT} },
    function (c) { c.addListener('ready', function () { c.play(); }); });
};
</script>
<script src="https://open.spotify.com/embed/iframe-api/v1" async></script>
</body></html>`;
}

export default function SpotifyTrackCard({ url }: { url?: string | null }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const parsed = useMemo(() => parseSpotifyUrl(url), [url]);
  const openUrl = parsed ? spotifyOpenUrl(parsed) : null;
  const [meta, setMeta] = useState<SpotifyOEmbed | null>(null);
  const [playing, setPlaying] = useState(false);
  const isFocused = useIsFocused();

  // Leaving the event page (a pushed screen, a tab switch) unmounts the
  // player, which stops the audio.
  useEffect(() => {
    if (!isFocused) setPlaying(false);
  }, [isFocused]);

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
  const openInSpotify = () => Linking.openURL(openUrl).catch(() => undefined);

  if (playing && parsed) {
    return (
      <View style={styles.section}>
        <SectionHeader title={t('eventDetail.song.title')} />
        <View style={styles.player}>
          <WebView
            source={{ html: playerHtml(`spotify:${parsed.type}:${parsed.id}`, colors.surface), baseUrl: 'https://www.tikem.co' }}
            originWhitelist={['*']}
            style={styles.playerWeb}
            scrollEnabled={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.playerLoading}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            )}
            // The embed's own links ("Save on Spotify", the logo) would load
            // Spotify's site inside this 152pt frame: hand those to the app.
            onShouldStartLoadWithRequest={(req) => {
              if (req.isTopFrame === false || req.url === 'about:blank' || req.url.startsWith('https://www.tikem.co')) {
                return true;
              }
              Linking.openURL(req.url).catch(() => undefined);
              return false;
            }}
          />
        </View>
        <TouchableOpacity onPress={openInSpotify} style={styles.openLink} accessibilityRole="link" hitSlop={8}>
          <FontAwesome5 name="spotify" size={12} color={SPOTIFY_GREEN} />
          <Text style={styles.openLinkText}>{t('eventDetail.song.fullSong')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title={t('eventDetail.song.title')} />
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => setPlaying(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t('eventDetail.song.play')}: ${title}`}
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
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The play triangle's optical centre sits left of its box.
    playGlyph: { marginLeft: 2 },
    // Same filled surface and radius as the card it replaces.
    player: {
      height: PLAYER_HEIGHT,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    playerWeb: { flex: 1, backgroundColor: 'transparent' },
    playerLoading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    openLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
    openLinkText: { fontSize: 13, color: colors.textSecondary },
  });
