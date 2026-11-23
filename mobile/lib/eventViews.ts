// Event page views: the app half of the web's lib/events/views.ts.
//
// pingEventView: one fire-and-forget POST when an event screen opens. The
// server counts one view per viewer per event per day and skips the
// organizer's and the team's own visits, so the app need not dedupe. Viewer
// identity: the signed-in user's ID token when there is one (backendFetch
// attaches it), plus an opaque random device id kept in AsyncStorage (no
// personal data). Every failure is swallowed.
//
// getEventViews: { total, today } for the event's organizer/team.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { backendFetch, backendJson } from './api/backend';

const DEVICE_KEY = '@Tikem:viewerDeviceId';
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

let cachedDeviceId: string | null = null;

function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function deviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) {
      cachedDeviceId = stored;
      return stored;
    }
  } catch {
    // fall through to a fresh id
  }
  const fresh = randomId();
  cachedDeviceId = fresh;
  try {
    await AsyncStorage.setItem(DEVICE_KEY, fresh);
  } catch {
    // an unsaved id still works for this session
  }
  return fresh;
}

export async function pingEventView(eventId: string): Promise<void> {
  try {
    if (!eventId) return;
    await backendFetch(`/api/events/${encodeURIComponent(eventId)}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: await deviceId() }),
    });
  } catch {
    // never matters to the viewer
  }
}

export interface EventViews {
  total: number;
  today: number;
}

/** Organizer/team only (the server checks). Null when unavailable. */
export async function getEventViews(eventId: string): Promise<EventViews | null> {
  try {
    const res = await backendJson<EventViews>(`/api/events/${encodeURIComponent(eventId)}/views`);
    return { total: Number(res?.total || 0), today: Number(res?.today || 0) };
  } catch {
    return null;
  }
}
