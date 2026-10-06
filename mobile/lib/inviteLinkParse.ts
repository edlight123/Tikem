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
