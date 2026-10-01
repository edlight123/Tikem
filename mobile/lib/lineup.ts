/**
 * The event lineup — who is on the bill.
 *
 * ⚠️ MIRRORS THE WEB. This is the Expo twin of `lib/lineup.ts` in the web app
 * (mobile is a separate bundle and cannot import it). The persisted record is
 * stored on the event doc as `guestlist`, snake_case, nulls rather than empty
 * strings. The web composer, the web event page and this app all read and
 * write that one shape, so keep the field names in step with the web file.
 *
 * The record has drifted before (a bare string, then `{ name, role }`), so the
 * reader below tolerates every shape it has ever had.
 */

export type GuestRole = 'Performer' | 'Host' | 'DJ' | 'Special Guest';

export const GUEST_ROLES: readonly GuestRole[] = ['Performer', 'Host', 'DJ', 'Special Guest'];

/** i18n key suffix per role (`Special Guest` has a space, keys cannot). */
export const ROLE_LABEL_KEY: Record<GuestRole, string> = {
  Performer: 'performer',
  Host: 'host',
  DJ: 'dj',
  'Special Guest': 'specialGuest',
};

/** In-editor entry. Every field is present so inputs stay controlled. */
export interface LineupEntry {
  id: string;
  name: string;
  role: GuestRole;
  photoUrl: string;
  link: string;
  description: string;
  /** Wall-clock 'HH:mm' on the event's own evening — NOT an instant. */
  startTime: string;
  endTime: string;
}

/** The persisted record (event doc `guestlist[]`). */
export interface LineupRecord {
  name: string;
  role: GuestRole;
  photo_url: string | null;
  link: string | null;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
}

const makeId = () => Math.random().toString(36).slice(2, 9);

export const emptyLineupEntry = (): LineupEntry => ({
  id: makeId(),
  name: '',
  role: 'Performer',
  photoUrl: '',
  link: '',
  description: '',
  startTime: '',
  endTime: '',
});

function asRole(value: unknown): GuestRole {
  return (GUEST_ROLES as readonly string[]).includes(String(value)) ? (value as GuestRole) : 'Performer';
}

/** Read one persisted entry, tolerating every shape the field has had. */
export const lineupEntryFromRecord = (g: any): LineupEntry => {
  // A bare-string entry must not be read for fields: `'name'.link` is
  // String.prototype.link (a function), which would leak into the entry.
  const rec = g && typeof g === 'object' ? g : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    ...emptyLineupEntry(),
    name: typeof g === 'string' ? g : str(rec.name),
    role: asRole(rec.role),
    photoUrl: str(rec.photo_url) || str(rec.photoUrl),
    link: str(rec.link),
    description: str(rec.description),
    startTime: str(rec.start_time) || str(rec.startTime),
    endTime: str(rec.end_time) || str(rec.endTime),
  };
};

/** The save shape. Anything omitted here is erased on the next save. */
export const lineupEntryToRecord = (g: LineupEntry): LineupRecord => ({
  name: g.name.trim(),
  role: g.role,
  photo_url: g.photoUrl || null,
  link: g.link.trim() || null,
  description: g.description.trim() || null,
  start_time: g.startTime || null,
  end_time: g.endTime || null,
});

/** Parse a stored `guestlist` into named entries; [] for anything else. */
export function lineupFromEvent(guestlist: unknown): LineupEntry[] {
  if (!Array.isArray(guestlist)) return [];
  return guestlist.map(lineupEntryFromRecord).filter((g) => g.name.trim());
}

/**
 * Normalize an organizer-typed link into something safe to open. Null for
 * anything that is not plainly http(s) with a dotted host — `javascript:` and
 * friends must never reach Linking.openURL. Regex rather than `new URL`, whose
 * React Native implementation does not expose hostname/protocol reliably.
 */
export function safeLineupLink(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z][a-z0-9+.-]*:/i.test(s) ? '' : `https://${s}`;
  const match = /^https?:\/\/([^/?#\s]+)([^\s]*)$/i.exec(withScheme);
  if (!match) return null;
  const host = match[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '');
  if (!host.includes('.')) return null;
  return withScheme;
}

/** How a link reads as text: host plus path, no scheme or www. */
export function lineupLinkLabel(href: string): string {
  return href
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

/** 'HH:mm – HH:mm', either bound optional, '' when neither is set. */
export function lineupTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = (start || '').trim();
  const e = (end || '').trim();
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
}
