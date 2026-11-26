/**
 * Printed-ticket templates: the gallery an organizer chooses from (owner,
 * 2026-11-25). Code-defined and versioned: a batch stores the template id AND
 * the version it was approved at, so a later redesign of a template never
 * changes a proof someone already signed off.
 *
 * Every template is a TALL stub ticket, 2.75 × 7 in, drawn in a 528 × 1344
 * artboard (192 units per inch; ./templates.ts). The colour swatches are data
 * (paper stock or ink), not site UI colours, so they live here and in the
 * renderer, never in lib/design/tokens.ts.
 *
 * Pure: no Firebase, no fs. The order screen, the API and the tests share it.
 */

export type TemplateId = 'coloured_card' | 'kraft_foil' | 'clean_white' | 'poster_photo' | 'bold_type' | 'veve_border'
export type Lang = 'en' | 'fr' | 'ht'
export type Localized = Record<Lang, string>

/** Where it can be printed: a cybercafé laser (black or light ink) or a print shop (full colour, heavy ink, foil). */
export type PrintTier = 'cybercafe' | 'print_shop'

export interface Swatch {
  id: string
  /** The colour as printed (ink) or as the card stock it is printed on (paper). */
  hex: string
  name: Localized
}

export interface TicketTemplate {
  id: TemplateId
  version: number
  name: Localized
  tier: PrintTier
  /** Shows the main artist photo (or the event poster). */
  usesPhoto: boolean
  /**
   * What the colour choice is:
   *  'stock'       the CARD STOCK the shop loads (never printed; black-only print on it)
   *  'background'  a ground the template prints edge to edge (print shop)
   *  'accent'      the accent ink on a white ticket
   */
  swatchRole: 'stock' | 'background' | 'accent'
  swatches: Swatch[]
}

const L = (en: string, fr: string, ht: string): Localized => ({ en, fr, ht })

