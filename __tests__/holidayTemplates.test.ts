import {
  HOLIDAY_TEMPLATES,
  holidayDate,
  holidayPosterSpec,
  holidaySamplePath,
  holidayTemplateById,
  holidayTemplatesFor,
  occasionsWithTemplates,
} from '@/lib/holidayTemplates'
import { OCCASION_IDEAS, OCCASION_KEYS, occasionsInSeason, posterOccasion, type OccasionKey } from '@/lib/occasions'
import { TEMPLATES, getTemplate } from '@/lib/posters/templates'
import { CATEGORIES } from '@/lib/filters/config'
import { FLYER_LIBRARY, seasonalFlyerLibrary } from '@/lib/flyerLibrary'
import { cleanInput } from '@/lib/posters/render'
import { eligibleOrganizerIds, seasonNudgeCopy, seasonNudgeLinks, seasonNudgesDue } from '@/lib/notifications/seasonNudge'
import { decideSend } from '@/lib/notifications/policy'
import { readUserNotifyPref } from '@/lib/notifications/userPreferences'

jest.mock('next/og', () => ({ ImageResponse: class {} }))

/** The app composer's categories (mobile CreateEventFlowRefactored CATEGORIES). */
const APP_CATEGORIES = ['Music', 'Sports', 'Arts', 'Business', 'Food & Drink', 'Community', 'Education', 'Tech', 'Health', 'Other']

/** Weighted by how much each occasion is celebrated with events. */
// Inauthentic photos (Nice/Venice carnival, foreign bands and crowds,
// Japanese lanterns) were dropped after the 2026-11-23 design review.
const COUNTS: Record<OccasionKey, number> = {
  kanaval: 10,
  nwel: 18,
  'fen-ane': 16,
  'fet-endepandans': 10,
  'fet-manman': 10,
  'fet-chanpet': 8,
  'fet-papa': 8,
  'fet-drapo': 6,
  'heritage-month': 5,
  rara: 5,
  'fet-gede': 5,
  vertieres: 4,
}

/** Noon in Port-au-Prince on a calendar day. */
const at = (iso: string) => new Date(`${iso}T17:00:00Z`)

