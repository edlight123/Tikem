/* eslint-disable @next/next/no-img-element */
/**
 * Poster templates: an event's own facts set as a designed flyer.
 *
 * POSH looks finished because every organizer uploads a designed flyer with
 * the title, date and venue in the art. An organizer without a designer here
 * got a bare stock photo. These templates turn that photo (or a colour field)
 * into a real poster.
 *
 * Drawn with satori (next/og) at 1080x1350, the 4:5 every poster frame uses.
 * satori is flexbox-only: any element with more than one child sets
 * display:flex, and there are no filters — photo treatments (darken, mono,
 * duotone) happen in sharp before the photo reaches the template.
 *
 * So two events never look alike: 18 layouts, each with three colourways, and
 * an event lands on a colourway picked from its id unless the organizer
 * chooses one.
 */
import type { ReactElement } from 'react'

export const W = 1080
export const H = 1350

export type PhotoTreatment = 'darken' | 'mono' | 'duotone' | 'none'

export interface Palette {
  /** Field colour (solid templates) / band colour. */
  bg: string
  /** Main ink on the field. */
  ink: string
  /** Accent (date bars, highlights). */
  accent: string
  /** Ink on the accent. */
  onAccent: string
}

export interface PosterData {
  title: string
  /** e.g. "Sam 14 Nov" — already localised. */
  dateShort: string
  /** e.g. "Samdi 14 Novanm" */
  dateLong: string
  day: string
  monthShort: string
  monthLong: string
  weekdayShort: string
  time: string
  venue: string
  city: string
  lineup: string[]
  presenter: string
  /** Photo as a data: URL after treatment, or null for colour-field templates. */
  photo: string | null
  palette: Palette
}

export interface TemplateDef {
  id: string
  /** Layout family shown as a group in the picker. */
  family: 'minimal' | 'bold' | 'date' | 'lineup' | 'editorial'
  /** Whether the template uses the event photo. */
  usesPhoto: boolean
  treatment: PhotoTreatment
  palettes: [Palette, Palette, Palette]
  render: (d: PosterData) => ReactElement
}

// ---------------------------------------------------------------------------
// Fitting text. satori does no auto-fit, so a size is computed from the
// longest line and each face's average glyph width (em fraction, measured for
// the case the template uses). Long titles shrink; nothing runs off the edge.

const GLYPH: Record<string, number> = {
  Anton: 0.47,
  'Bebas Neue': 0.4,
  'Archivo Black': 0.78,
  Unbounded: 1.0,
  Syne: 0.86,
  /** Syne set in capitals (neon). */
  'Syne Caps': 1.18,
  'Space Grotesk': 0.66,
  'Instrument Serif': 0.42,
  'DM Serif Display': 0.5,
  /** DM Serif set in capitals (the magazine masthead). */
  'DM Serif Caps': 0.74,
  Inter: 0.6,
}

export function fit(lines: string[], font: keyof typeof GLYPH, maxWidth: number, maxSize: number, maxHeight?: number, lineHeight = 0.95): number {
  const longest = Math.max(1, ...lines.map((l) => l.length))
  let size = Math.min(maxSize, maxWidth / (longest * GLYPH[font]))
  if (maxHeight) size = Math.min(size, maxHeight / (lines.length * lineHeight))
  return Math.floor(size)
}

/** Greedy word wrap into at most `max` lines of roughly `target` characters. */
export function wrap(text: string, target: number, max: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  for (const w of words) {
    const last = lines[lines.length - 1]
    if (last !== undefined && (last + ' ' + w).length <= target) lines[lines.length - 1] = last + ' ' + w
    else lines.push(w)
  }
  if (lines.length <= max) return lines
  // Too many lines: fold the overflow into the last one (fit() then shrinks it).
  return [...lines.slice(0, max - 1), lines.slice(max - 1).join(' ')]
}

const place = (d: PosterData) => [d.venue, d.city].filter(Boolean).join(' · ')

// Shorthands --------------------------------------------------------------
const col = (s: object = {}) => ({ display: 'flex', flexDirection: 'column' as const, ...s })
const row = (s: object = {}) => ({ display: 'flex', flexDirection: 'row' as const, ...s })
const abs = { position: 'absolute' as const, top: 0, left: 0, width: W, height: H }

