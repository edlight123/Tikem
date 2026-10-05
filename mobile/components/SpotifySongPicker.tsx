/**
 * SpotifySongPicker (mobile) — the create-event canvas's song field.
 *
 * Mirrors the web composer's picker: a debounced typeahead against the web
 * app's `/api/spotify/search` route (the Client Credentials secret lives only
 * on the server, so the phone never sees it), collapsing to a compact
 * "selected song" row once a track is chosen.
 *
 * When the route has no credentials it answers 503 `not_configured`; this
 * component then silently becomes a plain paste-a-Spotify-link input, so an
 * organizer is never blocked on the owner creating a Spotify app.
 *
 * The value handed back is always `https://open.spotify.com/track/{id}` — the
 * exact shape the web event page's SpotifyEmbed parses.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';

import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';

type Colors = ReturnType<typeof useTheme>['colors'];

export type SpotifyTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  albumArt: string | null;
  url: string;
  durationMs: number;
};

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Spotify's brand green. Their guidelines keep the mark this colour rather
// than tinting it to the host UI, so it does not follow the theme's palette.
const SPOTIFY_GREEN = '#1DB954';

/** open.spotify.com/... → true. Mirrors the web parser's tolerance. */
function looksLikeSpotifyLink(raw: string): boolean {
  return /spotify\.com\/(intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/[A-Za-z0-9]{10,}/.test(
    raw.trim()
  );
}

export default function SpotifySongPicker({
  colors,
  value,
  onChange,
}: {
  colors: Colors;
  /** Current `spotify_url` — may be a link saved by an older edit. */
  value: string;
  onChange: (url: string) => void;
}) {
  const { t } = useI18n();
  // The mobile dictionaries return the key itself when a string is missing, so
  // every label carries an English fallback until the locale files catch up.
  const tr = (key: string, fallback: string) => {
    const out = t(key);
    return out === key ? fallback : out;
  };

  const [mode, setMode] = useState<'search' | 'fallback'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(false);
  // Metadata for a track picked in this session (art + artist for the selected
  // row). Absent when `value` was loaded from a saved event.
  const [picked, setPicked] = useState<SpotifyTrack | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const selected = (value || '').trim();

  useEffect(() => {
    if (mode !== 'search') return;
    const q = query.trim();

    if (q.length < MIN_QUERY) {
      abortRef.current?.abort();
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = controller;
      setLoading(true);
      try {
        const data = await backendJson<{ tracks?: SpotifyTrack[] }>(
          `/api/spotify/search?q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        setResults(Array.isArray(data?.tracks) ? data.tracks : []);
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        // 503 not_configured, 401, network trouble — all mean "search isn't
        // available"; fall back to the paste-a-link field rather than nagging.
        setMode('fallback');
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mode]);

  const choose = (track: SpotifyTrack) => {
    setPicked(track);
    onChange(track.url);
    setQuery('');
    setResults([]);
  };

  const clear = () => {
    setPicked(null);
    onChange('');
    setQuery('');
    setResults([]);
  };

  // ── Selected ────────────────────────────────────────────────────────────
  if (selected && (picked || looksLikeSpotifyLink(selected))) {
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.selectedRow}>
          {picked?.albumArt ? (
            <Image source={{ uri: picked.albumArt }} style={styles.art} contentFit="cover" />
          ) : (
            <View style={[styles.art, styles.artFallback, { borderColor: colors.border }]}>
              <Ionicons name="musical-notes-outline" size={16} color={colors.textSecondary} />
            </View>
          )}

          <View style={styles.selectedText}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {picked?.name || selected}
            </Text>
            <Text numberOfLines={1} style={[styles.sub, { color: colors.textSecondary }]}>
              {picked
                ? `${picked.artists}${picked.durationMs ? ` · ${formatDuration(picked.durationMs)}` : ''}`
                : tr('organizerCreateEventFlow.canvas.spotifyPastedLink', 'Spotify link')}
            </Text>
          </View>

          <TouchableOpacity onPress={clear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.change, { color: colors.primary }]}>
              {tr('organizerCreateEventFlow.canvas.spotifyChange', 'Change')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={clear}
            accessibilityLabel={tr('organizerCreateEventFlow.canvas.spotifyRemove', 'Remove song')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.removeBtn}
          >
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Fallback: paste a link ──────────────────────────────────────────────
  if (mode === 'fallback') {
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder={tr('organizerCreateEventFlow.canvas.spotifyPlaceholder', 'Add song from Spotify')}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.primary}
          value={value}
          onChangeText={onChange}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {tr(
            'organizerCreateEventFlow.canvas.spotifySearchUnavailable',
            'Song search needs setup. Paste a Spotify link for now.'
          )}
        </Text>
      </View>
    );
  }

  // ── Search ──────────────────────────────────────────────────────────────
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.searchRow}>
        {/* The brand mark, in Spotify green: it says both "search" and "search
            Spotify" in one glyph, and the row had no leading icon at all. */}
        <FontAwesome5 name="spotify" size={19} color={SPOTIFY_GREEN} />
        <TextInput
          style={[styles.input, styles.searchInput, { color: colors.text }]}
          placeholder={tr('organizerCreateEventFlow.canvas.spotifySearchPlaceholder', 'Search a song on Spotify')}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.primary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="search"
        />
        {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>

      {query.trim().length >= MIN_QUERY && !loading && results.length === 0 ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {tr('organizerCreateEventFlow.canvas.spotifyNoResults', 'No songs found.')}
        </Text>
      ) : null}

      {results.map((track) => (
        <TouchableOpacity
          key={track.id}
          onPress={() => choose(track)}
          activeOpacity={0.7}
          style={styles.resultRow}
          accessibilityRole="button"
        >
          {track.albumArt ? (
            <Image source={{ uri: track.albumArt }} style={styles.art} contentFit="cover" />
          ) : (
            <View style={[styles.art, styles.artFallback, { borderColor: colors.border }]}>
              <Ionicons name="musical-notes-outline" size={16} color={colors.textSecondary} />
            </View>
          )}
          <View style={styles.selectedText}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {track.name}
            </Text>
            <Text numberOfLines={1} style={[styles.sub, { color: colors.textSecondary }]}>
              {track.artists}
            </Text>
          </View>
          <Text style={[styles.duration, { color: colors.textTertiary }]}>
            {formatDuration(track.durationMs)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Matches the canvas's borderless inline rows (see InlineTextRow in
// CreateEventFlowRefactored): hairline divider below, no box, no fills.
const styles = StyleSheet.create({
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    fontSize: 17,
    padding: 0,
  },
  searchInput: {
    flex: 1,
  },
  hint: {
    fontSize: 12,
    marginTop: 8,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
  },
  art: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  artFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectedText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
  },
  sub: {
    fontSize: 12,
    marginTop: 2,
  },
  duration: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  change: {
    fontSize: 13,
  },
  removeBtn: {
    paddingLeft: 2,
  },
});
