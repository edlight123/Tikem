import { auth } from '../../config/firebase'
import { onAuthStateChanged } from 'firebase/auth'

// `tikem.co` now resolves and points at prod, so it is the default fallback.
// Override per-environment with EXPO_PUBLIC_API_URL (or EXPO_PUBLIC_WEB_URL),
// e.g. to target the eventhaiti.vercel.app deployment or a local server.
const API_URL = String(
  process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_WEB_URL ||
    'https://www.tikem.co'
).replace(/\/$/, '')

/** The API origin, for the few unauthenticated calls made with plain fetch. */
export const API_BASE_URL = API_URL

const DEBUG_API = process.env.EXPO_PUBLIC_DEBUG_API === 'true'

let sessionCookieValue: string | null = null
// The account the captured cookie belongs to; a cookie is never sent for anyone else.
let sessionCookieUid: string | null = null

/** Forget the web session cookie. Called on sign-out. */
export function resetWebSessionCookie() {
  sessionCookieValue = null
  sessionCookieUid = null
}

type FetchInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

function isFormData(value: any): boolean {
  return typeof FormData !== 'undefined' && value instanceof FormData
}

async function ensureWebSessionCookie(idToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      // RN fetch cookie behavior differs by platform; best-effort include.
      credentials: 'include',
    })

    // Best-effort: capture the cookie manually so we can re-send it even if the
    // platform cookie jar doesn't persist it.
    const setCookie =
      (res.headers?.get?.('set-cookie') as string | null) ||
      (res.headers?.get?.('Set-Cookie') as string | null) ||
      null

    if (DEBUG_API) {
      console.warn('[ensureWebSessionCookie]', {
        ok: res.ok,
        status: res.status,
        hasSetCookieHeader: Boolean(setCookie),
      })
    }

    if (setCookie) {
      const match = setCookie.match(/(?:^|\s|;)session=([^;]+)/)
      if (match?.[1]) {
        sessionCookieValue = match[1]
        sessionCookieUid = auth.currentUser?.uid ?? null
        if (DEBUG_API) {
          console.warn('[ensureWebSessionCookie] captured session cookie', {
            hasSessionCookie: true,
            length: sessionCookieValue.length,
          })
        }
      } else if (DEBUG_API) {
        console.warn('[ensureWebSessionCookie] set-cookie present but no session cookie matched')
      }
    }

    return res.ok
  } catch {
    return false
  }
}