function Photo({ d }: { d: PosterData }) {
  return d.photo ? <img alt="" src={d.photo} width={W} height={H} style={{ ...abs, objectFit: 'cover' }} /> : <div style={{ ...abs, backgroundColor: d.palette.bg }} />
}

function Frame({ d, children }: { d: PosterData; children: ReactElement | ReactElement[] }) {
  return (
    <div style={{ ...row(), width: W, height: H, position: 'relative', backgroundColor: d.palette.bg, color: d.palette.ink }}>
      {children}
    </div>
  )
}

const P = (bg: string, ink: string, accent: string, onAccent: string): Palette => ({ bg, ink, accent, onAccent })
const TEAL = '#14B8A6'

// ---------------------------------------------------------------------------
// MINIMAL SERIF

const serifCenter: TemplateDef = {
  id: 'serif-center',
  family: 'minimal',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#0A0A0A', '#FFFFFF', '#FFFFFF', '#0A0A0A'), P('#0A0A0A', '#F3E9D2', '#F3E9D2', '#0A0A0A'), P('#0A0A0A', '#FFFFFF', TEAL, '#04201C')],
  render: (d) => {
    const lines = wrap(d.title.toLowerCase(), 10, 3)
    const size = fit(lines, 'Instrument Serif', 860, 230, 620)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0.35), rgba(0,0,0,0.72) 80%)' }} />
        <div style={{ ...abs, ...col({ alignItems: 'center', justifyContent: 'center', padding: 80, textAlign: 'center' }) }}>
          {d.presenter ? <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 26, letterSpacing: 9, textTransform: 'uppercase', opacity: 0.85 }}>{d.presenter}</div> : <div />}
          <div style={col({ alignItems: 'center', fontFamily: 'Instrument Serif', fontStyle: 'italic', fontSize: size, lineHeight: 0.95, margin: '44px 0 48px', color: d.palette.ink })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ width: 80, height: 3, backgroundColor: d.palette.accent, opacity: 0.8, marginBottom: 40 }} />
          <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 32, letterSpacing: 5, textTransform: 'uppercase' }}>{`${d.dateShort} · ${d.time}`}</div>
          <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 30, letterSpacing: 5, textTransform: 'uppercase', opacity: 0.7, marginTop: 14 }}>{place(d)}</div>
        </div>
      </Frame>
    )
  },
}

const serifDuotone: TemplateDef = {
  id: 'serif-duotone',
  family: 'minimal',
  usesPhoto: true,
  treatment: 'duotone',
  palettes: [P('#0F3D39', '#FFFFFF', TEAL, '#04201C'), P('#3B1530', '#FFFFFF', '#F2A7C9', '#3B1530'), P('#14254D', '#FFFFFF', '#8FB4FF', '#14254D')],
  render: (d) => {
    const lines = wrap(d.title, 12, 3)
    const size = fit(lines, 'DM Serif Display', 900, 170, 520)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0) 62%)' }} />
        <div style={{ ...abs, ...col({ justifyContent: 'flex-end', padding: 72 }) }}>
          <div style={col({ fontFamily: 'DM Serif Display', fontStyle: 'italic', fontSize: size, lineHeight: 0.95 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 36, marginTop: 40 }}>{`${d.dateLong} · ${d.time}`}</div>
          <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 34, opacity: 0.65, marginTop: 8 }}>{place(d)}</div>
        </div>
      </Frame>
    )
  },
}

