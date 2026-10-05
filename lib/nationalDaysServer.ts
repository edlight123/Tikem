// Server-side read of the national-day remote control (`config/national_days`)
// and the one call the pages make: which day is active right now.
//
// The doc is optional. It is read through a 5-minute cache with a short
// timeout, and any failure (missing doc, no credentials locally, a slow
// Firestore) falls back to the built-in calendar, so the homepage never
// waits on it or breaks because of it.

import 'server-only'
import { unstable_cache } from 'next/cache'
import { adminDb } from '@/lib/firebase/admin'
import {
  activeNationalDay,
  type ActiveNationalDay,
  type NationalDayConfig,
} from '@/lib/nationalDays'

const READ_TIMEOUT_MS = 1500

const readConfig = unstable_cache(
  async (): Promise<NationalDayConfig | null> => {
    const snap = await adminDb.collection('config').doc('national_days').get()
    return snap.exists ? ((snap.data() as NationalDayConfig) ?? null) : null
  },
  ['national-days-config'],
  { revalidate: 300, tags: ['national-days'] }
)

export async function getNationalDayConfig(): Promise<NationalDayConfig | null> {
  try {
    return await Promise.race([
      readConfig(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ])
  } catch (error) {
    console.warn('[nationalDays] config read failed, using the built-in calendar', error)
    return null
  }
}

/**
 * Dev preview: `?nd=vertieres` forces a day on. Ignored in production builds,
 * so a shared link can never switch the theme on for real visitors.
 */
export function nationalDayPreviewKey(param: unknown): string | null {
  if (process.env.NODE_ENV === 'production') return null
  return typeof param === 'string' && /^[a-z]{2,24}$/.test(param) ? param : null
}

export async function getActiveNationalDay(
  now: Date = new Date(),
  previewKey?: string | null
): Promise<{ active: ActiveNationalDay | null; config: NationalDayConfig | null }> {
  const config = await getNationalDayConfig()
  return { active: activeNationalDay(now, config, { force: previewKey ?? null }), config }
}
