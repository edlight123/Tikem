/**
 * Apple Wallet `.pkpass` construction.
 *
 * The archive Apple expects is: `pass.json` + artwork + a `manifest.json` of
 * SHA-1 hashes of every file + a PKCS#7 *detached* signature over that manifest,
 * all zipped. None of that is hand-rolled here — `passkit-generator` (already a
 * direct dependency of this repo, v3.5.7, MIT) does the manifest, the PKCS#7
 * signing via node-forge and the zip. Hand-rolling PKCS#7 for a pass that iOS
 * silently refuses when a single byte is wrong is not a good trade.
 *
 * Nothing money-related or account-related goes into the pass: it carries the
 * event, the date, the venue, the tier and the ticket's EXISTING QR payload.
 */

import type { PKPass as PKPassType } from 'passkit-generator'
import type { AppleWalletConfig } from './config'
import type { WalletTicket } from './ticket-access'
import { appleAuthTokenFor, appleSerialFor, appleWebServiceUrl } from './apple-web-service'
import { PASS_ICON } from './brandArt'

export interface ApplePassOptions {
  /**
   * Build the VOIDED pass the previous holder's Wallet downloads after a
   * transfer (or after a refund): `voided: true`, no barcode, no holder name,
   * and a line saying why. Served only by the PassKit web service.
   */
  voided?: boolean
  /** The serial being served (a voided pass keeps the serial the device asked for). */
  serialNumber?: string
}

/**
 * The ISO instant Wallet should format, or null when the event has no usable
 * date. Milliseconds are stripped: PassKit wants a W3C ISO-8601 timestamp, and
 * the fractional-second form is the kind of detail its parser is fussy about —
 * a date it rejects renders as an empty field on the pass face.
 */
function passDateValue(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * The event poster, sized for the eventTicket background slot (180×220pt,
 * @2x 360×440) — iOS applies the blur itself. Returns {} when there is no
 * banner or anything goes wrong, which yields the plain near-black pass.
 */
// banner_image_url is ORGANIZER-writable, and this fetch runs on our server —
// an arbitrary URL here is SSRF. Only the storage hosts posters actually live
// on (the same set next.config.js whitelists for next/image) are fetched, and
// redirects are refused so an allowed host can't bounce us elsewhere.
// images.unsplash.com is where the flyer library's posters live (lib/flyerLibrary):
// an event made from a library flyer used to get a plain black pass.
const PASS_IMAGE_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com', 'images.unsplash.com'])

async function buildPassBackground(
  bannerImageUrl: string | null
): Promise<Record<string, Buffer>> {
  if (!bannerImageUrl) return {}
  try {
    const url = new URL(bannerImageUrl)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol !== 'https:' || !PASS_IMAGE_HOSTS.has(hostname)) return {}

    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) return {}
    const source = Buffer.from(await response.arrayBuffer())
    // A poster over ~15MB is not artwork we should be pulling into a pass.
    if (source.length > 15 * 1024 * 1024) return {}

    const { default: sharp } = await import('sharp')
    // Darkened HARD before iOS blurs it, so the near-black pass dominates and
    // the poster survives only as a faint tint — the premium look the owner
    // asked for (2026-10-26). It also keeps white text + the QR panel legible
    // on ANY poster (a light flyer used to make the field text vanish).
    const resize = (w: number, h: number) =>
      sharp(source)
        .resize(w, h, { fit: 'cover', position: 'attention' })
        .modulate({ brightness: 0.22, saturation: 0.7 })
        .png()
        .toBuffer()
    const [x1, x2] = await Promise.all([resize(180, 220), resize(360, 440)])
    return { 'background.png': x1, 'background@2x.png': x2 }
  } catch (error) {
    console.warn('[wallet] pass background skipped', {
      message: (error as any)?.message,
    })
    return {}
  }
}

/**
 * Build a signed `.pkpass` for one ticket.
 *
 * @throws if the certificate material is rejected by the signer. Callers turn
 *         that into a specific error code — never into a silent success.
 */