const serifPaper: TemplateDef = {
  id: 'serif-paper',
  family: 'minimal',
  usesPhoto: false,
  treatment: 'none',
  palettes: [P('#E9E1D3', '#141414', '#141414', '#E9E1D3'), P('#D9E4DD', '#10302A', '#10302A', '#D9E4DD'), P('#F2D7C4', '#3A1A10', '#3A1A10', '#F2D7C4')],
  render: (d) => {
    const lines = wrap(d.title.toLowerCase(), 9, 4)
    const size = fit(lines, 'Instrument Serif', 920, 250, 760, 0.88)
    return (
      <Frame d={d}>
        <div style={{ ...abs, ...col({ justifyContent: 'space-between', padding: 72 }) }}>
          <div style={row({ justifyContent: 'space-between', fontFamily: 'Inter', fontWeight: 600, fontSize: 28, letterSpacing: 7, textTransform: 'uppercase' })}>
            <div>{d.city || d.venue}</div>
            <div>{`${d.day} ${d.monthShort}`}</div>
          </div>
          <div style={col({ fontFamily: 'Instrument Serif', fontStyle: 'italic', fontSize: size, lineHeight: 0.88 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={col({ fontFamily: 'Inter', fontWeight: 500, fontSize: 34 })}>
            <div>{`${d.dateLong} · ${d.time}`}</div>
            <div style={{ opacity: 0.6, marginTop: 6 }}>{place(d)}</div>
          </div>
        </div>
      </Frame>
    )
  },
}

// ---------------------------------------------------------------------------
// BOLD HEADLINE

const stackBar: TemplateDef = {
  id: 'stack-bar',
  family: 'bold',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#0A0A0A', '#FFFFFF', TEAL, '#06201D'), P('#0A0A0A', '#FFFFFF', '#FFE14D', '#141414'), P('#0A0A0A', '#FFFFFF', '#E63B2E', '#FFFFFF')],
  render: (d) => {
    const words = d.title.toUpperCase().split(/\s+/).filter(Boolean)
    const lines = words.length > 4 ? wrap(d.title.toUpperCase(), 9, 4) : words
    const size = fit(lines, 'Anton', 980, 290, 820, 0.84)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.78))' }} />
        <div style={{ ...abs, ...col({ justifyContent: 'flex-end' }) }}>
          <div style={col({ fontFamily: 'Anton', fontSize: size, lineHeight: 0.84, padding: '0 60px' })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={row({ marginTop: 48, backgroundColor: d.palette.accent, color: d.palette.onAccent, padding: '30px 60px', justifyContent: 'space-between', fontFamily: 'Anton', fontSize: 62, textTransform: 'uppercase' })}>
            <div>{d.dateShort}</div>
            <div>{`${d.city || d.venue} · ${d.time}`}</div>
          </div>
        </div>
      </Frame>
    )
  },
}

const tiltPop: TemplateDef = {
  id: 'tilt-pop',
  family: 'bold',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#0A0A0A', '#FFE14D', '#B3261E', '#FFFFFF'), P('#0A0A0A', '#FFFFFF', '#E0218A', '#FFFFFF'), P('#0A0A0A', '#7CF5E4', '#2D4BFF', '#FFFFFF')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 9, 3)
    const size = fit(lines, 'Unbounded', 960, 190, 560, 0.92)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundColor: 'rgba(10,10,10,0.42)' }} />
        <div style={{ ...abs, ...col({ justifyContent: 'center', padding: 60 }) }}>
          <div style={col({ fontFamily: 'Unbounded', fontWeight: 900, fontSize: size, lineHeight: 0.92, color: d.palette.ink, transform: 'rotate(-6deg)', textShadow: `0 10px 0 ${d.palette.accent}` })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
        <div style={{ ...row({ position: 'absolute', left: 64, right: 64, bottom: 64, justifyContent: 'space-between', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 38, textTransform: 'uppercase', color: '#FFFFFF' }) }}>
          <div style={col()}>
            <div>{d.dateShort}</div>
            <div style={{ opacity: 0.7 }}>{d.time}</div>
          </div>
          <div style={col({ alignItems: 'flex-end' })}>
            <div>{d.venue}</div>
            <div style={{ opacity: 0.7 }}>{d.city}</div>
          </div>
        </div>
      </Frame>
    )
  },
}

