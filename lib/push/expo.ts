import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import {
  buildExpoMessages,
  failureLog,
  isExpoPushToken,
  readExpoReceipts,
  readExpoTickets,
  scrubForLog,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from '@/lib/push/expo-messages'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
/** Expo usually has receipts a few seconds after the send. */
const RECEIPT_DELAY_MS = 4000
/** Expo takes up to 1000 receipt ids per request. */
const RECEIPT_BATCH = 1000

async function getUserExpoPushTokens(userId: string): Promise<string[]> {
  const snap = await adminDb.collection('users').doc(userId).get()
  if (!snap.exists) return []
  const data = snap.data() as any
  const raw = Array.isArray(data?.expo_push_tokens) ? data.expo_push_tokens : []
  return raw.filter(isExpoPushToken)
}

async function removeUserExpoPushToken(userId: string, token: string) {
  await adminDb
    .collection('users')
    .doc(userId)
    .set({ expo_push_tokens: FieldValue.arrayRemove(token) }, { merge: true })
}

export type AppPlatform = 'ios' | 'android'

export function parseAppPlatform(value: unknown): AppPlatform | null {
  return value === 'ios' || value === 'android' ? value : null
}

export async function registerUserExpoPushToken(userId: string, token: string, platform: AppPlatform | null = null) {
  if (!isExpoPushToken(token)) {
    throw new Error('Invalid Expo push token')
  }

  // Which app (iPhone or Android) this person uses, so installs can be counted
  // per platform from our own data. Older app builds send no platform.
  const platformFields = platform
    ? { app_platforms: FieldValue.arrayUnion(platform), last_app_platform: platform }
    : {}

  await adminDb
    .collection('users')
    .doc(userId)
    .set(
      {
        expo_push_tokens: FieldValue.arrayUnion(token),
        expo_push_tokens_updated_at: FieldValue.serverTimestamp(),
        ...platformFields,
      },
      { merge: true }
    )

  // An Expo token identifies a DEVICE, not a person. If another account last
  // used this phone (and its sign-out could not reach us, e.g. offline), it
  // still holds the token and would keep receiving pushes here. Detach it from
  // every other user. Best-effort: the registration itself already succeeded.
  try {
    const holders = await adminDb
      .collection('users')
      .where('expo_push_tokens', 'array-contains', token)
      .limit(20)
      .get()
    await Promise.all(
      holders.docs
        .filter((d: QueryDocumentSnapshot) => d.id !== userId)
        .map((d: QueryDocumentSnapshot) => d.ref.update({ expo_push_tokens: FieldValue.arrayRemove(token) }))
    )
  } catch (error) {
    console.warn('Expo push token dedupe failed:', error)
  }
}

/** Detach this device's token from the user (sign-out). No-op for a bad token. */
export async function unregisterUserExpoPushToken(userId: string, token: string) {
  if (!isExpoPushToken(token)) return
  await removeUserExpoPushToken(userId, token)
}

export async function sendExpoPushNotificationToUser(
  userId: string,
  title: string,
  body: string,
  url?: string,
  data?: Record<string, any>
): Promise<void> {
  const tokens = await getUserExpoPushTokens(userId)
  if (!tokens.length) return

  // priority 'high' (Android delivers at once, even in Doze): lib/push/expo-messages.
  const messages = buildExpoMessages({ tokens, title, body, url, data, userId })

  // Expo accepts up to 100 messages per request.
  const chunks: ExpoPushMessage[][] = []
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100))

  const accepted: Array<{ id: string; token: string }> = []
  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(chunk),
      })

      const json = (await res.json().catch(() => null)) as any

      if (!res.ok) {
        // Expo's error body can quote the tokens: shortened before logging.
        console.error('[push] Expo send failed', res.status, scrubForLog(json))
        continue
      }

      const tickets: ExpoPushTicket[] = Array.isArray(json?.data) ? json.data : []
      const outcome = readExpoTickets(chunk, tickets)
      for (const e of outcome.errors) console.error('[push] Expo ticket error', failureLog(userId, e))
      accepted.push(...outcome.receipts)
      // Prune invalid tokens.
      await Promise.all(outcome.prune.map((token) => removeUserExpoPushToken(userId, token)))
    } catch (error) {
      console.error('[push] Expo send error', (error as any)?.message || 'unknown')
    }
  }
  checkReceiptsLater(userId, accepted)
}

/**
 * Expo's receipts, read after the response (next/server `after`): failures
 * that only show up there (InvalidCredentials, MismatchSenderId: Android
 * pushes that never arrive) are logged with what they mean, and dead tokens
 * pruned. One queue per function instance, so a broadcast to many people
 * makes one receipt request per 1000 messages, not one per person. Outside a
 * request scope (scripts) `after` throws and the check is skipped: the send
 * itself already happened.
 */
const pendingReceipts: Array<{ id: string; token: string; userId: string }> = []
let receiptRunScheduled = false

async function checkPendingReceipts() {
  await new Promise((r) => setTimeout(r, RECEIPT_DELAY_MS))
  const batch = pendingReceipts.splice(0)
  receiptRunScheduled = false
  for (let i = 0; i < batch.length; i += RECEIPT_BATCH) {
    const slice = batch.slice(i, i + RECEIPT_BATCH)
    try {
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: slice.map((s) => s.id) }),
      })
      const json = (await res.json().catch(() => null)) as any
      const { errors } = readExpoReceipts(json?.data, slice)
      const ownerOf = (token: string) => slice.find((s) => s.token === token)?.userId || ''
      for (const e of errors) console.error('[push] Expo receipt error', failureLog(ownerOf(e.token), e))
      await Promise.all(
        errors
          .filter((e) => e.code === 'DeviceNotRegistered' && ownerOf(e.token))
          .map((e) => removeUserExpoPushToken(ownerOf(e.token), e.token).catch(() => {}))
      )
    } catch (error) {
      console.warn('[push] Expo receipts unavailable', (error as any)?.message)
    }
  }
}

function checkReceiptsLater(userId: string, accepted: Array<{ id: string; token: string }>) {
  if (!accepted.length) return
  pendingReceipts.push(...accepted.map((a) => ({ ...a, userId })))
  if (receiptRunScheduled) return
  receiptRunScheduled = true
  try {
    // Required lazily: importing next/server at module load pulls in the Web
    // Request global, which plain Node scripts and the jest node environment
    // lack (it broke every module that imports push at load time).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require('next/server') as typeof import('next/server')
    after(checkPendingReceipts)
  } catch {
    // Not inside a request: skip the receipt check.
    receiptRunScheduled = false
    pendingReceipts.length = 0
  }
}
