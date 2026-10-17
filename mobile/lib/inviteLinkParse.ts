// Pure parsing for personal invite links (see ./inviteLink.ts). No React
// Native imports, so it is unit tested from the web Jest suite.

// Mirrors lib/invites/policy.ts (INVITE_CODE_ALPHABET, length 8).
const CODE_PATTERN = /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/;

export function normalizeInviteCode(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function safeInviteEventId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 128 && !raw.includes('/') ? raw : null;
}

/**
 * The invite in a URL, if it is one: tikem://i/{code}, https://tikem.co/i/{code}
 * or https://www.tikem.co/i/{code}, with an optional ?e={eventId}.
 */
export function parseInviteUrl(url: string | null | undefined): { code: string; eventId: string | null } | null {
  if (!url) return null;
  const m = String(url).match(/^(?:tikem:\/\/|https?:\/\/(?:www\.)?tikem\.co\/)i\/([^/?#]+)\/?(?:\?([^#]*))?/i);
  if (!m) return null;
  let code: string | null = null;
  try {
    code = normalizeInviteCode(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
  if (!code) return null;
  let eventId: string | null = null;
  for (const part of (m[2] || '').split('&')) {
    const [k, v] = part.split('=');
    if (k === 'e' && v) {
      try {
        eventId = safeInviteEventId(decodeURIComponent(v));
      } catch {
        eventId = null;
      }
    }
  }
  return { code, eventId };
}

/** Digits for whatsapp://send?phone=, only for numbers given with a country code. */
export function whatsappPhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('+')) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * A contact-book number as E.164, or '' when it cannot be read unambiguously.
 * Mirrors phoneToE164 in the web types/social.ts (the server matches on the
 * same rule): "+…"/"00…" international, 8 digits Haitian (+509), 10 digits or
 * 11 starting with 1 NANP (+1).
 */
export function contactPhoneE164(raw: string | null | undefined): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D+/g, '');
  if (!digits) return '';
  let e164 = '';
  if (s.startsWith('+')) e164 = `+${digits}`;
  else if (digits.startsWith('00')) e164 = `+${digits.slice(2)}`;
  else if (digits.length === 8) e164 = `+509${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  else return '';
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : '';
}

/** The Messages composer with `body` prefilled, to `phone` when known. iOS and Android differ on the separator. */
export function smsUrl(body: string, phone: string | null | undefined, os: 'ios' | 'android' | string): string {
  const to = contactPhoneE164(phone);
  return `sms:${to}${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

/**
 * Ids of the device contacts that are on Tikèm. Exact: a contact is matched
 * when any of its numbers is one the server echoed back for a match. A server
 * that does not echo numbers yet (before 2026-10-16) falls back to the old
 * name comparison.
 */
export function matchedContactIds(
  contacts: Array<{ id: string; name: string; phones: string[] }>,
  matches: Array<{ displayName: string; phones?: string[] }>
): Set<string> {
  const ids = new Set<string>();
  const echoed = matches.some((m) => Array.isArray(m.phones));
  if (echoed) {
    const matched = new Set(matches.flatMap((m) => m.phones || []));
    for (const c of contacts) if (c.phones.some((p) => matched.has(p))) ids.add(c.id);
    return ids;
  }
  const names = new Set(matches.map((m) => m.displayName.trim().toLowerCase()));
  for (const c of contacts) if (names.has(c.name.trim().toLowerCase())) ids.add(c.id);
  return ids;
}
