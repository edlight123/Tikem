/** Client for web /api/spotify/preview (kept apart from lib/spotify so that stays dependency-free). */
import { backendJson } from './api/backend';

export interface SongPreview {
  previewUrl: string;
  trackName: string;
  artistName: string;
  trackViewUrl: string | null;
}

/**
 * A 30-second clip of the track for the background player (web
 * /api/spotify/preview, which finds the same song on iTunes). Null for
 * non-tracks, no confident match, or any failure.
 */
export async function fetchSongPreview(trackId: string): Promise<SongPreview | null> {
  try {
    const res = await backendJson<{ preview?: SongPreview | null }>(
      `/api/spotify/preview?id=${encodeURIComponent(trackId)}`,
    );
    const p = res?.preview;
    return p && typeof p.previewUrl === 'string' && p.previewUrl.startsWith('https://') ? p : null;
  } catch {
    return null;
  }
}
