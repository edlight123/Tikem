/**
 * Spotify link helpers for the event page's song card.
 *
 * Mirrors `parseSpotifyUrl` in the web's components/events/SpotifyEmbed.tsx:
 * open.spotify.com/{type}/{id}, intl path prefixes and query strings tolerated.
 * Regex rather than `new URL` (React Native's URL lacks hostname/pathname).
 */

const TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'] as const;
export type SpotifyKind = (typeof TYPES)[number];

export function parseSpotifyUrl(raw?: string | null): { type: SpotifyKind; id: string } | null {
  if (!raw) return null;
  const match = /^https?:\/\/([a-z0-9.-]+)(\/[^?#\s]*)/i.exec(raw.trim());
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!(host === 'spotify.com' || host.endsWith('.spotify.com'))) return null;
  const parts = match[2].split('/').filter(Boolean);
  const i = parts.findIndex((p) => (TYPES as readonly string[]).includes(p));
  const id = i >= 0 ? parts[i + 1] : '';
  if (i < 0 || !/^[A-Za-z0-9]{10,}$/.test(id || '')) return null;
  return { type: parts[i] as SpotifyKind, id };
}

/** The canonical open.spotify.com link — opens the Spotify app when installed. */
export function spotifyOpenUrl(parsed: { type: string; id: string }): string {
  return `https://open.spotify.com/${parsed.type}/${parsed.id}`;
}

export interface SpotifyOEmbed {
  title: string;
  thumbnailUrl: string | null;
}

/**
 * Title + artwork via Spotify's public oEmbed endpoint (no credentials). The
 * composer stores only the link, so this is how the card gets a face. Null on
 * any failure — the caller renders a quiet fallback rather than nothing.
 */
export async function fetchSpotifyOEmbed(url: string, signal?: AbortSignal): Promise<SpotifyOEmbed | null> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { signal });
    if (!res.ok) return null;
    const body = await res.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) return null;
    return {
      title,
      thumbnailUrl: typeof body?.thumbnail_url === 'string' ? body.thumbnail_url : null,
    };
  } catch {
    return null;
  }
}
