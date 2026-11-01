import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { fetchOwnPoster } from './hosts'
import { H, W, defaultPalette, getTemplate, type PosterData, type TemplateDef } from './templates'

/**
 * Draws a poster template as a JPEG. Shared by the picker's live previews
 * (GET /api/posters/preview), saving a poster to an event
 * (POST /api/posters/create) and the showcase seeding script.
 */

export interface PosterInput {
  template: string
  /** Colourway 0–2; omitted → picked from `seed` so events vary. */
  palette?: number
  seed?: string
  title: string
  /** Local wall time of the event, "YYYY-MM-DDTHH:mm". */
  start: string
  venue?: string
  city?: string
  lineup?: string[]
  presenter?: string
  locale?: 'ht' | 'fr' | 'en'
  /** Background photo (our bucket or an Unsplash photo). */
  photo?: string
}

// Caps so a public preview can't be asked to draw a novel.
export const LIMITS = { title: 60, venue: 60, city: 40, presenter: 40, lineupItems: 9, lineupItem: 32 }

export function cleanInput(raw: Partial<Record<keyof PosterInput, unknown>>): PosterInput | null {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const template = s(raw.template, 40)
  const title = s(raw.title, LIMITS.title)
  const start = s(raw.start, 16)
  if (!getTemplate(template) || !title || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return null
  const lineupRaw = Array.isArray(raw.lineup) ? raw.lineup : typeof raw.lineup === 'string' ? raw.lineup.split('|') : []
  const palette = Number(raw.palette)
  const locale = raw.locale === 'fr' || raw.locale === 'en' ? raw.locale : 'ht'
  return {
    template,
    title,
    start,
    palette: Number.isInteger(palette) && palette >= 0 && palette <= 2 ? palette : undefined,
    seed: s(raw.seed, 80) || title,
    venue: s(raw.venue, LIMITS.venue),
    city: s(raw.city, LIMITS.city),
    presenter: s(raw.presenter, LIMITS.presenter),
    lineup: lineupRaw.map((x) => s(x, LIMITS.lineupItem)).filter(Boolean).slice(0, LIMITS.lineupItems),
    locale,
    photo: s(raw.photo, 1000) || undefined,
  }
}

// ---------------------------------------------------------------------------
// Dates, in the event's own language.

const MONTHS = {
  ht: ['Janvye', 'Fevriye', 'Mas', 'Avril', 'Me', 'Jen', 'Jiyè', 'Out', 'Septanm', 'Oktòb', 'Novanm', 'Desanm'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
const MONTHS_SHORT = {
  ht: ['Jan', 'Fev', 'Mas', 'Avr', 'Me', 'Jen', 'Jiy', 'Out', 'Sep', 'Okt', 'Nov', 'Des'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
const DAYS = {
  ht: ['Dimanch', 'Lendi', 'Madi', 'Mèkredi', 'Jedi', 'Vandredi', 'Samdi'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}
const DAYS_SHORT = {
  ht: ['Dim', 'Len', 'Mad', 'Mèk', 'Jed', 'Van', 'Sam'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

function dateParts(start: string, locale: 'ht' | 'fr' | 'en') {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number)
  const [hh, mm] = start.slice(11, 16).split(':').map(Number)
  // Weekday from the calendar date alone (UTC noon avoids any DST edge).
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  const time =
    locale === 'en'
      ? `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${hh < 12 ? 'AM' : 'PM'}`
      : locale === 'fr'
        ? `${hh}h${mm ? String(mm).padStart(2, '0') : ''}`
        : `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${hh < 12 ? 'è dimaten' : hh < 18 ? 'è' : 'è diswa'}`
  return {
    day: String(d),
    monthShort: cap(MONTHS_SHORT[locale][m - 1]),
    monthLong: cap(MONTHS[locale][m - 1]),
    weekdayShort: cap(DAYS_SHORT[locale][wd]),
    dateShort: `${cap(DAYS_SHORT[locale][wd])} ${d} ${cap(MONTHS_SHORT[locale][m - 1])}`,
    dateLong: `${cap(DAYS[locale][wd])} ${d} ${locale === 'en' ? MONTHS[locale][m - 1] : cap(MONTHS[locale][m - 1])}`,
    time,
  }
}

// ---------------------------------------------------------------------------
// Fonts (read once per instance) and the photo treatment.

type Font = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' | 'italic' }
let fontsPromise: Promise<Font[]> | null = null

function loadFonts(): Promise<Font[]> {
  if (!fontsPromise) {
    const dir = path.join(process.cwd(), 'assets', 'fonts')
    const f = (file: string, name: string, weight: Font['weight'], style: Font['style'] = 'normal') =>
      readFile(path.join(dir, file)).then((data) => ({ name, data, weight, style }))
    fontsPromise = Promise.all([
      f('Anton-Regular.ttf', 'Anton', 400),
      f('BebasNeue-Regular.ttf', 'Bebas Neue', 400),
      f('ArchivoBlack-Regular.ttf', 'Archivo Black', 400),
      f('Syne-ExtraBold.ttf', 'Syne', 800),
      f('SpaceGrotesk-Medium.ttf', 'Space Grotesk', 500),
      f('SpaceGrotesk-Bold.ttf', 'Space Grotesk', 700),
      f('DMSerifDisplay-Italic.ttf', 'DM Serif Display', 400, 'italic'),
      f('Unbounded-Black.ttf', 'Unbounded', 900),
      f('Inter-Medium.ttf', 'Inter', 500),
      f('Inter-SemiBold.ttf', 'Inter', 600),
      f('InstrumentSerif-Italic.ttf', 'Instrument Serif', 400, 'italic'),
    ])
    fontsPromise.catch(() => {
      fontsPromise = null
    })
  }
  return fontsPromise
}

function hexRgb(hex: string) {
  const v = parseInt(hex.replace('#', ''), 16)
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

async function preparePhoto(url: string | undefined, t: TemplateDef, tint: string): Promise<string | null> {
  if (!t.usesPhoto || !url) return null
  const buf = await fetchOwnPoster(url).catch(() => null)
  if (!buf) return null
  const { default: sharp } = await import('sharp')
  let img = sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate().resize(W, H, { fit: 'cover' })
  if (t.treatment === 'mono') img = img.grayscale().linear(1.15, -12)
  // No grayscale(): sharp applies it last, after tint, which greys the tint out.
  if (t.treatment === 'duotone') img = img.linear(1.1, -10).tint(hexRgb(tint))
  if (t.treatment === 'darken') img = img.modulate({ brightness: 0.92 })
  const out = await img.jpeg({ quality: 82 }).toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

/** The poster as a JPEG buffer. */
export async function renderPoster(input: PosterInput): Promise<Buffer> {
  const t = getTemplate(input.template)
  if (!t) throw new Error('unknown template')
  const paletteIdx = input.palette ?? defaultPalette(input.seed || input.title)
  const palette = t.palettes[paletteIdx]
  const [fonts, photo] = await Promise.all([loadFonts(), preparePhoto(input.photo, t, palette.accent)])
  const data: PosterData = {
    title: input.title,
    ...dateParts(input.start, input.locale || 'ht'),
    venue: input.venue || '',
    city: input.city || '',
    lineup: input.lineup || [],
    presenter: input.presenter || '',
    photo,
    palette,
  }
  const png = await new ImageResponse(t.render(data), { width: W, height: H, fonts }).arrayBuffer()
  const { default: sharp } = await import('sharp')
  return sharp(Buffer.from(png)).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
}