export async function buildApplePkpass(
  ticket: WalletTicket,
  config: AppleWalletConfig,
  options: ApplePassOptions = {}
): Promise<Buffer> {
  const voided = Boolean(options.voided)
  const serialNumber = options.serialNumber || appleSerialFor(ticket.id, ticket.qrVersion || 0)

  // Haiti events get a French pass by default (owner 2026-10-26): same brand,
  // French field labels + door copy. Detected from the event's country ('HT').
  const fr = (ticket.country || '').trim().toUpperCase() === 'HT'
  const L = {
    ticket: fr ? 'BILLET' : 'TICKET',
    event: fr ? 'ÉVÉNEMENT' : 'EVENT',
    date: 'DATE',
    tba: fr ? 'À venir' : 'TBA',
    venue: fr ? 'LIEU' : 'VENUE',
    admit: fr ? 'TITULAIRE' : 'ADMIT',
    order: fr ? 'COMMANDE' : 'ORDER',
    city: fr ? 'Ville' : 'City',
    atDoor: fr ? 'À l’entrée' : 'At the door',
    instructions: fr
      ? 'Présentez ce billet à l’entrée. Chaque billet se scanne une seule fois.'
      : 'Show this pass at the entrance. Each ticket scans once.',
    status: fr ? 'STATUT' : 'STATUS',
    voidValue: fr ? 'ANNULÉ' : 'VOID',
    voidTitle: fr ? 'Ce billet est annulé' : 'This pass is void',
    voidBody: fr
      ? 'Ce billet a été transféré ou n’est plus valide. Il n’admet plus personne à l’entrée.'
      : 'This ticket was transferred or is no longer valid. This pass no longer admits anyone at the door.',
  }
  // The PassKit web service, so Wallet can be told when this pass changes
  // (lib/wallet/apple-web-service.ts). Omitted, rather than half-set, when the
  // deployment has no https origin or no key to derive the token from.
  const webServiceURL = appleWebServiceUrl()
  const authenticationToken = webServiceURL ? appleAuthTokenFor(serialNumber) : null

  // Loaded on demand, NOT at module scope. `next build` imports every route
  // module to collect page data, so a top-level import drags passkit-generator
  // (plus node-forge and joi) into the same process that renders 199 static
  // pages — which OOM'd the build. Nothing here runs until a pass is requested.
  const { PKPass } = (await import('passkit-generator')) as {
    PKPass: typeof PKPassType
  }

  const startValue = passDateValue(ticket.startDatetime)

  // The event's poster as the pass background. Apple's eventTicket style blurs
  // background.png automatically — the exact premium treatment the poster-glow
  // design uses everywhere else. Best-effort: a missing/broken banner just
  // yields the plain near-black pass.
  const backgroundFiles = await buildPassBackground(ticket.bannerImageUrl)

  const pass = new PKPass(
    {
      // Apple will not open a pass without an icon. No separate logo.png: the
      // header shows the plain "Tikèm" wordmark via logoText, not a mark image
      // — owner feedback 2026-10-26 that the "t" mark read as weird; use the
      // actual name instead.
      'icon.png': PASS_ICON.x1,
      'icon@2x.png': PASS_ICON.x2,
      'icon@3x.png': PASS_ICON.x3,
      ...backgroundFiles,
    },
    {
      wwdr: config.wwdr,
      signerCert: config.signerCert,
      signerKey: config.signerKey,
      ...(config.signerKeyPassphrase ? { signerKeyPassphrase: config.signerKeyPassphrase } : {}),
    },
    {
      formatVersion: 1,
      passTypeIdentifier: config.passTypeIdentifier,
      teamIdentifier: config.teamIdentifier,
      // One pass per ticket AND QR version, stable across regenerations so
      // re-adding a pass updates the existing one instead of stacking
      // duplicates in Wallet. The version suffix (from the first transfer on)
      // keeps a new holder's pass apart from the previous holder's voided one.
      serialNumber,
      ...(webServiceURL && authenticationToken ? { webServiceURL, authenticationToken } : {}),
      ...(voided ? { voided: true } : {}),
      organizationName: config.organizationName,
      description: `${ticket.eventTitle} · ${ticket.tierName}`,
      // The "t" mark plus the name beside it, the way airline passes pair a
      // mark with a wordmark.
      logoText: 'Tikèm',
      backgroundColor: 'rgb(10, 10, 10)',
      foregroundColor: 'rgb(255, 255, 255)',
      // A light teal: the poster background is darkened but tinted, and the
      // brand teal (13,148,136) was too dim on it for field labels.
      labelColor: 'rgb(94, 234, 212)',
      sharingProhibited: true,
    }
  )

  // Surfaces the pass on the lock screen around door time instead of making the
  // attendee dig through Wallet at the entrance. Set through the setters, not
  // the props object, which strips these keys.
  //
  // Apple renamed this twice: `relevantDate` (pre-18), `relevantDates[]` with
  // `relevantDate` (18), then `relevantDates[].date` (26). Both are written so
  // the pass behaves on every iOS version the testers might carry. A start+end
  // INTERVAL is also what drives the Live Activity countdown on event tickets,
  // so it is preferred whenever the event has an end time.
  //
  // Note the single-instant entry must carry `relevantDate` — the library's Joi
  // schema marks it required and merely `console.warn`s on a `{ date }`-only
  // entry, silently dropping it, which is how the start-only case ended up with
  // no relevancy at all.
  const endValue = passDateValue(ticket.endDatetime)
  if (startValue) {
    if (endValue) {
      pass.setRelevantDates([{ startDate: startValue, endDate: endValue }])
    } else {
      pass.setRelevantDates([{ relevantDate: startValue, date: startValue }])
    }
    // Legacy key for iOS 17 and earlier, which ignores `relevantDates`.
    pass.setRelevantDate(new Date(startValue))
  }

  pass.type = 'eventTicket'

  pass.headerFields.push({
    key: 'tier',
    label: L.ticket,
    value: ticket.tierName,
  })

  pass.primaryFields.push({
    key: 'event',
    label: L.event,
    value: ticket.eventTitle,
  })

  // Hand Wallet the raw instant and let IT format, rather than pre-rendering a
  // string. The old code formatted in UTC, so a 9:30 PM Haiti event printed as
  // "2:30 AM" the next day on the pass while the app showed 9:30 PM. With
  // dateStyle/timeStyle, Wallet renders in the device's own timezone and
  // locale — the same thing the app's date-fns formatting does.
  pass.secondaryFields.push(
    startValue
      ? {
          key: 'date',
          label: L.date,
          value: startValue,
          dateStyle: 'PKDateStyleMedium',
          timeStyle: 'PKDateStyleShort',
        }
      : { key: 'date', label: L.date, value: L.tba }
  )

  if (ticket.venueName) {
    pass.secondaryFields.push({
      key: 'venue',
      label: L.venue,
      value: ticket.venueName,
    })
  }

  // A voided pass belongs to the PREVIOUS holder: never show them the new
  // holder's name.
  if (ticket.holderName && !voided) {
    pass.auxiliaryFields.push({
      key: 'holder',
      label: L.admit,
      value: ticket.holderName,
    })
  }

  pass.auxiliaryFields.push({
    key: 'order',
    label: L.order,
    value: ticket.orderRef,
  })

  if (ticket.city) {
    pass.backFields.push({ key: 'city', label: L.city, value: ticket.city })
  }
  if (voided) {
    pass.auxiliaryFields.push({ key: 'status', label: L.status, value: L.voidValue })
    pass.backFields.push({
      key: 'voided',
      label: L.voidTitle,
      value: L.voidBody,
    })
    // No barcode at all: nothing on a void pass can be scanned.
    pass.setBarcodes(null)
    return pass.getAsBuffer()
  }

  pass.backFields.push({
    key: 'instructions',
    label: L.atDoor,
    value: L.instructions,
  })

  // THE existing QR payload, straight from Firestore. Re-encoding it in the
  // pass is the whole point; minting a new code would fail at the scanner.
  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: ticket.qrPayload,
    messageEncoding: 'iso-8859-1',
    altText: ticket.orderRef,
  })

  return pass.getAsBuffer()
}
