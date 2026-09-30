/**
 * Keeps the app's fee terms in step with the ones the server actually charges.
 *
 * `lib/buyerPricing.ts` ships with the rates and caps that were current at build
 * time. Those go stale the moment an admin edits them, and a stale rate means the
 * app advertises one total and the card is charged another — the exact
 * total-price problem the pricing work exists to prevent. So the live config is
 * fetched at boot from `/api/platform/fee-config`.
 *
 * Cached to AsyncStorage so the FIRST paint of a cold launch uses the last known
 * terms rather than the build-time ones, and so a launch with no connection still
 * prices from something recent. The network read then refreshes it.
 *
 * Display only. The server recomputes what is charged, so a stale or absent
 * config can only mis-draw a screen — never change what a buyer pays.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setFeeConfig, type RemoteLocationFees } from './buyerPricing';

const STORAGE_KEY = 'tikem.feeConfig.v1';

const API_URL = String(
  process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_WEB_URL || 'https://www.tikem.co'
).replace(/\/$/, '');

/** A slow network must not delay the first screen; the defaults are fine meanwhile. */
const FETCH_TIMEOUT_MS = 8_000;

type RemoteFeeConfig = { haiti?: RemoteLocationFees; usCanada?: RemoteLocationFees };

function looksValid(payload: any): payload is RemoteFeeConfig {
  return !!payload && typeof payload === 'object' && (payload.haiti || payload.usCanada);
}

/**
 * Adopt the cached config, then refresh from the server. Safe to call on every
 * launch; never throws, because nothing here is worth failing a launch over.
 */
export async function refreshFeeConfig(): Promise<void> {
  // 1. Last known terms, so the first paint is not from the build-time defaults.
  try {
    const cached = await AsyncStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (looksValid(parsed)) setFeeConfig(parsed);
    }
  } catch {
    // A corrupt or unreadable cache just means we start from the defaults.
  }

  // 2. What the server charges right now.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(`${API_URL}/api/platform/fee-config`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return;

    const payload = await response.json();
    if (!looksValid(payload)) return;

    setFeeConfig(payload);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
  } catch {
    // Offline, timed out, or the endpoint is down: keep the cached/default terms.
  }
}
