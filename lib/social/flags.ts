/**
 * Remote switches for the social-growth features, read from the same public
 * `config/auth` doc as phone sign-in (lib/auth/otp/flag.ts):
 *
 *   friend_suggestions: true   "people you may know" + "friends going"
 *   phone_link_prompt:  true   the app's "add your number" sheet (read by the app)
 *   invites:            true   event invites + personal invite links (lib/invites)
 *
 * Fails CLOSED: a missing doc, a read error or a slow Firestore all mean OFF.
 * Cached briefly so a busy endpoint does not read the doc on every call.
 */

import { adminDb } from '@/lib/firebase/admin'
import { AUTH_CONFIG_DOC } from '@/lib/auth/otp/flag'

const CACHE_MS = 30 * 1000
const READ_TIMEOUT_MS = 1500

export type SocialFlag = 'friend_suggestions' | 'phone_link_prompt' | 'invites'

/** Pure: only a literal `true` turns a switch on. */
export function socialFlagOn(data: unknown, flag: SocialFlag): boolean {
  return Boolean(data && typeof data === 'object' && (data as Record<string, unknown>)[flag] === true)
}

let cached: { data: Record<string, unknown> | null; at: number } | null = null

/** Test hook. */
export function __resetSocialFlagCache() {
  cached = null
}

async function readConfig(): Promise<Record<string, unknown> | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data
  let data: Record<string, unknown> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const snap = await Promise.race([
      adminDb.collection(AUTH_CONFIG_DOC.collection).doc(AUTH_CONFIG_DOC.id).get(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS)
      }),
    ])
    data = snap && (snap as any).exists ? ((snap as any).data() as Record<string, unknown>) || null : null
  } catch {
    data = null
  } finally {
    if (timer) clearTimeout(timer)
  }
  cached = { data, at: Date.now() }
  return data
}

export async function isSocialFlagOn(flag: SocialFlag): Promise<boolean> {
  return socialFlagOn(await readConfig(), flag)
}