const outlineBlock: TemplateDef = {
  id: 'outline-block',
  family: 'bold',
  usesPhoto: true,
  treatment: 'mono',
  palettes: [P('#000000', '#FFFFFF', '#B9A6FF', '#000000'), P('#000000', '#FFFFFF', TEAL, '#000000'), P('#000000', '#F3E9D2', '#F2701E', '#000000')],
  render: (d) => {
    const words = d.title.toUpperCase().split(/\s+/).filter(Boolean)
    const first = words[0] || ''
    const rest = wrap(words.slice(1).join(' ') || first, 12, 2)
    const size = fit([first, ...rest], 'Bebas Neue', 960, 250, 640, 0.86)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 36%, #000 60%)' }} />
        <div style={{ ...abs, ...col({ justifyContent: 'flex-end', padding: 64 }) }}>
          <div style={{ fontFamily: 'Bebas Neue', fontSize: size, lineHeight: 0.86, color: d.palette.accent, opacity: 0.55 }}>{first}</div>
          {words.length > 1 && (
            <div style={col({ fontFamily: 'Bebas Neue', fontSize: size, lineHeight: 0.86, color: d.palette.ink })}>
              {rest.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 32, letterSpacing: 3, textTransform: 'uppercase', marginTop: 36 }}>{`${d.dateShort} · ${d.time} · ${place(d)}`}</div>
        </div>
      </Frame>
    )
  },
}

// ---------------------------------------------------------------------------
// DATE FIRST

const giantDate: TemplateDef = {
  id: 'giant-date',
  family: 'date',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#0A0A0A', '#FFFFFF', TEAL, '#04201C'), P('#0A0A0A', '#FFFFFF', '#FFE14D', '#141414'), P('#0A0A0A', '#FFFFFF', '#F2A7C9', '#3B1530')],
  render: (d) => {
    const lines = wrap(d.title, 16, 2)
    const size = fit(lines, 'Instrument Serif', 940, 130)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'linear-gradient(to bottom, #0A0A0A 40%, rgba(10,10,10,0.1) 72%, rgba(10,10,10,0.65))' }} />
        <div style={{ ...abs, ...col({ padding: 72 }) }}>
          <div style={row({ alignItems: 'flex-start' })}>
            <div style={{ fontFamily: 'Anton', fontSize: 420, lineHeight: 0.8 }}>{d.day}</div>
            <div style={col({ fontFamily: 'Anton', fontSize: 84, lineHeight: 1, marginLeft: 26, marginTop: 14, textTransform: 'uppercase' })}>
              <div>{d.monthShort}</div>
              <div style={{ color: d.palette.accent }}>{d.weekdayShort}</div>
            </div>
          </div>
          <div style={col({ fontFamily: 'Instrument Serif', fontStyle: 'italic', fontSize: size, lineHeight: 1, marginTop: 36 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ marginTop: 'auto', fontFamily: 'Inter', fontWeight: 600, fontSize: 30, letterSpacing: 5, textTransform: 'uppercase' }}>{`${d.time} · ${place(d)}`}</div>
        </div>
      </Frame>
    )
  },
}

const calendarTile: TemplateDef = {
  id: 'calendar-tile',
  family: 'date',
  usesPhoto: false,
  treatment: 'none',
  palettes: [P('#B3261E', '#FFFFFF', '#FFFFFF', '#111111'), P('#2D4BFF', '#FFFFFF', '#FFFFFF', '#111111'), P('#0F3D39', '#F3E9D2', '#F3E9D2', '#111111')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 10, 3)
    const size = fit(lines, 'Archivo Black', 940, 170, 520, 0.92)
    return (
      <Frame d={d}>
        <div style={{ ...abs, ...col({ justifyContent: 'space-between', padding: 72 }) }}>
          <div style={col({ width: 300, backgroundColor: d.palette.accent, color: d.palette.onAccent, borderRadius: 10, alignItems: 'center' })}>
            <div style={{ ...row({ justifyContent: 'center' }), width: 300, backgroundColor: '#111111', color: '#FFFFFF', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 34, letterSpacing: 6, padding: '16px 0', textTransform: 'uppercase', borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>{d.monthLong}</div>
            <div style={{ fontFamily: 'Archivo Black', fontSize: 210, lineHeight: 1.1, paddingBottom: 18 }}>{d.day}</div>
          </div>
          <div style={col()}>
            <div style={col({ fontFamily: 'Archivo Black', fontSize: size, lineHeight: 0.92 })}>
              {lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 36, marginTop: 36, opacity: 0.9 }}>{`${d.dateLong} · ${d.time}`}</div>
            <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 34, opacity: 0.7 }}>{place(d)}</div>
          </div>
        </div>
      </Frame>
    )
  },
}

