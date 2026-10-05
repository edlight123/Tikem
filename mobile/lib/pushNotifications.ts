import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { backendJson } from './api/backend'

const STORAGE_KEY = 'tikem:expo_push_token'

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

export async function registerForPushNotificationsIfPossible(): Promise<string | null> {
  if (!Device.isDevice) {
    return null
  }

  const existingStatus = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus.status

  if (finalStatus !== 'granted') {
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
    } catch {
      return null
    }
  }

  if (!token) return null

  const last = await AsyncStorage.getItem(STORAGE_KEY)
  if (last === token) return token

  await backendJson('/api/push/register-expo', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })

  await AsyncStorage.setItem(STORAGE_KEY, token)
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
    token = await AsyncStorage.getItem(STORAGE_KEY)
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