describe('holiday template data', () => {
  it('has the planned number per occasion', () => {
    for (const key of OCCASION_KEYS) expect([key, holidayTemplatesFor(key).length]).toEqual([key, COUNTS[key]])
    expect(HOLIDAY_TEMPLATES.length).toBe(Object.values(COUNTS).reduce((a, b) => a + b, 0))
  })

  it('has unique ids', () => {
    const ids = HOLIDAY_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(holidayTemplateById(id)?.id).toBe(id)
    expect(holidayTemplateById('nope')).toBeNull()
  })

  it.each(HOLIDAY_TEMPLATES.map((t) => [t.id, t] as const))('%s is well formed', (_id, t) => {
    expect(OCCASION_KEYS).toContain(t.occasion)
    // A real layout, and one that draws the photo.
    const layout = getTemplate(t.layout)
    expect(layout).toBeDefined()
    expect(layout!.usesPhoto).toBe(true)
    expect([0, 1, 2]).toContain(t.palette)
    expect(['darken', 'mono', 'duotone', 'none']).toContain(t.treatment)
    // An images.unsplash.com photo id with its page and photographer.
    expect(t.photo).toMatch(/^\d{10,13}-[0-9a-f]{12}$/)
    expect(t.credit.source).toMatch(/^https:\/\/unsplash\.com\/photos\/[\w-]+$/)
    expect(t.credit.author.trim()).not.toBe('')
    for (const lang of ['en', 'fr', 'ht'] as const) {
      expect(t.title[lang].trim()).not.toBe('')
      expect(t.subtitle[lang].trim()).not.toBe('')
      // House copy rule: no em-dashes.
      expect(t.title[lang] + t.subtitle[lang]).not.toMatch(/—/)
      expect(t.title[lang].length).toBeLessThanOrEqual(40)
    }
    expect(CATEGORIES).toContain(t.category)
    expect(APP_CATEGORIES).toContain(t.appCategory)
    expect(t.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })

  it('varies the layouts within each occasion', () => {
    for (const key of OCCASION_KEYS) {
      const list = holidayTemplatesFor(key)
      const layouts = new Set(list.map((t) => t.layout))
      // At least four layouts (Vertières, with four templates, uses four).
      expect([key, layouts.size >= Math.min(4, list.length)]).toEqual([key, true])
      // No layout carries more than a third of an occasion.
      for (const l of layouts) {
        expect([key, l, list.filter((t) => t.layout === l).length <= Math.max(2, Math.ceil(list.length / 3))]).toEqual([key, l, true])
      }
    }
  })

  it('reuses a photo at most twice, and never twice in one occasion with the same layout', () => {
    const uses = new Map<string, string[]>()
    for (const t of HOLIDAY_TEMPLATES) uses.set(t.photo, [...(uses.get(t.photo) || []), `${t.occasion}/${t.layout}`])
    for (const [photo, list] of uses) {
      expect([photo, list.length <= 2]).toEqual([photo, true])
      expect([photo, new Set(list).size]).toEqual([photo, list.length])
    }
  })

  it('every layout a holiday template uses is in the picker', () => {
    const ids = new Set(TEMPLATES.map((t) => t.id))
    for (const t of HOLIDAY_TEMPLATES) expect(ids.has(t.layout)).toBe(true)
    expect(occasionsWithTemplates().sort()).toEqual([...OCCASION_KEYS].sort())
  })
})

describe('applying a holiday template', () => {
  it('saves a spec the renderer accepts, treatment and all', () => {
    const t = holidayTemplateById('nwel-piano')!
    const spec = holidayPosterSpec(t)
    expect(spec).toEqual({
      template: t.layout,
      palette: t.palette,
      photo: `https://images.unsplash.com/photo-${t.photo}?w=1200&h=1500&fit=crop&q=80`,
      treatment: t.treatment,
      holiday: 'nwel-piano',
    })
    const input = cleanInput({ ...spec, title: 'Revèyon', start: '2026-12-24T20:00' })
    expect(input?.treatment).toBe(t.treatment)
    expect(input?.photo).toBe(spec.photo)
    // An unknown treatment is dropped, not passed through.
    expect(cleanInput({ ...spec, treatment: 'sepia', title: 'x', start: '2026-12-24T20:00' })?.treatment).toBeUndefined()
  })

  it('suggests the next main day of its occasion', () => {
    const kan = holidayTemplateById('kan-bal')!
    // Easter 2027 is 28 March: dimanch gra is 7 February.
    expect(holidayDate(kan, at('2026-11-23'))).toBe('2027-02-07')
    expect(holidayDate(holidayTemplateById('nwel-reveyon')!, at('2026-11-23'))).toBe('2026-12-24')
    // Past it: next year's.
    expect(holidayDate(holidayTemplateById('nwel-reveyon')!, at('2026-12-26'))).toBe('2027-12-24')
  })

  it('draws a sample with its own title in the page language', () => {
    const path = holidaySamplePath(holidayTemplateById('nwel-reveyon')!, 'fr', at('2026-11-23'))
    const q = new URLSearchParams(path.split('?')[1])
    expect(path.startsWith('/api/posters/preview?')).toBe(true)
    expect(q.get('title')).toBe('Réveillon de Noël')
    expect(q.get('start')).toBe('2026-12-24T20:00')
    expect(q.get('locale')).toBe('fr')
  })
})

describe('occasion ideas carry a poster', () => {
  it('every idea names a template of its own occasion', () => {
    for (const idea of OCCASION_IDEAS) {
      expect([idea.id, typeof idea.poster]).toEqual([idea.id, 'string'])
      const t = holidayTemplateById(idea.poster)
      expect([idea.id, t?.occasion]).toEqual([idea.id, idea.occasion])
    }
  })
})

describe('picker row: which occasion leads', () => {
  const all = occasionsWithTemplates()
  it('the tagged occasion wins over the date', () => {
    expect(posterOccasion('kanaval', '2026-12-24', all)).toBe('kanaval')
  })
  it('else the occasion the date falls in, most specific first', () => {
    expect(posterOccasion(null, '2026-12-24', all)).toBe('nwel')
    expect(posterOccasion('', '2026-12-31', all)).toBe('fen-ane')
    expect(posterOccasion(undefined, '2027-01-01', all)).toBe('fet-endepandans')
    // Flag Day sits inside Heritage Month: the one-day occasion is more specific.
    expect(posterOccasion(null, '2027-05-18', all)).toBe('fet-drapo')
    expect(posterOccasion(null, '2027-05-10', all)).toBe('heritage-month')
  })
  it('none outside every occasion, or for an occasion without templates', () => {
    expect(posterOccasion(null, '2026-09-20', all)).toBeNull()
    expect(posterOccasion('nwel', '2026-09-20', ['kanaval'])).toBeNull()
    expect(posterOccasion('bogus', null, all)).toBeNull()
  })
})

describe('seasonal flyer library', () => {
  it('leads with Nwèl then Fen ane at the start of December', () => {
    expect(occasionsInSeason(at('2026-12-01'), all())).toEqual(['nwel', 'fen-ane'])
    const lib = seasonalFlyerLibrary(at('2026-12-01'))
    const firstNonNwel = lib.findIndex((i) => i.occasion !== 'nwel')
    expect(lib[0].occasion).toBe('nwel')
    expect(lib[firstNonNwel].occasion).toBe('fen-ane')
  })
  it('adds Independence Day once it is 30 days out', () => {
    expect(occasionsInSeason(at('2026-12-02'), all())).toEqual(['nwel', 'fen-ane', 'fet-endepandans'])
  })
  it('keeps an occasion first while it is under way', () => {
    expect(occasionsInSeason(at('2027-08-15'), all())[0]).toBe('fet-chanpet')
    expect(seasonalFlyerLibrary(at('2027-08-15'))[0].occasion).toBe('fet-chanpet')
  })
  it('is the everyday library when nothing is near', () => {
    expect(occasionsInSeason(at('2026-09-20'), all())).toEqual([])
    expect(seasonalFlyerLibrary(at('2026-09-20')).map((i) => i.id)).toEqual(FLYER_LIBRARY.map((i) => i.id))
  })
  it('shows each photo once and keeps every everyday piece', () => {
    const lib = seasonalFlyerLibrary(at('2026-12-15'))
    const photos = lib.map((i) => i.photo)
    expect(new Set(photos).size).toBe(photos.length)
    for (const f of FLYER_LIBRARY) expect(photos).toContain(f.photo)
    for (const i of lib.filter((x) => x.occasion)) expect(i.labels?.ht).toBeTruthy()
  })
  function all() {
    return occasionsWithTemplates()
  }
})

describe('organizer season nudge', () => {
  it('is due three weeks out, with a few days of grace', () => {
    // Nwèl starts 24 December 2026.
    expect(seasonNudgesDue(at('2026-12-02')).map((n) => n.occasion)).not.toContain('nwel') // 22 days
    expect(seasonNudgesDue(at('2026-12-03')).find((n) => n.occasion === 'nwel')).toMatchObject({ capKey: 'season:nwel:2026', daysUntil: 21 })
    expect(seasonNudgesDue(at('2026-12-06')).map((n) => n.occasion)).toContain('nwel') // 18 days
    expect(seasonNudgesDue(at('2026-12-07')).map((n) => n.occasion)).not.toContain('nwel') // 17 days
  })
  it('counts Kanaval to the fat days, not the pre-kanaval Sundays', () => {
    // Dimanch gra 2027 is 7 February: 21 days before is 17 January.
    expect(seasonNudgesDue(at('2027-01-17')).map((n) => n.occasion)).toContain('kanaval')
    expect(seasonNudgesDue(at('2026-12-20')).map((n) => n.occasion)).not.toContain('kanaval')
  })
  it('caps once per occasion per year', () => {
    const a = seasonNudgesDue(at('2026-12-03')).find((n) => n.occasion === 'nwel')!
    const b = seasonNudgesDue(at('2027-12-03')).find((n) => n.occasion === 'nwel')!
    expect(a.capKey).not.toBe(b.capKey)
    expect(b.capKey).toBe('season:nwel:2027')
  })
  it('only organizers with a real event', () => {
    expect(
      eligibleOrganizerIds([
        { organizer_id: 'a' },
        { organizer_id: 'a' },
        { organizer_id: ' b ' },
        { organizer_id: 'seed', seed_batch: 'haiti-showcase' },
        { organizer_id: 'gone', deleted: true },
        { organizer_id: '' },
        {},
      ]).sort()
    ).toEqual(['a', 'b'])
  })
  it('speaks the recipient’s language and links the occasion page', () => {
    expect(seasonNudgeCopy('kanaval', 21, 'en')).toEqual({ title: 'Kanaval is in 3 weeks', body: 'Make your poster in one tap.' })
    expect(seasonNudgeCopy('kanaval', 21, 'fr').title).toBe('Carnaval, c’est dans 3 semaines')
    expect(seasonNudgeCopy('kanaval', 20, 'ht')).toEqual({ title: 'Kanaval nan 3 semèn', body: 'Fè afich ou an yon sèl klik.' })
    expect(seasonNudgeLinks('nwel')).toEqual({ url: '/occasions/nwel', deepLink: 'tikem://occasions/nwel' })
  })
  it('obeys the switch, consent markets and quiet hours', () => {
    const noon = new Date('2026-12-03T17:00:00Z')
    expect(decideSend({ user: { default_country: 'HT' }, category: 'organizer_season', now: noon }).send).toBe(true)
    expect(decideSend({ user: { default_country: 'HT', notify_organizer_season: false }, category: 'organizer_season', now: noon }).reason).toBe('category_disabled')
    // Canada and France: off until the person turns it on.
    expect(readUserNotifyPref({ default_country: 'CA' }, 'notify_organizer_season')).toBe(false)
    expect(decideSend({ user: { default_country: 'FR' }, category: 'organizer_season', now: noon }).reason).toBe('category_disabled')
    expect(decideSend({ user: { default_country: 'CA', notify_organizer_season: true }, category: 'organizer_season', now: noon }).send).toBe(true)
    // 03:00 in Haiti: quiet hours.
    expect(decideSend({ user: { default_country: 'HT' }, category: 'organizer_season', now: new Date('2026-12-03T08:00:00Z') }).reason).toBe('quiet_hours')
    // Already told this year.
    expect(decideSend({ user: { default_country: 'HT' }, category: 'organizer_season', now: noon, sentRecently: true }).reason).toBe('capped')
  })
})