const dateRail: TemplateDef = {
  id: 'date-rail',
  family: 'date',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#F5F0E6', '#FFFFFF', '#F5F0E6', '#111111'), P(TEAL, '#FFFFFF', TEAL, '#04201C'), P('#FFE14D', '#FFFFFF', '#FFE14D', '#141414')],
  render: (d) => {
    const lines = wrap(d.title, 9, 3)
    const size = fit(lines, 'Syne', 760, 150, 480, 0.95)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundColor: 'rgba(0,0,0,0.38)' }} />
        <div style={{ ...col({ position: 'absolute', left: 0, top: 0, bottom: 0, width: 216, backgroundColor: d.palette.accent, color: d.palette.onAccent, alignItems: 'center', justifyContent: 'center' }) }}>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 36, letterSpacing: 8, textTransform: 'uppercase' }}>{d.weekdayShort}</div>
          <div style={{ fontFamily: 'Bebas Neue', fontSize: 190, lineHeight: 1 }}>{d.day}</div>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 36, letterSpacing: 8, textTransform: 'uppercase' }}>{d.monthShort}</div>
        </div>
        <div style={{ ...col({ position: 'absolute', left: 216, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', padding: 64 }) }}>
          <div style={col({ fontFamily: 'Syne', fontWeight: 800, fontSize: size, lineHeight: 0.95 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 32, marginTop: 30, opacity: 0.9 }}>{`${d.time} · ${place(d)}`}</div>
        </div>
      </Frame>
    )
  },
}

// ---------------------------------------------------------------------------
// LINEUP (falls back gracefully when there's no lineup: the title takes over)

function lineupTiers(names: string[]): string[][] {
  if (names.length <= 2) return [names]
  if (names.length <= 5) return [names.slice(0, 2), names.slice(2)]
  return [names.slice(0, 2), names.slice(2, 5), names.slice(5, 9)]
}

const billCenter: TemplateDef = {
  id: 'bill-center',
  family: 'lineup',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#050505', '#FFFFFF', '#FFFFFF', '#050505'), P('#050505', '#FFE9B8', '#FFE9B8', '#050505'), P('#050505', '#FFFFFF', TEAL, '#050505')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 12, 2)
    const size = fit(lines, 'Anton', 900, 170)
    const tiers = lineupTiers(d.lineup)
    const tierSize = [84, 60, 44]
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundColor: 'rgba(5,5,5,0.62)' }} />
        <div style={{ ...abs, ...col({ alignItems: 'center', justifyContent: 'center', padding: 64, textAlign: 'center' }) }}>
          {d.presenter ? <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 28, letterSpacing: 9, textTransform: 'uppercase', opacity: 0.75 }}>{d.presenter}</div> : <div />}
          <div style={col({ alignItems: 'center', fontFamily: 'Anton', fontSize: size, lineHeight: 0.9, margin: '30px 0 44px', color: d.palette.ink })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          {tiers.map((t, i) => (
            <div key={i} style={{ fontFamily: 'Bebas Neue', fontSize: fit([t.join(' · ')], 'Bebas Neue', 940, tierSize[i]), letterSpacing: 2, opacity: 1 - i * 0.18, textTransform: 'uppercase' }}>{t.join(' · ')}</div>
          ))}
          <div style={{ marginTop: 48, fontFamily: 'Inter', fontWeight: 600, fontSize: 30, letterSpacing: 5, textTransform: 'uppercase', color: d.palette.accent }}>{`${d.dateShort} · ${place(d)} · ${d.time}`}</div>
        </div>
      </Frame>
    )
  },
}

const setTimes: TemplateDef = {
  id: 'set-times',
  family: 'lineup',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#000000', '#FFFFFF', '#FFFFFF', '#000000'), P('#000000', '#FFFFFF', '#B9A6FF', '#000000'), P('#000000', '#FFFFFF', TEAL, '#000000')],
  render: (d) => {
    const lines = wrap(d.title.toLowerCase(), 10, 3)
    const size = fit(lines, 'Instrument Serif', 600, 150, 420)
    const names = d.lineup.length ? d.lineup.slice(0, 7) : [d.venue, d.city].filter(Boolean)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.92) 55%, rgba(0,0,0,0.2))' }} />
        <div style={{ ...abs, ...col({ padding: 72 }) }}>
          <div style={col({ fontFamily: 'Instrument Serif', fontStyle: 'italic', fontSize: size, lineHeight: 0.95 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={col({ marginTop: 56, fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 44, lineHeight: 1.65, textTransform: 'uppercase' })}>
            {names.map((n, i) => <div key={i} style={{ color: i === 0 ? d.palette.accent : d.palette.ink }}>{n}</div>)}
          </div>
          <div style={{ marginTop: 'auto', fontFamily: 'Inter', fontWeight: 500, fontSize: 34, opacity: 0.8 }}>{`${d.dateLong} · ${d.time} · ${d.venue}`}</div>
        </div>
      </Frame>
    )
  },
}

