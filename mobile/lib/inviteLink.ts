// Personal invite links (web lib/invites): tikem://i/{code}[?e={eventId}] and
// https://www.tikem.co/i/{code}. Opening one saves the code (30 days) so the
// account created afterwards can be credited to the friend who shared it
// (POST /api/invites/claim, called once signed in). Same posture as
// lib/promoterRef.ts: storage failures are swallowed, attribution never blocks.
//
// Also the WhatsApp helper used to invite people who are not on Tikèm.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Share } from 'react-native';
import { normalizeInviteCode, safeInviteEventId, whatsappPhone } from './inviteLinkParse';

export { normalizeInviteCode, parseInviteUrl, whatsappPhone } from './inviteLinkParse';

const KEY = '@Tikem:inviteCode';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function savePendingInviteCode(code: string, eventId: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ code, eventId, at: Date.now() }));
  } catch {
    // best-effort
  }
}

export async function getPendingInviteCode(): Promise<{ code: string; eventId: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const code = normalizeInviteCode(parsed?.code);
    const at = Number(parsed?.at);
    if (!code || !Number.isFinite(at) || Date.now() - at > TTL_MS) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return { code, eventId: safeInviteEventId(parsed?.eventId) };
  } catch {
    return null;
  }
}

export async function clearPendingInviteCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}

/**
 * Open WhatsApp with `text` prefilled (to `phone` when known), falling back to
 * the system share sheet when WhatsApp is not installed.
 */
export async function openWhatsAppInvite(text: string, phone?: string | null): Promise<void> {
  const to = whatsappPhone(phone);
  const url = `whatsapp://send?${to ? `phone=${to}&` : ''}text=${encodeURIComponent(text)}`;
  // openURL directly, not canOpenURL first: canOpenURL needs the scheme listed
  // in LSApplicationQueriesSchemes / Android <queries> (a native build), while
  // openURL simply rejects when WhatsApp is missing.
  try {
    await Linking.openURL(url);
    return;
  } catch {
    // fall through to the share sheet
  }
  try {
    await Share.share({ message: text });
  } catch {
    // dismissed
  }
}
