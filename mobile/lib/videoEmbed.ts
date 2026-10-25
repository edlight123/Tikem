/**
 * Promo-video link → a safe embed URL. Mobile's copy of `lib/videoEmbed.ts`.
 *
 * Duplicated, not shared, and deliberately: the Expo app has no path alias
 * into the Next app's `lib/` (no monorepo wiring), so the alternative to a copy
 * is an import that does not resolve. **If you change the parsing rules here,
 * change them there too** — the two are meant to accept exactly the same set
 * of links, so an organizer's URL never plays on one platform and fails on the
 * other.
 *
 * The rule that makes this safe is the same on both: the pasted URL never
 * reaches a WebView. We recognise a provider, extract an id against a strict
 * character class, and BUILD the URL from a template. Anything unrecognised
 * gets no player and falls back to opening the link, which is honest for a URL
 * we cannot vouch for.
 */

export type VideoProvider = 'youtube' | 'vimeo';

export interface VideoEmbed {
  provider: VideoProvider;
  id: string;
  /** Built here from a template — never the organizer's string. */
  embedUrl: string;
  /** Muted, looping, inline: the silent preview on the event page. */
  mutedEmbedUrl: string;
  /** A still for the card (YouTube only; Vimeo has no stable one). */
  thumbnailUrl: string | null;
  host: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

/**
 * `playsinline=1` matters more here than on the web: without it iOS hands the
 * video to the native fullscreen player, which is the "leaving the app" feel
 * this change exists to remove.
 */
const YT_EMBED = 'https://www.youtube-nocookie.com/embed/';
const VIMEO_EMBED = 'https://player.vimeo.com/video/';

function hostname(u: string): string {
  const m = u.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

function param(u: string, key: string): string | null {
  const m = u.match(new RegExp('[?&]' + key + '=([^&#]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function path(u: string): string {
  const m = u.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i);
  return m && m[1] ? m[1] : '/';
}

export function parseVideoEmbed(raw: string | null | undefined): VideoEmbed | null {
  const s = (raw || '').trim();
  if (!s) return null;
  // A bare domain gets https://; anything carrying another scheme is rejected.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  const url = hasScheme ? s : `https://${s}`;
  if (!/^https?:\/\//i.test(url)) return null;

  const host = hostname(url);
  const p = path(url);

  // ---- YouTube ----
  if (host === 'youtu.be') {
    const id = p.slice(1).split('/')[0];
    if (YT_ID.test(id)) return yt(id);
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = param(url, 'v');
    if (v && YT_ID.test(v)) return yt(v);
    const m = p.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
    if (m && YT_ID.test(m[1])) return yt(m[1]);
  }

  // ---- Vimeo: the id is the last numeric path segment in every URL shape ----
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const segments = p.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (VIMEO_ID.test(segments[i])) {
        return {
          provider: 'vimeo',
          id: segments[i],
          embedUrl: `${VIMEO_EMBED}${segments[i]}?dnt=1&playsinline=1&autoplay=1`,
          mutedEmbedUrl: `${VIMEO_EMBED}${segments[i]}?dnt=1&playsinline=1&autoplay=1&muted=1&loop=1&background=1`,
          thumbnailUrl: null,
          host: 'vimeo.com',
        };
      }
    }
  }

  return null;
}

function yt(id: string): VideoEmbed {
  return {
    provider: 'youtube',
    id,
    embedUrl: `${YT_EMBED}${id}?rel=0&playsinline=1&modestbranding=1&autoplay=1`,
    mutedEmbedUrl: `${YT_EMBED}${id}?rel=0&playsinline=1&modestbranding=1&autoplay=1&mute=1&loop=1&playlist=${id}&controls=0`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    host: 'youtube.com',
  };
}