const twoToneList: TemplateDef = {
  id: 'two-tone-list',
  family: 'lineup',
  usesPhoto: false,
  treatment: 'none',
  palettes: [P('#111111', '#FFFFFF', TEAL, '#04201C'), P('#111111', '#FFFFFF', '#FFE14D', '#141414'), P('#F3E9D2', '#141414', '#B3261E', '#FFFFFF')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 11, 2)
    const size = fit(lines, 'Unbounded', 940, 120)
    const names = d.lineup.length ? d.lineup.slice(0, 6) : [d.dateLong, d.time, d.venue, d.city].filter(Boolean)
    return (
      <Frame d={d}>
        <div style={{ ...abs, ...col() }}>
          <div style={col({ backgroundColor: d.palette.accent, color: d.palette.onAccent, padding: '64px 64px 44px' })}>
            <div style={col({ fontFamily: 'Unbounded', fontWeight: 900, fontSize: size, lineHeight: 0.92 })}>
              {lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 36, marginTop: 22, textTransform: 'uppercase' }}>{`${d.dateShort} · ${d.time}`}</div>
          </div>
          <div style={col({ padding: '56px 64px', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 58, lineHeight: 1.5, textTransform: 'uppercase' })}>
            {names.map((n, i) => <div key={i} style={{ opacity: Math.max(0.45, 1 - i * 0.12) }}>{n}</div>)}
          </div>
          <div style={{ marginTop: 'auto', padding: '0 64px 64px', fontFamily: 'Inter', fontWeight: 500, fontSize: 34, opacity: 0.7 }}>{place(d)}</div>
        </div>
      </Frame>
    )
  },
}

// ---------------------------------------------------------------------------
// EDITORIAL (new beyond the mockups)

