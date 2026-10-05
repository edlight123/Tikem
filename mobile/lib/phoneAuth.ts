/**
 * Phone (WhatsApp code) sign-in on the app: is it on, and the API calls.
 *
 * ON requires BOTH the public remote switch `config/auth.phone_whatsapp` AND
 * the server answering 200 on /api/auth/phone/status (shouldOfferPhoneAuth).
 * Every failure is OFF, and the server is only asked once the switch is on,
 * so with the feature off the app makes one tiny Firestore read and nothing
 * on screen changes.
 *
 * The last answer is cached in memory for 5 minutes and remembered across
 * launches ONLY as a hint for the first render; it is re-checked every time a
 * screen subscribes, and a fresh "off" wins immediately.
 *
 * Dev: EXPO_PUBLIC_FORCE_PHONE_AUTH=true stands in for the remote switch in a
 * __DEV__ build (point EXPO_PUBLIC_API_URL at a local server running with
 * PHONE_AUTH_ENABLED=true). Release builds ignore it.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { API_BASE_URL, backendJson } from './api/backend';
import { shouldOfferPhoneAuth } from './phoneAuthGate';

const CACHE_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'phoneAuth.enabled.v1';
const TIMEOUT_MS = 4000;

let enabled = false;
let checkedAt = 0;
let inflight: Promise<boolean> | null = null;
let hydrated = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const forceFlag = () => process.env.EXPO_PUBLIC_FORCE_PHONE_AUTH === 'true';

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS))]);
}

async function readRemoteSwitch(): Promise<boolean> {
  try {
    const snap = await withTimeout(getDoc(doc(db, 'config', 'auth')), null);
    return Boolean(snap && snap.exists() && (snap.data() as any)?.phone_whatsapp === true);
  } catch {
    return false;
  }
}

async function readServerStatus(): Promise<boolean> {
  try {
    const res = await withTimeout(fetch(`${API_BASE_URL}/api/auth/phone/status`), null);
    if (!res || res.status !== 200) return false;
    const body = await res.json().catch(() => null);
    return body?.enabled === true;
  } catch {
    return false;
  }
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    if (!checkedAt && (await AsyncStorage.getItem(STORAGE_KEY)) === '1') {
      enabled = true;
      notify();
    }
  } catch {
    // No hint; start from OFF.
  }
}

/** Re-check both keys. Never throws; resolves to the new answer. */
export function refreshPhoneAuthEnabled(force = false): Promise<boolean> {
  if (!force && checkedAt && Date.now() - checkedAt < CACHE_MS) return Promise.resolve(enabled);
  if (inflight) return inflight;
  inflight = (async () => {
    await hydrate();
    const remoteSwitch = await readRemoteSwitch();
    const switchOn = remoteSwitch || (__DEV__ && forceFlag());
    const serverEnabled = switchOn ? await readServerStatus() : false;
    const next = shouldOfferPhoneAuth({ remoteSwitch, serverEnabled, forceFlag: forceFlag(), isDev: __DEV__ });
    checkedAt = Date.now();
    if (next !== enabled) {
      enabled = next;
      notify();
    }
    AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0').catch(() => {});
    inflight = null;
    return next;
  })();
  return inflight;
}

/** Subscribe a screen to the switch. Starts OFF and kicks off a check. */
export function usePhoneAuthEnabled(): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    refreshPhoneAuthEnabled();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return enabled;
}

// ── API ──────────────────────────────────────────────────────────────────────

export class PhoneAuthError extends Error {
  constructor(readonly code: string, readonly retryAfterSec?: number) {
    super(code);
    this.name = 'PhoneAuthError';
  }
}

async function postPublic(path: string, body: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PhoneAuthError('network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PhoneAuthError(
      res.status === 404 ? 'unavailable' : typeof data?.code === 'string' ? data.code : 'generic',
      typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : undefined,
    );
  }
  return data;
}

async function postAuthed(path: string, body: Record<string, unknown>): Promise<any> {
  try {
    return await backendJson<any>(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    const status = err?.status;
    throw new PhoneAuthError(
      status === 404 ? 'unavailable' : typeof err?.code === 'string' ? err.code : 'generic',
      typeof err?.payload?.retryAfterSec === 'number' ? err.payload.retryAfterSec : undefined,
    );
  }
}

export interface CodeSent {
  resendAfterSec: number;
  expiresInSec: number;
}

/** Ask for a sign-in code on WhatsApp. */
export function requestPhoneCode(phone: string, country: string, locale: string): Promise<CodeSent> {
  return postPublic('/api/auth/phone/start', { phone, country, locale });
}

/** Trade a code for a Firebase custom token (AuthContext signs in with it). */
export async function verifyPhoneCode(phone: string, country: string, code: string, locale: string): Promise<string> {
  const data = await postPublic('/api/auth/phone/verify', { phone, country, code, locale });
  if (typeof data?.token !== 'string') throw new PhoneAuthError('generic');
  return data.token;
}

/** Signed in: ask for a code to add this number to the account. */
export function requestLinkCode(phone: string, country: string, locale: string): Promise<CodeSent> {
  return postAuthed('/api/auth/phone/link/start', { phone, country, locale });
}

/** Signed in: confirm the code; the number is added to the account. */
export async function verifyLinkCode(phone: string, country: string, code: string): Promise<string> {
  const data = await postAuthed('/api/auth/phone/link/verify', { phone, country, code });
  return String(data?.phoneNumber || phone);
}
