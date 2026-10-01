// Visit attribution for event links the app intercepts (universal links).
//
// Mirrors the client half of the web's lib/attribution.ts + lib/attribution-
// client.ts (separate package — no shared imports; __tests__/mobile-
// attribution.test.ts keeps the two in step). React Navigation delivers the
// link's query string as route params, so `t`, `ref` and `utm_*` arrive on
// EventDetail's route.params. The attribution itself is held IN MEMORY by the
// screen and threaded into every purchase body; only the click-dedupe stamp is
// persisted (AsyncStorage), because the app has no cookie jar the click
// endpoint could use.
//
// Like promoterRef.ts: every function swallows failures — attribution must
// never block opening an event or buying a ticket.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Attribution {
  tracking_link_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  promoter_ref: string | null;
}

export const CLICK_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

const TRACKING_LINK_ID_PATTERN = /^[A-Za-z0-9]{8,40}$/;
const PROMOTER_REF_PATTERN = /^[A-Z0-9_-]{2,24}$/;
const UTM_MAX_LENGTH = 100;
const CLICK_KEY_PREFIX = '@Tikem:click:';

const API_URL = String(
  process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_WEB_URL || 'https://www.tikem.co'
).replace(/\/$/, '');

export function normalizeTrackingLinkId(raw: unknown): string | null {
  const id = String(raw ?? '').trim();
  return TRACKING_LINK_ID_PATTERN.test(id) ? id : null;
}

function normalizeRef(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toUpperCase();
  return PROMOTER_REF_PATTERN.test(code) ? code : null;
}

function cleanUtm(raw: unknown): string | null {
  if (raw == null) return null;
  // eslint-disable-next-line no-control-regex
  const v = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, UTM_MAX_LENGTH);
  return v || null;
}

/** Route params (or any loose object) → Attribution, or null when empty. */
export function attributionFromParams(params: Record<string, unknown> | null | undefined): Attribution | null {
  if (!params) return null;
  const a: Attribution = {
    tracking_link_id: normalizeTrackingLinkId(params.t),
    utm_source: cleanUtm(params.utm_source),
    utm_medium: cleanUtm(params.utm_medium),
    utm_campaign: cleanUtm(params.utm_campaign),
    promoter_ref: normalizeRef(params.ref),
  };
  const empty = !a.tracking_link_id && !a.utm_source && !a.utm_medium && !a.utm_campaign && !a.promoter_ref;
  return empty ? null : a;
}

/** Same key shape as the web's clickDedupeKey. */
export function clickDedupeKey(eventId: string, a: Pick<Attribution, 'tracking_link_id' | 'promoter_ref'>): string | null {
  const id = normalizeTrackingLinkId(a.tracking_link_id);
  if (id) return `t_${id}`;
  const ref = normalizeRef(a.promoter_ref);
  if (ref && eventId) return `r_${String(eventId).replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}_${ref}`;
  return null;
}

export function shouldSendClick(lastSentAt: number | null | undefined, now: number = Date.now()): boolean {
  const last = Number(lastSentAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  if (last > now) return true;
  return now - last >= CLICK_DEDUPE_WINDOW_MS;
}

/**
 * Count one click for the link this deep link came through — at most once per
 * device per link per 30 minutes. Fire-and-forget: never awaited by the UI.
 */
export async function sendClickOnce(eventId: string, a: Attribution | null): Promise<boolean> {
  if (!a || !eventId) return false;
  const key = clickDedupeKey(eventId, a);
  if (!key) return false;
  const storageKey = `${CLICK_KEY_PREFIX}${key}`;
  const now = Date.now();
  try {
    const last = Number(await AsyncStorage.getItem(storageKey));
    if (!shouldSendClick(last, now)) return false;
    await AsyncStorage.setItem(storageKey, String(now));
  } catch {
    // Storage unavailable — still send; the server throttles per IP.
  }
  try {
    await fetch(`${API_URL}/api/track/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        ...(a.tracking_link_id ? { t: a.tracking_link_id } : {}),
        ...(a.promoter_ref ? { ref: a.promoter_ref } : {}),
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/** Orders ÷ clicks, capped at 100%; "—" when there are no clicks yet. */
export function formatConversion(orders: number, clicks: number): string {
  const o = Math.max(0, Number(orders) || 0);
  const c = Math.max(0, Number(clicks) || 0);
  if (c <= 0) return '—';
  const pct = Math.min(1, o / c) * 100;
  return `${pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
}