const framed: TemplateDef = {
  id: 'framed',
  family: 'editorial',
  usesPhoto: true,
  treatment: 'none',
  palettes: [P('#F3E9D2', '#141414', '#141414', '#F3E9D2'), P(TEAL, '#04201C', '#04201C', TEAL), P('#B3261E', '#FFFFFF', '#FFFFFF', '#B3261E')],
  render: (d) => {
    const lines = wrap(d.title, 18, 2)
    const size = fit(lines, 'DM Serif Display', 940, 104)
    return (
      <Frame d={d}>
        <div style={{ ...abs, ...col({ padding: 56 }) }}>
          <div style={row({ justifyContent: 'space-between', fontFamily: 'Inter', fontWeight: 600, fontSize: 28, letterSpacing: 7, textTransform: 'uppercase', marginBottom: 28 })}>
            <div>{d.presenter || d.city}</div>
            <div>{`${d.day}.${d.monthShort}`}</div>
          </div>
          <div style={{ ...row(), width: W - 112, height: 820, overflow: 'hidden', backgroundColor: '#000' }}>
            {d.photo ? <img alt="" src={d.photo} width={W - 112} height={820} style={{ objectFit: 'cover' }} /> : <div />}
          </div>
          <div style={col({ fontFamily: 'DM Serif Display', fontStyle: 'italic', fontSize: size, lineHeight: 0.98, marginTop: 30 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 30, marginTop: 'auto' }}>{`${d.dateLong} · ${d.time} · ${place(d)}`}</div>
        </div>
      </Frame>
    )
  },
}

const splitHalf: TemplateDef = {
  id: 'split-half',
  family: 'editorial',
  usesPhoto: true,
  treatment: 'none',
  palettes: [P('#111111', '#FFFFFF', TEAL, '#04201C'), P('#2D4BFF', '#FFFFFF', '#FFE14D', '#141414'), P('#F2701E', '#141414', '#141414', '#F2701E')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 12, 2)
    const size = fit(lines, 'Archivo Black', 950, 128)
    return (
      <Frame d={d}>
        <div style={{ ...abs, ...col() }}>
          <div style={{ ...row(), width: W, height: 760, overflow: 'hidden' }}>
            {d.photo ? <img alt="" src={d.photo} width={W} height={760} style={{ objectFit: 'cover' }} /> : <div />}
          </div>
          <div style={col({ flexGrow: 1, padding: '54px 64px 60px', justifyContent: 'space-between' })}>
            <div style={col({ fontFamily: 'Archivo Black', fontSize: size, lineHeight: 0.95 })}>
              {lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div style={row({ justifyContent: 'space-between', alignItems: 'flex-end', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 36, textTransform: 'uppercase' })}>
              <div style={col()}>
                <div style={{ color: d.palette.accent }}>{d.dateShort}</div>
                <div>{d.time}</div>
              </div>
              <div style={col({ alignItems: 'flex-end' })}>
                <div>{d.venue}</div>
                <div style={{ opacity: 0.7 }}>{d.city}</div>
              </div>
            </div>
          </div>
        </div>
      </Frame>
    )
  },
}

const neon: TemplateDef = {
  id: 'neon',
  family: 'editorial',
  usesPhoto: false,
  treatment: 'none',
  palettes: [P('#07070C', '#FF4FD8', '#7CF5E4', '#07070C'), P('#07070C', '#7CF5E4', '#FFE14D', '#07070C'), P('#0C0606', '#FF6B3D', '#FFD1A6', '#0C0606')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 9, 3)
    const size = fit(lines, 'Syne Caps', 940, 190, 620, 0.95)
    const glow = `0 0 12px ${d.palette.ink}, 0 0 38px ${d.palette.ink}, 0 0 90px ${d.palette.ink}`
    return (
      <Frame d={d}>
        <div style={{ ...abs, backgroundImage: `radial-gradient(ellipse at 50% 42%, ${d.palette.ink}33, rgba(0,0,0,0) 62%)` }} />
        <div style={{ ...abs, ...col({ alignItems: 'center', justifyContent: 'center', padding: 64, textAlign: 'center' }) }}>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 40, letterSpacing: 10, textTransform: 'uppercase', color: d.palette.accent }}>{d.dateShort}</div>
          <div style={col({ alignItems: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: size, lineHeight: 0.95, color: '#FFFFFF', textShadow: glow, margin: '50px 0' })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 32, letterSpacing: 4, textTransform: 'uppercase', color: '#FFFFFF', opacity: 0.85 }}>{`${d.time} · ${place(d)}`}</div>
        </div>
      </Frame>
    )
  },
}

const ticketStub: TemplateDef = {
  id: 'ticket-stub',
  family: 'editorial',
  usesPhoto: true,
  treatment: 'darken',
  palettes: [P('#F3E9D2', '#141414', '#B3261E', '#FFFFFF'), P('#FFFFFF', '#111111', TEAL, '#04201C'), P('#FFE14D', '#141414', '#141414', '#FFE14D')],
  render: (d) => {
    const lines = wrap(d.title.toUpperCase(), 13, 2)
    const size = fit(lines, 'Anton', 820, 130)
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <div style={{ ...col({ position: 'absolute', left: 70, right: 70, bottom: 80, backgroundColor: d.palette.bg, color: d.palette.ink, borderRadius: 14, padding: '44px 50px' }) }}>
          <div style={row({ justifyContent: 'space-between', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 26, letterSpacing: 6, textTransform: 'uppercase', opacity: 0.7 })}>
            <div>{d.presenter || 'Tikèm'}</div>
            <div>{'ADMIT ONE'}</div>
          </div>
          <div style={col({ fontFamily: 'Anton', fontSize: size, lineHeight: 0.95, marginTop: 20 })}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ height: 0, borderTop: `4px dashed ${d.palette.ink}`, opacity: 0.35, margin: '30px 0' }} />
          <div style={row({ justifyContent: 'space-between', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 34, textTransform: 'uppercase' })}>
            <div style={{ color: d.palette.accent }}>{d.dateShort}</div>
            <div>{d.time}</div>
            <div>{d.city || d.venue}</div>
          </div>
        </div>
      </Frame>
    )
  },
}

