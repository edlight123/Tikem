import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[') && token.endsWith(']')
}

type ExpoPushMessage = {
  to: string
  title?: string
  body?: string
  sound?: 'default' | null
  data?: Record<string, any>
}

type ExpoPushReceipt = {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: Record<string, any>
}

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

export async function registerUserExpoPushToken(userId: string, token: string) {
  if (!isExpoPushToken(token)) {
    throw new Error('Invalid Expo push token')
  }

  await adminDb
    .collection('users')
    .doc(userId)
    .set(
      {
        expo_push_tokens: FieldValue.arrayUnion(token),
        expo_push_tokens_updated_at: FieldValue.serverTimestamp(),
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

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: 'default',
    data: {
      ...(data || {}),
      url: url || '/',
      userId,
    },
  }))

  // Expo accepts up to 100 messages per request.
  const chunks: ExpoPushMessage[][] = []
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100))

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
      const receipts: ExpoPushReceipt[] = Array.isArray(json?.data) ? json.data : []

      if (!res.ok) {
        console.error('Expo push send failed:', res.status, json)
        continue
      }

      // Prune invalid tokens.
      await Promise.all(
        receipts
          .map((r, idx) => ({ r, token: chunk[idx]?.to }))
          .filter(({ r, token }) => token && r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered')
          .map(({ token }) => removeUserExpoPushToken(userId, String(token)))
      )
    } catch (error) {
      console.error('Expo push send error:', error)
    }
  }
}