export async function backendFetch(path: string, init: FetchInit = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`

  const currentUser = await (async () => {
    if (auth.currentUser) return auth.currentUser
    // Wait briefly for auth state to resolve (common right after app boot).
    return await new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        unsub()
        resolve(auth.currentUser)
      }, 1500)

      const unsub = onAuthStateChanged(auth, (u) => {
        clearTimeout(timeout)
        unsub()
        resolve(u)
      })
    })
  })()

  const token = currentUser ? await currentUser.getIdToken() : null

  const headers: Record<string, string> = {
    ...(init.headers || {}),
  }

  // A cookie captured for another account (sign-out, then sign-in as someone
  // else) must never ride along.
  if (sessionCookieValue && sessionCookieUid !== (currentUser?.uid ?? null)) {
    resetWebSessionCookie()
  }

  // Attach session cookie (webapp auth) if we have one.
  if (sessionCookieValue && !headers['Cookie'] && !headers['cookie']) {
    headers['Cookie'] = `session=${sessionCookieValue}`
    if (DEBUG_API) {
      console.warn('[backendFetch] attaching session cookie', { url, cookieLen: sessionCookieValue.length })
    }
  }

  // Only set JSON content-type for JSON-ish payloads.
  // For FormData/multipart, let fetch set the boundary header.
  if (!headers['Content-Type'] && init.body && !isFormData(init.body)) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
    headers['X-Firebase-Token'] = token
  }

  try {
    let res = await fetch(url, {
      ...init,
      headers,
      credentials: init.credentials ?? 'omit',
    })

    if (res.status === 401) {
      console.warn('[backendFetch] 401', {
        url,
        hasAuthHeader: Boolean(headers['Authorization'] || headers['authorization']),
        hasAltTokenHeader: Boolean(headers['X-Firebase-Token'] || headers['x-firebase-token']),
        uid: currentUser?.uid || null,
      })
    }

    // Best-effort: if we get a 401, force-refresh the token once and retry.
    if (res.status === 401 && currentUser) {
      try {
        const fresh = await currentUser.getIdToken(true)
        if (fresh && fresh !== token) {
          const retryHeaders: Record<string, string> = {
            ...(headers || {}),
            Authorization: `Bearer ${fresh}`,
            'X-Firebase-Token': fresh,
          }

          res = await fetch(url, {
            ...init,
            headers: retryHeaders,
            credentials: init.credentials ?? 'omit',
          })
        }
      } catch {
        // ignore refresh failures
      }
    }

    // If bearer-token auth still fails, mimic the webapp behavior by creating a session cookie
    // via /api/auth/session and retrying once more.
    if (res.status === 401 && currentUser) {
      const idToken = await currentUser.getIdToken().catch(() => null)
      if (idToken) {
        const ok = await ensureWebSessionCookie(idToken)
        if (ok) {
          const retryHeaders: Record<string, string> = {
            ...(headers || {}),
          }

          if (sessionCookieValue && !retryHeaders['Cookie'] && !retryHeaders['cookie']) {
            retryHeaders['Cookie'] = `session=${sessionCookieValue}`
          }

          if (DEBUG_API) {
            console.warn('[backendFetch] retrying with web session cookie', {
              url,
              hasSessionCookie: Boolean(sessionCookieValue),
              cookieLen: sessionCookieValue ? sessionCookieValue.length : 0,
            })
          }

          res = await fetch(url, {
            ...init,
            headers: retryHeaders,
            credentials: init.credentials ?? 'omit',
          })
        }
      }
    }

    return res
  } catch (err: any) {
    const rawMessage = typeof err?.message === 'string' ? err.message : ''
    const isNetworkFailure =
      rawMessage.toLowerCase().includes('network request failed') ||
      rawMessage.toLowerCase().includes('failed to fetch')

    if (isNetworkFailure) {
      const base = API_URL
      const localhostHint = base.includes('localhost') || base.includes('127.0.0.1')
      const hint = localhostHint
        ? 'You are likely running on a real device where localhost points to the phone. Set EXPO_PUBLIC_API_URL to a reachable server (e.g., your deployed API URL) and restart Expo.'
        : 'Verify EXPO_PUBLIC_API_URL is correct/reachable and that the server allows this origin.'

      throw new Error(`Network request failed: unable to reach API (${base}). ${hint}`)
    }

    throw err
  }
}

export async function backendJson<T>(path: string, init: FetchInit = {}): Promise<T> {
  const res = await backendFetch(path, init)

  // Some proxies/tunnels return non-JSON error pages; capture raw text first.
  const rawText = await res.text().catch(() => '')
  const matchedPath = res.headers?.get?.('x-matched-path') || ''
  const data = (() => {
    if (!rawText) return {} as any
    try {
      return JSON.parse(rawText)
    } catch {
      return {} as any
    }
  })()

  if (!res.ok) {
    const baseMessage = (data as any)?.error || (data as any)?.message
    const statusMessage = `Request failed (${res.status})`
    const message = baseMessage || statusMessage

    // If the server didn't return JSON, include a small snippet for debugging.
    const snippet = !baseMessage && rawText ? rawText.trim().slice(0, 140) : ''
    const extra = snippet ? `: ${snippet}` : ''

    const isNextNotFoundPage = res.status === 404 && matchedPath === '/404'
    if (!isNextNotFoundPage) {
      // 4xx are expected/handled outcomes (validation, auth, "profile required")
      // that callers surface with their own UI — log them as warnings so they
      // don't trip the dev red-box. Only 5xx (real server faults) use error.
      const log = res.status >= 500 ? console.error : console.warn;
      log('[backendJson] Request failed', {
        url: res.url,
        status: res.status,
        message: baseMessage || null,
        snippet: snippet || null,
      })
    }

    // Carry the machine-readable parts of the failure on the Error itself. The
    // message is an English server string that must never be shown to a buyer as
    // is; callers localize off `code` (and fall back to their own copy when the
    // endpoint doesn't send one).
    const err = new Error(`${message}${extra} [${res.url}]`) as Error & {
      code?: string
      status?: number
      payload?: any
    }
    err.code = typeof (data as any)?.code === 'string' ? (data as any).code : undefined
    err.status = res.status
    err.payload = data
    throw err
  }

  return data as T
}
