import 'server-only'
/**
 * Server-side fetches of URLs an organizer pastes (event import). Fetching a
 * user-supplied URL from our servers is an SSRF primitive, so every request:
 *
 *   - is https only, on the default port, with no credentials and no IP
 *     literal or internal-looking host name (isPublicHttpsUrl);
 *   - resolves DNS ONCE through a lookup that refuses any non-public address
 *     (lib/security/net-guard) and connects to that same address, so a public
 *     name cannot resolve, or rebind, to an internal host between the check
 *     and the connection;
 *   - follows at most 3 redirects by hand, each hop re-checked the same way,
 *     so a public page cannot bounce us to a private IP;
 *   - has a hard 15 s total deadline (the socket timeout alone only fires on
 *     silence, so a trickling server could otherwise hold it open) and a
 *     byte cap enforced while streaming.
 *
 * Images get the share-card limits on top (lib/posters/hosts): an image
 * content type, a declared length checked before reading, a streamed cap, the
 * bytes themselves identified as JPEG/PNG/WebP/GIF (lib/security/sniffImage,
 * never SVG) and a pixel limit, so a decompression bomb is refused.
 */
import https from 'node:https'
import dns from 'node:dns'
import { isPrivateIp } from '@/lib/security/net-guard'
import { sniffRasterImage, type SniffedImage } from '@/lib/security/sniffImage'
import { isPublicHttpsUrl } from '@/lib/import/url'

export { isPublicHttpsUrl }

const PAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const IMAGE_MAX_PIXELS = 50_000_000
const DEADLINE_MS = 15_000
const MAX_HOPS = 3
const UA = 'TikemImport/1.0 (+https://www.tikem.co; imports an organizer’s own public event pages)'

/**
 * A DNS lookup that refuses private addresses, used as the socket's own
 * lookup so the connection goes to the address that was checked. Every
 * address a name resolves to must be public: one private answer refuses all.
 */
export function guardedLookup(hostname: string, options: any, callback: any) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = (addresses as unknown as Array<{ address: string; family: number }>) || []
    if (list.length === 0 || list.some((a) => isPrivateIp(a.address))) {
      return callback(Object.assign(new Error('Refused: private address'), { code: 'EPRIVATE' }))
    }
    const first = list[0]
    if (options && options.all) return callback(null, [first])
    callback(null, first.address, first.family)
  })
}

type Once = { status: number; location: string | null; body: Buffer | null; type: string | null }
const FAIL: Once = { status: 0, location: null, body: null, type: null }

function getOnce(url: string, opts: { maxBytes: number; accept: string }): Promise<Once> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (v: Once) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const u = new URL(url)
    const req = https.request(
      {
        protocol: 'https:',
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        lookup: guardedLookup as any,
        timeout: DEADLINE_MS,
        headers: { 'User-Agent': UA, Accept: opts.accept, 'Accept-Encoding': 'identity' },
      },
      (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400) {
          res.resume()
          return finish({ status, location: res.headers.location || null, body: null, type: null })
        }
        // A declared length over the cap is refused before reading a byte.
        const declared = Number(res.headers['content-length'] || 0)
        if (declared > opts.maxBytes) {
          req.destroy()
          return finish(FAIL)
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (c: Buffer) => {
          total += c.length
          if (total > opts.maxBytes) {
            req.destroy()
            finish(FAIL)
          } else chunks.push(c)
        })
        res.on('end', () => finish({ status, location: null, body: Buffer.concat(chunks), type: String(res.headers['content-type'] || '') || null }))
        res.on('error', () => finish(FAIL))
      },
    )
    const deadline = setTimeout(() => {
      req.destroy()
      finish(FAIL)
    }, DEADLINE_MS)
    req.on('close', () => clearTimeout(deadline))
    req.on('timeout', () => req.destroy())
    req.on('error', () => finish(FAIL))
    req.end()
  })
}

/** Follow up to MAX_HOPS redirects by hand, every hop re-checked. */
async function guardedGet(url: string, opts: { maxBytes: number; accept: string }): Promise<{ res: Once; finalUrl: string } | null> {
  let current = url
  for (let i = 0; i <= MAX_HOPS; i++) {
    if (!isPublicHttpsUrl(current)) return null
    const res = await getOnce(current, opts)
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return null
      try {
        current = new URL(res.location, current).toString()
      } catch {
        return null
      }
      continue
    }
    if (res.status < 200 || res.status >= 300 || res.body == null) return null
    return { res, finalUrl: current }
  }
  return null
}

/** GET a public https page as text (2 MB, 15 s, guarded). Null on any failure. */
export async function safeFetchText(url: string): Promise<{ text: string; finalUrl: string } | null> {
  const got = await guardedGet(url, { maxBytes: PAGE_MAX_BYTES, accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5' })
  if (!got) return null
  return { text: got.res.body!.toString('utf8'), finalUrl: got.finalUrl }
}

/**
 * Check fetched bytes are a real raster image within the limits: declared
 * image type, magic bytes (the stored type comes from these), and a pixel cap.
 */
export async function checkImageBytes(data: Buffer, declaredType: string | null): Promise<SniffedImage | null> {
  const type = String(declaredType || '').split(';')[0].trim().toLowerCase()
  if (!/^image\//.test(type)) return null
  if (data.length === 0 || data.length > IMAGE_MAX_BYTES) return null
  const sniffed = sniffRasterImage(data)
  if (!sniffed) return null
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(data, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: 'error' }).metadata()
    if (!meta.width || !meta.height || meta.width * meta.height > IMAGE_MAX_PIXELS) return null
  } catch {
    return null
  }
  return sniffed
}

/** GET a public https image with the share-card limits. Null on any failure. */
export async function safeFetchImage(url: string): Promise<{ data: Buffer; type: SniffedImage['mime']; ext: string } | null> {
  const got = await guardedGet(url, { maxBytes: IMAGE_MAX_BYTES, accept: 'image/webp,image/jpeg,image/png,image/gif;q=0.8' })
  if (!got) return null
  const sniffed = await checkImageBytes(got.res.body!, got.res.type)
  if (!sniffed) return null
  return { data: got.res.body!, type: sniffed.mime, ext: sniffed.ext }
}