const magazine: TemplateDef = {
  id: 'magazine',
  family: 'editorial',
  usesPhoto: true,
  treatment: 'none',
  palettes: [P('#0A0A0A', '#FFFFFF', '#FFFFFF', '#0A0A0A'), P('#0A0A0A', '#FFFFFF', '#FFE14D', '#141414'), P('#0A0A0A', '#FFFFFF', '#E0218A', '#FFFFFF')],
  render: (d) => {
    const mast = d.title.split(/\s+/)[0] || d.title
    const mastSize = fit([mast.toUpperCase()], 'DM Serif Caps', 960, 300)
    const rest = d.title.split(/\s+/).slice(1).join(' ')
    return (
      <Frame d={d}>
        <Photo d={d} />
        <div style={{ ...abs, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.8))' }} />
        <div style={{ ...abs, ...col({ padding: '40px 50px 60px' }) }}>
          <div style={{ fontFamily: 'DM Serif Display', fontSize: mastSize, lineHeight: 0.9, textTransform: 'uppercase', letterSpacing: -2 }}>{mast}</div>
          <div style={row({ justifyContent: 'space-between', fontFamily: 'Inter', fontWeight: 600, fontSize: 26, letterSpacing: 5, textTransform: 'uppercase', borderTop: '2px solid rgba(255,255,255,0.6)', paddingTop: 14, marginTop: 6 })}>
            <div>{d.monthLong}</div>
            <div>{d.city || 'Ayiti'}</div>
          </div>
          <div style={col({ marginTop: 'auto' })}>
            {rest ? <div style={{ fontFamily: 'Instrument Serif', fontStyle: 'italic', fontSize: fit([rest], 'Instrument Serif', 960, 120) }}>{rest}</div> : <div />}
            <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 34, marginTop: 14, color: d.palette.accent }}>{`${d.dateLong} · ${d.time}`}</div>
            <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 32, opacity: 0.8 }}>{place(d)}</div>
          </div>
        </div>
      </Frame>
    )
  },
}

const repeatPattern: TemplateDef = {
  id: 'repeat',
  family: 'editorial',
  usesPhoto: false,
  treatment: 'none',
  palettes: [P('#FFE14D', '#141414', '#141414', '#FFE14D'), P('#E0218A', '#FFFFFF', '#FFFFFF', '#E0218A'), P(TEAL, '#04201C', '#04201C', TEAL)],
  render: (d) => {
    const word = d.title.toUpperCase()
    const size = fit([word], 'Anton', 1000, 200)
    const reps = Math.ceil((H - 360) / (size * 0.9))
    return (
      <Frame d={d}>
        <div style={{ ...abs, ...col({ paddingTop: 30, overflow: 'hidden' }) }}>
          {Array.from({ length: reps }).map((_, i) => (
            <div key={i} style={{ fontFamily: 'Anton', fontSize: size, lineHeight: 0.9, paddingLeft: 40, opacity: i === 1 ? 1 : 0.22, whiteSpace: 'nowrap' }}>{word}</div>
          ))}
        </div>
        <div style={{ ...col({ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#141414', color: '#FFFFFF', padding: '44px 56px' }) }}>
          <div style={{ fontFamily: 'Anton', fontSize: 74, textTransform: 'uppercase', color: d.palette.bg }}>{`${d.dateShort} · ${d.time}`}</div>
          <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 34, opacity: 0.8, marginTop: 6 }}>{place(d)}</div>
        </div>
      </Frame>
    )
  },
}

export const TEMPLATES: TemplateDef[] = [
  serifCenter, serifDuotone, serifPaper,
  stackBar, tiltPop, outlineBlock,
  giantDate, calendarTile, dateRail,
  billCenter, setTimes, twoToneList,
  framed, splitHalf, neon, ticketStub, magazine, repeatPattern,
]

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id)

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

/** A stable colourway for an event when the organizer hasn't picked one. */
export function defaultPalette(seed: string): 0 | 1 | 2 {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h % 3) as 0 | 1 | 2
}