export const TICKET_TEMPLATES: readonly TicketTemplate[] = [
  {
    id: 'coloured_card',
    version: 1,
    name: L('Coloured card', 'Carton coloré', 'Katon koulè'),
    tier: 'cybercafe',
    usesPhoto: true,
    swatchRole: 'stock',
    swatches: [
      { id: 'yellow', hex: '#F2D64B', name: L('Yellow', 'Jaune', 'Jòn') },
      { id: 'pink', hex: '#F4A9B8', name: L('Pink', 'Rose', 'Woz') },
      { id: 'mint', hex: '#9ED9D0', name: L('Mint', 'Menthe', 'Mant') },
      { id: 'orange', hex: '#F5B26B', name: L('Orange', 'Orange', 'Zoranj') },
      { id: 'cream', hex: '#F5F1E8', name: L('Cream', 'Crème', 'Krèm') },
    ],
  },
  {
    id: 'kraft_foil',
    version: 1,
    name: L('Kraft + foil', 'Kraft et dorure', 'Kraft ak dorur'),
    tier: 'print_shop',
    usesPhoto: true,
    swatchRole: 'background',
    swatches: [
      { id: 'kraft', hex: '#CDB386', name: L('Kraft', 'Kraft', 'Kraft') },
      { id: 'dark_kraft', hex: '#B8956A', name: L('Dark kraft', 'Kraft foncé', 'Kraft fonse') },
      { id: 'cream', hex: '#EDE3CC', name: L('Cream', 'Crème', 'Krèm') },
      { id: 'sage', hex: '#C5C9A4', name: L('Sage', 'Sauge', 'Sali') },
    ],
  },
  {
    id: 'clean_white',
    version: 1,
    name: L('Clean white', 'Blanc épuré', 'Blan senp'),
    tier: 'cybercafe',
    usesPhoto: false,
    swatchRole: 'accent',
    swatches: [
      { id: 'teal', hex: '#0F8C7E', name: L('Teal', 'Sarcelle', 'Vèt ble') },
      { id: 'black', hex: '#111111', name: L('Black', 'Noir', 'Nwa') },
      { id: 'red', hex: '#B4232A', name: L('Red', 'Rouge', 'Wouj') },
      { id: 'blue', hex: '#1F4FA3', name: L('Blue', 'Bleu', 'Ble') },
      { id: 'gold', hex: '#A87A1E', name: L('Gold', 'Or', 'Lò') },
    ],
  },
  {
    id: 'poster_photo',
    version: 1,
    name: L('Poster photo', 'Affiche photo', 'Afich foto'),
    tier: 'print_shop',
    usesPhoto: true,
    swatchRole: 'accent',
    swatches: [
      { id: 'yellow', hex: '#F2D64B', name: L('Yellow', 'Jaune', 'Jòn') },
      { id: 'teal', hex: '#2EC4B6', name: L('Teal', 'Sarcelle', 'Vèt ble') },
      { id: 'pink', hex: '#F4A9B8', name: L('Pink', 'Rose', 'Woz') },
      { id: 'orange', hex: '#F5873B', name: L('Orange', 'Orange', 'Zoranj') },
      { id: 'white', hex: '#FFFFFF', name: L('White', 'Blanc', 'Blan') },
    ],
  },
  {
    id: 'bold_type',
    version: 1,
    name: L('Bold type', 'Grande typo', 'Gwo lèt'),
    tier: 'cybercafe',
    usesPhoto: false,
    swatchRole: 'accent',
    swatches: [
      { id: 'black', hex: '#141414', name: L('Black', 'Noir', 'Nwa') },
      { id: 'teal', hex: '#0F8C7E', name: L('Teal', 'Sarcelle', 'Vèt ble') },
      { id: 'red', hex: '#C0262D', name: L('Red', 'Rouge', 'Wouj') },
      { id: 'blue', hex: '#1F4FA3', name: L('Blue', 'Bleu', 'Ble') },
      { id: 'purple', hex: '#5B2A86', name: L('Purple', 'Violet', 'Vyolèt') },
    ],
  },
  {
    id: 'veve_border',
    version: 1,
    name: L('Vèvè border', 'Cadre vèvè', 'Bòdi vèvè'),
    tier: 'cybercafe',
    usesPhoto: false,
    swatchRole: 'accent',
    swatches: [
      { id: 'black', hex: '#1A1A1A', name: L('Black', 'Noir', 'Nwa') },
      { id: 'teal', hex: '#0F766E', name: L('Teal', 'Sarcelle', 'Vèt ble') },
      { id: 'burgundy', hex: '#7A1F2B', name: L('Burgundy', 'Bordeaux', 'Bòdo') },
      { id: 'navy', hex: '#1F2F5C', name: L('Navy', 'Marine', 'Ble maren') },
      { id: 'bronze', hex: '#7A5A2A', name: L('Bronze', 'Bronze', 'Bwonz') },
    ],
  },
] as const

/** A batch ordered before the gallery existed prints with this one. */
export const DEFAULT_TEMPLATE_ID: TemplateId = 'clean_white'

export const TEMPLATE_IDS: readonly TemplateId[] = TICKET_TEMPLATES.map((t) => t.id)

export function getTemplate(id: unknown): TicketTemplate | null {
  return TICKET_TEMPLATES.find((t) => t.id === id) || null
}

/** The swatch a design names, or the template's first one. */
export function swatchFor(template: TicketTemplate, colorId: unknown): Swatch {
  return template.swatches.find((s) => s.id === colorId) || template.swatches[0]
}

export const MAX_LOGOS = 3
export const OVERRIDE_LIMITS = { title: 80, priceLine: 28, phone: 24 } as const

export interface DesignOverrides {
  title?: string
  priceLine?: string
  phone?: string
}

/** What the organizer sends (order screen → API). */
export interface DesignInput {
  template: string
  color?: string
  /** An upload of this event (event-photos/{eventId}/printed/…) or the event's own poster. */
  photoUrl?: string | null
  logos?: string[]
  overrides?: DesignOverrides
}

/** What a batch stores (physical_batches/{id}.design). */
export interface BatchDesign {
  template: TemplateId
  version: number
  color: string
  photo_url: string | null
  photo_source: 'upload' | 'poster' | null
  logos: string[]
  overrides: DesignOverrides
  /** Denormalized for the app (it has no copy of this registry). */
  template_name: Localized
  approved_at: string | null
  approved_by: string | null
}

