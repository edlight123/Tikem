/**
 * The event's song, as a track card that plays inside the app.
 *
 * When the song is a track we can find a 30-second clip for (Apple's preview
 * of the same song, via web /api/spotify/preview), it plays in the background
 * as soon as the event page opens: no Spotify player on screen (owner
 * feedback 2026-10-25). The clip plays through a hidden WebView's <audio>, so
 * it ships over the air with no new native module, and asks iOS for the
 * "ambient" audio session, which respects the silent switch and mixes with
 * whatever the person is already listening to. A profile toggle ("Play event
 * songs", on by default, lib/songAutoplay) turns the autoplay off; the play
 * tile then starts the same clip on a tap. The tile pauses and resumes it.
 * Leaving the screen or the app stops it.
 *
 * With no clip (albums, playlists, a song iTunes does not carry) the card
 * falls back to Spotify's official embed on tap, which must stay visible
 * under Spotify's terms. Title and artwork come from Spotify's public oEmbed
 * endpoint, since the composer stores only the link.
 *
 * Renders nothing for a missing or unparseable link.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import { fetchSpotifyOEmbed, parseSpotifyUrl, spotifyOpenUrl, type SpotifyOEmbed } from '../lib/spotify';
import { fetchSongPreview, type SongPreview } from '../lib/songPreview';
import { useSongAutoplayAllowed } from '../lib/songAutoplay';
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

/**
 * A page holding one <audio> for the clip. The app drives it with
 * window.tk(cmd) and hears back 'playing' / 'paused' / 'ended' / 'blocked'.
 * `ambient` (where WebKit supports navigator.audioSession) keeps an autoplay
 * silent on a muted phone; a tap asks for `playback` so it is heard anyway.
 */
function clipHtml(src: string): string {
  return `<!doctype html><html><body>
<audio id="a" src=${JSON.stringify(src)} preload="auto" playsinline></audio>
<script>
var a = document.getElementById('a');
function send(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(m); }
function session(t) { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch (e) {} }
['playing', 'pause', 'ended'].forEach(function (ev) {
  a.addEventListener(ev, function () { send(ev === 'pause' && !a.ended ? 'paused' : ev); });
});
a.addEventListener('error', function () { send('blocked'); });
window.tk = function (cmd) {
  if (cmd === 'pause') { a.pause(); return; }
  session(cmd === 'auto' ? 'ambient' : 'playback');
  if (a.ended) a.currentTime = 0;
  var p = a.play();
  if (p && p.catch) p.catch(function () { send('blocked'); });
};
send('ready');
</script></body></html>`;
}

type ClipState = 'idle' | 'playing' | 'paused' | 'ended';

export default function SpotifyTrackCard({ url }: { url?: string | null }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const parsed = useMemo(() => parseSpotifyUrl(url), [url]);
  const openUrl = parsed ? spotifyOpenUrl(parsed) : null;
  const [meta, setMeta] = useState<SpotifyOEmbed | null>(null);
  const [playing, setPlaying] = useState(false);
  const isFocused = useIsFocused();
  const autoplayAllowed = useSongAutoplayAllowed();

  // undefined = still looking, null = no clip for this song.
  const [preview, setPreview] = useState<SongPreview | null | undefined>(undefined);
  const [clip, setClip] = useState<ClipState>('idle');
  const clipRef = useRef<WebView>(null);
  const clipReady = useRef(false);
  // Autoplay at most once per visit to the page, never after a manual pause.
  const autoplayed = useRef(false);

  const command = useCallback((cmd: 'auto' | 'play' | 'pause') => {
    clipRef.current?.injectJavaScript(`window.tk && window.tk(${JSON.stringify(cmd)}); true;`);
  }, []);

  useEffect(() => {
    setPreview(undefined);
    setClip('idle');
    clipReady.current = false;
    autoplayed.current = false;
    if (parsed?.type !== 'track') {
      setPreview(null);
      return;
    }
    let live = true;
    fetchSongPreview(parsed.id).then((p) => {
      if (live) setPreview(p);
    });
    return () => {
      live = false;
    };
  }, [parsed?.type, parsed?.id]);

  const maybeAutoplay = useCallback(() => {
    if (autoplayed.current || !clipReady.current || !autoplayAllowed || !isFocused) return;
    if (AppState.currentState !== 'active') return;
    autoplayed.current = true;
    command('auto');
  }, [autoplayAllowed, isFocused, command]);

  useEffect(() => {
    maybeAutoplay();
  }, [maybeAutoplay]);

  // Leaving the event page (a pushed screen, a tab switch) stops the sound:
  // the embed unmounts, the clip pauses. Coming back does not restart it.
  useEffect(() => {
    if (!isFocused) {
      setPlaying(false);
      command('pause');
    }
  }, [isFocused, command]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') command('pause');
    });
    return () => sub.remove();
  }, [command]);

  const onClipMessage = useCallback(
    (data: string) => {
      if (data === 'ready') {
        clipReady.current = true;
        maybeAutoplay();
      } else if (data === 'playing' || data === 'paused' || data === 'ended') {
        setClip(data);
      } else if (data === 'blocked') {
        setClip('idle');
      }
    },
    [maybeAutoplay],
  );

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
  const hasClip = !!preview;
  const clipPlaying = hasClip && clip === 'playing';
  const onPressCard = () => {
    if (!hasClip) {
      // Still looking for a clip, or there is none: Spotify's own player.
      setPlaying(true);
      return;
    }
    autoplayed.current = true;
    command(clipPlaying ? 'pause' : 'play');
  };

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
        onPress={onPressCard}
        accessibilityRole="button"
        accessibilityLabel={`${t(clipPlaying ? 'eventDetail.song.pause' : 'eventDetail.song.play')}: ${title}`}
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
            {clipPlaying ? (
              <>
                <View style={styles.liveDot} />
                <Text style={styles.source}>{t('eventDetail.song.nowPlaying')}</Text>
              </>
            ) : (
              <>
                <FontAwesome5 name="spotify" size={12} color={SPOTIFY_GREEN} />
                <Text style={styles.source}>{t('eventDetail.song.onSpotify')}</Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.play}>
          <Ionicons
            name={clipPlaying ? 'pause' : 'play'}
            size={18}
            color={colors.text}
            style={clipPlaying ? undefined : styles.playGlyph}
          />
        </View>
      </TouchableOpacity>
      {hasClip && clipPlaying ? (
        <TouchableOpacity onPress={openInSpotify} style={styles.openLink} accessibilityRole="link" hitSlop={8}>
          <FontAwesome5 name="spotify" size={12} color={SPOTIFY_GREEN} />
          <Text style={styles.openLinkText}>{t('eventDetail.song.fullSong')}</Text>
        </TouchableOpacity>
      ) : null}
      {preview ? (
        // The clip's player: invisible, one point square, never touchable.
        <View pointerEvents="none" style={styles.clipHost}>
          <WebView
            ref={clipRef}
            source={{ html: clipHtml(preview.previewUrl), baseUrl: 'https://www.tikem.co' }}
            originWhitelist={['*']}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            onMessage={(e) => onClipMessage(e.nativeEvent.data)}
            // Belt and braces: the page's own 'ready' can race the bridge.
            onLoadEnd={() => onClipMessage('ready')}
            style={styles.clipWeb}
          />
        </View>
      ) : null}
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
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
    clipHost: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', left: 0, bottom: 0 },
    clipWeb: { width: 1, height: 1, backgroundColor: 'transparent' },
    openLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
    openLinkText: { fontSize: 13, color: colors.textSecondary },
  });
