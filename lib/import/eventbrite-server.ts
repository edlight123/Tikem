import 'server-only'
/**
 * An organizer's Eventbrite connection (OAuth). The access token is stored
 * ENCRYPTED (AES-256-GCM with INTEGRATIONS_ENCRYPTION_KEY, kept apart from the
 * payout-details key) in organizer_integrations/{orgId}, a collection no
 * client rule grants, and never leaves the server. Calls go to Eventbrite's
 * own API host only, with a timeout.
 *
 * Off unless EVENTBRITE_CLIENT_ID, EVENTBRITE_CLIENT_SECRET and
 * INTEGRATIONS_ENCRYPTION_KEY are all set (eventbriteConfigured): the UI then
 * hides "Connect Eventbrite" and the routes answer "unavailable"; importing
 * from a link keeps working.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { CANONICAL_SITE_URL } from '@/lib/site-url'

const API = 'https://www.eventbriteapi.com/v3'
export const EB_AUTHORIZE_URL = 'https://www.eventbrite.com/oauth/authorize'
export const EB_TOKEN_URL = 'https://www.eventbrite.com/oauth/token'
export const EB_STATE_COOKIE = 'eb_oauth_state'
export const EB_STATE_PATH = '/api/integrations/eventbrite'
const COLLECTION = 'organizer_integrations'

/** 32 bytes, base64. */
function key(): Buffer | null {
  const k = Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY || '', 'base64')
  return k.length === 32 ? k : null
}

function seal(text: string): { v: 1; iv: string; tag: string; data: string } {
  const k = key()
  if (!k) throw new Error('INTEGRATIONS_ENCRYPTION_KEY is missing')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }
}

function unseal(p: any): string | null {
  const k = key()
  if (!k || !p?.iv || !p?.tag || !p?.data) return null
  try {
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(p.iv, 'base64'))
    d.setAuthTag(Buffer.from(p.tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(p.data, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** All three secrets present: the Connect Eventbrite UI shows only then. */
export const eventbriteConfigured = () => !!process.env.EVENTBRITE_CLIENT_ID && !!process.env.EVENTBRITE_CLIENT_SECRET && !!key()

/**
 * The origin the OAuth round trip runs on. Production is always the
 * canonical www host: the redirect URI must match the one registered with
 * Eventbrite exactly, the state cookie is host-bound, and the apex 308 would
 * drop a WebView's auth header. Previews and local dev use their own host.
 */
export function integrationOrigin(req: Request): string {
  if (process.env.VERCEL_ENV === 'production') return CANONICAL_SITE_URL
  const first = (v: string | null) => String(v || '').split(',')[0].trim()
  const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host'))
  const proto = first(req.headers.get('x-forwarded-proto')) || new URL(req.url).protocol.replace(':', '') || 'https'
  return host ? `${proto}://${host}` : new URL(req.url).origin
}

export function redirectUri(origin: string) {
  return `${origin}/api/integrations/eventbrite/callback`
}

export async function saveToken(orgId: string, token: string, by: string) {
  // auto_sync: a new connection keeps the organizer's live Eventbrite events
  // on Tikèm (lib/import/eventbrite-sync-server) until they turn it off.
  await adminDb
    .collection(COLLECTION)
    .doc(orgId)
    .set({ eventbrite: { token: seal(token), connected_at: new Date().toISOString(), connected_by: by, auto_sync: true } }, { merge: true })
}

export async function loadToken(orgId: string): Promise<string | null> {
  const snap = await adminDb.collection(COLLECTION).doc(orgId).get()
  const enc = snap.exists ? snap.data()?.eventbrite?.token : null
  if (!enc) return null
  return unseal(enc)
}

export async function forget(orgId: string) {
  const ref = adminDb.collection(COLLECTION).doc(orgId)
  const snap = await ref.get()
  if (snap.exists) await ref.set({ eventbrite: null }, { merge: true })
}

/** One GET on Eventbrite's API with its HTTP status (429 = slow down, 401/403 = not allowed). */
export async function ebGet(token: string, path: string): Promise<{ status: number; data: any | null }> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) return { status: 0, data: null }
  if (!res.ok) return { status: res.status, data: null }
  return { status: res.status, data: await res.json().catch(() => null) }
}

/** The connected account's upcoming events (live, started, draft) across its organizations, venue/tickets/logo expanded. */
export async function listEvents(token: string): Promise<any[] | null> {
  const orgs = await ebGet(token, '/users/me/organizations/')
  if (!orgs.data) return null
  const out: any[] = []
  for (const o of (orgs.data.organizations || []).slice(0, 5)) {
    let continuation = ''
    for (let page = 0; page < 4; page++) {
      const q = `/organizations/${encodeURIComponent(o.id)}/events/?status=live,started,draft&time_filter=current_future&expand=venue,ticket_classes,logo&page_size=50${continuation ? `&continuation=${encodeURIComponent(continuation)}` : ''}`
      const r = await ebGet(token, q)
      if (!r.data) break
      out.push(...(r.data.events || []))
      if (!r.data.pagination?.has_more_items || !r.data.pagination?.continuation) break
      continuation = r.data.pagination.continuation
    }
  }
  return out.slice(0, 200)
}

/** Swap an OAuth code for an access token (server to server). */
export async function exchangeCode(code: string, origin: string): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.EVENTBRITE_CLIENT_ID || '',
    client_secret: process.env.EVENTBRITE_CLIENT_SECRET || '',
    code,
    redirect_uri: redirectUri(origin),
  })
  const res = await fetch(EB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  const data = res && res.ok ? await res.json().catch(() => null) : null
  return typeof data?.access_token === 'string' && data.access_token ? data.access_token : null
}
