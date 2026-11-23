import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { backendJson } from './api/backend'
import {
  cachedPushToken,
  needsPushRegistration,
  parsePushTokenCache,
  serializePushTokenCache,
} from './pushTokenCache'

const STORAGE_KEY = 'tikem:expo_push_token'
// Legacy flag (the cache record replaced it); removed when seen.
const PLATFORM_SENT_KEY = 'tikem:expo_push_platform_sent'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

function getExpoProjectId(): string | undefined {
  const raw =
    (Constants as any)?.easConfig?.projectId ||
    (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
    (Constants as any)?.expoConfig?.extra?.projectId

  const projectId = typeof raw === 'string' ? raw.trim() : ''
  if (!projectId) return undefined

  // Expo expects a UUID. Some configs accidentally provide a slug, which throws at runtime.
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  if (!uuidRegex.test(projectId)) return undefined

  return projectId
}

/**
 * Android: the channel remote pushes land in. A push sent without a channelId
 * (all of ours: web lib/push/expo-messages) uses the 'default' channel, which
 * Expo otherwise creates itself at default importance (no heads-up banner).
 * Creating it here first, at HIGH importance, makes a new message pop up like
 * a message should. It must also exist BEFORE the permission request: on
 * Android 13+ the system prompt is not shown until the app has at least one
 * channel, and this app had none, so the request could be silently refused
 * (Tikra cfee2ccc, the same Android bug). Idempotent; once the channel exists
 * Android keeps the user's own sound/importance choices for it.
 */
export async function ensureAndroidDefaultChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages and updates',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    })
  } catch {
    // Never block registration on a channel.
  }
}

/**
 * Get this device's Expo token and make sure the server has it for `uid`.
 * `prompt: false` (the foreground refresh) never asks for permission, it only
 * registers when notifications are already allowed.
 */
export async function registerForPushNotificationsIfPossible(
  opts: { prompt?: boolean; uid?: string | null } = {}
): Promise<string | null> {
  if (!Device.isDevice) {
    return null
  }

  await ensureAndroidDefaultChannel()

  const existingStatus = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus.status

  if (finalStatus !== 'granted' && opts.prompt !== false) {
    const requested = await Notifications.requestPermissionsAsync()
    finalStatus = requested.status
  }

  if (finalStatus !== 'granted') {
    return null
  }

  const projectId = getExpoProjectId()

  let token: string | null = null
  try {
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync()
    token = tokenResponse?.data || null
  } catch (e) {
    // Retry without projectId (some environments don't have a stable projectId).
    try {
      const tokenResponse = await Notifications.getExpoPushTokenAsync()
      token = tokenResponse?.data || null
    } catch (err: any) {
      // Android: no FCM registration (google-services / Play services) lands here.
      console.warn('Expo push token unavailable', err?.message || err)
      return null
    }
  }

  if (!token) return null

  // Re-send when the account changed or the last registration is a day old
  // (lib/pushTokenCache): the server may have dropped the token since.
  const uid = opts.uid || null
  const cached = parsePushTokenCache(await AsyncStorage.getItem(STORAGE_KEY).catch(() => null))
  if (!needsPushRegistration(cached, token, uid, Date.now())) return token

  await backendJson('/api/push/register-expo', {
    method: 'POST',
    body: JSON.stringify({ token, platform: Platform.OS }),
  })

  await AsyncStorage.setItem(STORAGE_KEY, serializePushTokenCache({ token, uid: uid || '', at: Date.now() })).catch(() => {})
  await AsyncStorage.removeItem(PLATFORM_SENT_KEY).catch(() => {})
  return token
}

/**
 * Sign-out: detach this device's Expo token from the signed-in account so the
 * previous user's pushes stop arriving here, and forget the cached token so the
 * next account re-registers it. Must run BEFORE Firebase sign-out (the call is
 * authenticated). Never throws and never waits more than a few seconds: an
 * offline phone still signs out (the next registration on this device detaches
 * the token server-side anyway).
 */
export async function unregisterPushTokenOnSignOut(timeoutMs = 3000): Promise<void> {
  let token: string | null = null
  try {
    token = cachedPushToken(await AsyncStorage.getItem(STORAGE_KEY))
  } catch {
    // ignore
  }
  if (token) {
    const call = backendJson('/api/push/unregister-expo', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).catch(() => {})
    await Promise.race([call, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  }
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {})
  await AsyncStorage.removeItem(PLATFORM_SENT_KEY).catch(() => {})
}

export function addPushNotificationListeners(onUrl?: (url: string) => void) {
  const receivedSub = Notifications.addNotificationReceivedListener(() => {
    // no-op (UI handled by OS)
  })

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data: any = response?.notification?.request?.content?.data
    const raw =
      (typeof data?.deepLink === 'string' && data.deepLink) ||
      (typeof data?.url === 'string' && data.url) ||
      null

    if (!raw || !onUrl) return

    // Prefer in-app routing. Convert relative paths to the app scheme.
    const url =
      raw.startsWith('tikem://') || raw.startsWith('http://') || raw.startsWith('https://')
        ? raw
        : raw.startsWith('/')
          ? `tikem://${raw.slice(1)}`
          : `tikem://${raw}`

    onUrl(url)
  })

  return () => {
    receivedSub.remove()
    responseSub.remove()
  }
}
