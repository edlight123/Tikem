/**
 * Is phone (WhatsApp code) sign-in switched on?
 *
 * Two keys, both required in production:
 *   1. PHONE_AUTH_ENABLED=true in the server env (a deploy-level decision), and
 *   2. the remote switch `config/auth` { phone_whatsapp: true } in Firestore
 *      (the instant kill switch: flip it to false and every route answers 404
 *      within CACHE_MS, and the app hides the UI on its next config read).
 *
 * Fails CLOSED: a missing doc, a read error or a slow Firestore all mean OFF.
 *
 * Outside production the remote switch is not required, so a local server
 * with PHONE_AUTH_ENABLED=true works without touching the prod config doc.
 */

import { adminDb } from '@/lib/firebase/admin'

type Env = Record<string, string | undefined>

export const AUTH_CONFIG_DOC = { collection: 'config', id: 'auth' } as const
const CACHE_MS = 30 * 1000
const READ_TIMEOUT_MS = 1500

export function phoneAuthEnvEnabled(env: Env = process.env): boolean {
  return env.PHONE_AUTH_ENABLED === 'true'
}

/** The pure decision, exported for tests. */
export function decidePhoneAuthEnabled(opts: {
  envEnabled: boolean
  remoteSwitch: boolean
  production: boolean
}): boolean {
  if (!opts.envEnabled) return false
  return opts.production ? opts.remoteSwitch : true
}

let cached: { value: boolean; at: number } | null = null

/** Test hook. */
export function __resetPhoneAuthFlagCache() {
  cached = null
}

async function readRemoteSwitch(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  let value = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const snap = await Promise.race([
      adminDb.collection(AUTH_CONFIG_DOC.collection).doc(AUTH_CONFIG_DOC.id).get(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS)
      }),
    ])
    value = Boolean(snap && (snap as any).exists && (snap as any).data()?.phone_whatsapp === true)
  } catch {
    value = false
  } finally {
    if (timer) clearTimeout(timer)
  }
  cached = { value, at: Date.now() }
  return value
}

export async function isPhoneAuthEnabled(env: Env = process.env): Promise<boolean> {
  if (!phoneAuthEnvEnabled(env)) return false
  const production = env.NODE_ENV === 'production'
  const remoteSwitch = production ? await readRemoteSwitch() : true
  return decidePhoneAuthEnabled({ envEnabled: true, remoteSwitch, production })
}
