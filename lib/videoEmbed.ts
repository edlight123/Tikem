/**
 * Turn an organizer's pasted video link into something safe to embed.
 *
 * The rule that makes this safe: **the pasted URL never reaches an iframe.**
 * We recognise a provider, extract an ID against a strict character class, and
 * then BUILD the embed URL ourselves from a template. An arbitrary
 * organizer-supplied origin rendering inside the event page would be a
 * cross-origin frame we do not control — able to navigate the top window,
 * spawn dialogs, or simply serve something other than a video — and no amount
 * of `sandbox` makes that a good trade for an optional field.
 *
 * Anything we do not recognise gets no player at all; the caller falls back to
 * a plain link out, which is what the field did before.
 *
 * Providers are deliberately just two. Every one added has to be added to the
 * enforcing CSP's `frame-src` in next.config.js as well, so the list stays
 * short on purpose.
 */

export type VideoProvider = 'youtube' | 'vimeo'

export interface VideoEmbed {
  provider: VideoProvider
  /** The provider's own id, already validated against a strict charset. */
  id: string
  /** Built here from a template — never the organizer's string. */
  embedUrl: string
  /** Same, plus autoplay, for the click-to-load swap. */
  autoplayUrl: string
  /** Muted, looping autoplay for the in-view preview (browsers only autoplay muted). */
  mutedAutoplayUrl: string
  /** A still to show before playback, when the provider offers a stable one. */
  thumbnailUrl: string | null
  /** For the caption: 'youtube.com' / 'vimeo.com'. */
  host: string
}

/** 11 chars, the only shape a YouTube id has ever had. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/
/** Vimeo ids are numeric. */
const VIMEO_ID = /^\d{6,12}$/

/**
 * YouTube's no-cookie host, chosen over youtube.com: it does not set tracking
 * cookies until playback actually starts, which matters when the frame is on a
 * public page somebody may only be scrolling past.
 */
const YT_EMBED = 'https://www.youtube-nocookie.com/embed/'
const VIMEO_EMBED = 'https://player.vimeo.com/video/'

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '')
  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0]
    return YT_ID.test(id) ? id : null
  }
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtube-nocookie.com') {
    return null
  }
  // /watch?v=<id>
  const v = u.searchParams.get('v')
  if (v && YT_ID.test(v)) return v
  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
  if (m && YT_ID.test(m[1])) return m[1]
  return null
}

function vimeoId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '')
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null
  // vimeo.com/<id>, vimeo.com/channels/<name>/<id>, vimeo.com/groups/<g>/videos/<id>,
  // player.vimeo.com/video/<id>. In every shape the id is the last numeric segment.
  const segments = u.pathname.split('/').filter(Boolean)
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (VIMEO_ID.test(segments[i])) return segments[i]
  }
  return null
}

export function parseVideoEmbed(raw: string | null | undefined): VideoEmbed | null {
  const s = (raw || '').trim()
  if (!s) return null

  let u: URL
  try {
    // A bare domain gets https://, matching lib/safeUrl — people paste
    // "youtu.be/xyz" without a scheme.
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  // Only ever http(s). A `javascript:` or `data:` string would have thrown or
  // failed the host checks below, but this is the cheap explicit guard.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const yt = youtubeId(u)
  if (yt) {
    return {
      provider: 'youtube',
      id: yt,
      // rel=0 keeps the end-screen suggestions to the same channel rather than
      // sending the viewer off to unrelated video; playsinline stops iOS from
      // taking the video fullscreen the instant it starts.
      embedUrl: `${YT_EMBED}${yt}?rel=0&playsinline=1&modestbranding=1`,
      autoplayUrl: `${YT_EMBED}${yt}?rel=0&playsinline=1&modestbranding=1&autoplay=1`,
      // Browsers only autoplay MUTED video; loop needs playlist=<id> on YouTube.
      // enablejsapi lets the page pause it when it scrolls out of view.
      mutedAutoplayUrl: `${YT_EMBED}${yt}?rel=0&playsinline=1&modestbranding=1&autoplay=1&mute=1&loop=1&playlist=${yt}&enablejsapi=1`,
      // hqdefault exists for every video; maxres does not, and a missing
      // maxres returns a grey 120x90 placeholder rather than a 404, which is
      // impossible to detect and looks broken.
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      host: 'youtube.com',
    }
  }

  const vm = vimeoId(u)
  if (vm) {
    return {
      provider: 'vimeo',
      id: vm,
      embedUrl: `${VIMEO_EMBED}${vm}?dnt=1&playsinline=1`,
      autoplayUrl: `${VIMEO_EMBED}${vm}?dnt=1&playsinline=1&autoplay=1`,
      mutedAutoplayUrl: `${VIMEO_EMBED}${vm}?dnt=1&playsinline=1&autoplay=1&muted=1&loop=1`,
      // Vimeo has no stable thumbnail URL — it needs an oEmbed call per video,
      // and the third-party shortcut services are not on the CSP allowlist. So
      // the facade draws its own card instead of showing a still.
      thumbnailUrl: null,
      host: 'vimeo.com',
    }
  }

  return null
}