export type DesignValidation = { ok: true; value: Omit<BatchDesign, 'approved_at' | 'approved_by'> } | { ok: false; error: string; code: string }

/** Printable text only: no control characters, single spaces, trimmed and capped. */
export function cleanOverride(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}

/**
 * Validate a design from the order screen. Image links are only accepted when
 * `sources` vouches for them: an upload stored under this event's folder, or
 * the event's own poster. The server fetches these to print, so a free URL
 * would let anyone point it anywhere.
 */
export function validateDesignInput(
  raw: unknown,
  sources: { isOwnUpload: (url: string) => boolean; posterUrl?: string | null }
): DesignValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'design_required', error: 'Choose a ticket design.' }
  const d = raw as Record<string, unknown>
  const template = getTemplate(d.template)
  if (!template) return { ok: false, code: 'unknown_template', error: 'Choose one of the ticket designs.' }
  if (d.color != null && !template.swatches.some((s) => s.id === d.color)) {
    return { ok: false, code: 'unknown_color', error: 'Choose one of the colours of this design.' }
  }
  const color = swatchFor(template, d.color).id

  let photo_url: string | null = null
  let photo_source: BatchDesign['photo_source'] = null
  const photo = typeof d.photoUrl === 'string' ? d.photoUrl.trim() : ''
  if (photo && template.usesPhoto) {
    if (sources.posterUrl && photo === sources.posterUrl) {
      photo_url = photo
      photo_source = 'poster'
    } else if (sources.isOwnUpload(photo)) {
      photo_url = photo
      photo_source = 'upload'
    } else {
      return { ok: false, code: 'bad_photo', error: 'Upload the photo again.' }
    }
  }

  const logosRaw = Array.isArray(d.logos) ? d.logos : []
  if (logosRaw.length > MAX_LOGOS) return { ok: false, code: 'too_many_logos', error: `At most ${MAX_LOGOS} logos.` }
  const logos: string[] = []
  for (const l of logosRaw) {
    const url = typeof l === 'string' ? l.trim() : ''
    if (!url || !sources.isOwnUpload(url)) return { ok: false, code: 'bad_logo', error: 'Upload the logo again.' }
    if (!logos.includes(url)) logos.push(url)
  }

  const o = (d.overrides && typeof d.overrides === 'object' ? d.overrides : {}) as Record<string, unknown>
  const overrides: DesignOverrides = {}
  const title = cleanOverride(o.title, OVERRIDE_LIMITS.title)
  const priceLine = cleanOverride(o.priceLine, OVERRIDE_LIMITS.priceLine)
  const phone = cleanOverride(o.phone, OVERRIDE_LIMITS.phone)
  if (title) overrides.title = title
  if (priceLine) overrides.priceLine = priceLine
  if (phone) overrides.phone = phone

  return {
    ok: true,
    value: {
      template: template.id,
      version: template.version,
      color,
      photo_url,
      photo_source,
      logos,
      overrides,
      template_name: { ...template.name },
    },
  }
}

/** The design a batch prints with: its own, or the default for a batch ordered before the gallery. */
export function designOf(batch: Record<string, any> | null | undefined): BatchDesign {
  const d = (batch?.design || null) as Partial<BatchDesign> | null
  const template = getTemplate(d?.template) || getTemplate(DEFAULT_TEMPLATE_ID)!
  return {
    template: template.id,
    version: Number(d?.version) || template.version,
    color: swatchFor(template, d?.color).id,
    photo_url: typeof d?.photo_url === 'string' ? d.photo_url : null,
    photo_source: d?.photo_source === 'upload' || d?.photo_source === 'poster' ? d.photo_source : null,
    logos: Array.isArray(d?.logos) ? d!.logos!.filter((x) => typeof x === 'string').slice(0, MAX_LOGOS) : [],
    overrides: (d?.overrides && typeof d.overrides === 'object' ? d.overrides : {}) as DesignOverrides,
    template_name: { ...template.name },
    approved_at: typeof d?.approved_at === 'string' ? d.approved_at : null,
    approved_by: typeof d?.approved_by === 'string' ? d.approved_by : null,
  }
}
