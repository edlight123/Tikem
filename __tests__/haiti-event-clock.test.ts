/**
 * @jest-environment node
 *
 * Owner, 2026-11-25: "the time should not be military — in Haiti we use am,
 * pm — also ticket for Haiti should be in French".
 *
 *  - every time shown for a Haiti event is "8:00 PM" in en, fr AND ht
 *    (lib/datetime/eventClock on the web, mobile/lib/eventClock in the app);
 *  - other markets keep their convention (US 12h, FR/CA-fr "20:00" / "20h");
 *  - the ticket itself (printed PDF, Wallet passes, ticket email) of a Haiti
 *    event is French.
 */
import crypto from 'node:crypto'
import {
  clock12,
  formatEventClock,
  formatEventDateTime,
  hhmmTo12,
  isHaitiEvent,
  ticketDateLine,
} from '@/lib/datetime/eventClock'
import { eventTime, eventWhen } from '@/lib/home/format'
import { formatEventWhen } from '@/lib/email-kit/i18n'
import { PDF_LABELS } from '@/lib/physical/pdf'
import { applePassDateField, applePassLabels } from '@/lib/wallet/apple'
import { buildGoogleSaveUrl } from '@/lib/wallet/google'
import { lineupTimeRange } from '@/lib/lineup'
import { lineupTimeRange as appLineupTimeRange } from '../mobile/lib/lineup'
import * as webAlt from '@/lib/posterAlt'
import * as appAlt from '../mobile/lib/posterAlt'
import * as app from '../mobile/lib/eventClock'

// Saturday 20 June 2026, 8:00 PM in Port-au-Prince (EDT, UTC-4) = 00:00Z on the 21st.
const HT_8PM = '2026-06-21T00:00:00.000Z'
// Saturday 20 June 2026, 8:30 PM in Paris (CEST, UTC+2) = 18:30Z.
const FR_830PM = '2026-06-20T18:30:00.000Z'
// Saturday 20 June 2026, 8:00 PM in New York (EDT) = 00:00Z on the 21st.
const US_8PM = '2026-06-21T00:00:00.000Z'
// Saturday 20 June 2026, 8:00 PM in Toronto (EDT) = 00:00Z on the 21st.
const CA_8PM = '2026-06-21T00:00:00.000Z'

const HT_EVENT = { country: 'HT', city: 'Pétion-Ville' }
const FR_EVENT = { country: 'FR', city: 'Paris' }
const US_EVENT = { country: 'US', city: 'Miami' }
const CA_EVENT = { country: 'CA', city: 'Montréal' }

/** Chrome's ICU puts U+202F before "PM"; compare on plain spaces. */
const plain = (s: string) => s.replace(/[  ]/g, ' ')

describe('Haiti detection', () => {
  it('reads the country first, then the zone', () => {
    expect(isHaitiEvent(HT_EVENT)).toBe(true)
    expect(isHaitiEvent({ country: 'Haiti' })).toBe(true)
    expect(isHaitiEvent({ timezone: 'America/Port-au-Prince' })).toBe(true)
    expect(isHaitiEvent(US_EVENT)).toBe(false)
    expect(isHaitiEvent({ country: 'US', timezone: 'America/Port-au-Prince' })).toBe(false)
    expect(isHaitiEvent(null)).toBe(false)
    expect(app.isHaitiEvent(HT_EVENT)).toBe(true)
    expect(app.isHaitiEvent({ timezone: 'America/Port-au-Prince' })).toBe(true)
    expect(app.isHaitiEvent(FR_EVENT)).toBe(false)
  })
})

describe('the shared web helper', () => {
  it.each(['en', 'fr', 'ht'])('prints a Haiti event as "8:00 PM" in %s', (lang) => {
    expect(formatEventClock(HT_8PM, { zone: 'America/Port-au-Prince', lang })).toBe('8:00 PM')
    expect(formatEventClock(HT_8PM, { lang, haiti: isHaitiEvent(HT_EVENT), zone: 'America/Port-au-Prince' })).toBe('8:00 PM')
  })

  it('always shows the minutes, never a leading zero', () => {
    expect(clock12('2026-06-20T13:05:00.000Z', 'America/Port-au-Prince')).toBe('9:05 AM')
    expect(clock12('2026-06-20T04:00:00.000Z', 'America/Port-au-Prince')).toBe('12:00 AM')
    expect(clock12('2026-06-20T16:30:00.000Z', 'America/Port-au-Prince')).toBe('12:30 PM')
    expect(hhmmTo12('20:00')).toBe('8:00 PM')
    expect(hhmmTo12('20h30')).toBe('8:30 PM')
    expect(hhmmTo12('doors at 8')).toBe('doors at 8')
  })

  it('leaves the other markets on their own convention', () => {
    expect(plain(formatEventClock(US_8PM, { zone: 'America/New_York', lang: 'en' }))).toBe('8:00 PM')
    expect(formatEventClock(FR_830PM, { zone: 'Europe/Paris', lang: 'fr' })).toBe('20:30')
    expect(formatEventClock(CA_8PM, { zone: 'America/Toronto', lang: 'fr' })).toBe('20:00')
    expect(plain(formatEventClock(CA_8PM, { zone: 'America/Toronto', lang: 'en' }))).toBe('8:00 PM')
  })

  it('formats full date-times on the event clock, 12-hour for Haiti only', () => {
    const o: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }
    expect(plain(formatEventDateTime(HT_8PM, HT_EVENT, 'fr', o))).toMatch(/^samedi 20 juin .*8:00 PM$/)
    expect(plain(formatEventDateTime(FR_830PM, FR_EVENT, 'fr', o))).toMatch(/20:30$/)
    expect(plain(formatEventDateTime(US_8PM, US_EVENT, 'en', o))).toMatch(/8:00 PM$/)
  })

  it('home hero / cards: eventTime and eventWhen', () => {
    for (const lang of ['en', 'fr', 'ht']) {
      expect(eventTime(HT_8PM, 'America/Port-au-Prince', lang)).toBe('8:00 PM')
      expect(eventWhen(HT_8PM, 'America/Port-au-Prince', lang)).toMatch(/ · 8:00 PM$/)
    }
    expect(eventTime(FR_830PM, 'Europe/Paris', 'fr')).toBe('20:30')
  })
})

describe('the shared app helper (mobile/lib/eventClock)', () => {
  it('Haiti: "8:00 PM" whatever the locale; the ticket language is French', () => {
    for (const locale of ['en-US', 'fr-FR', 'fr-HT']) {
      expect(app.formatEventClock(HT_8PM, { country: 'HT', timezone: 'America/Port-au-Prince' }, locale)).toBe('8:00 PM')
    }
    expect(app.ticketLanguage(HT_EVENT, 'en')).toBe('fr')
    expect(app.ticketLanguage(HT_EVENT, 'ht')).toBe('fr')
    expect(app.ticketLanguage(US_EVENT, 'en')).toBe('en')
    expect(app.ticketLanguage(FR_EVENT, 'ht')).toBe('ht')
    expect(app.formatEventDateTime(HT_8PM, { country: 'HT', timezone: 'America/Port-au-Prince' }, 'fr-FR')).toMatch(/ 8:00 PM$/)
  })

  it('other markets: exactly what toLocaleTimeString / toLocaleString printed before', () => {
    const d = new Date(FR_830PM)
    expect(app.formatEventClock(d, FR_EVENT, 'fr-FR')).toBe(d.toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }))
    expect(app.formatEventDateTime(d, FR_EVENT, 'fr-FR')).toBe(d.toLocaleString('fr-FR'))
  })
})

describe('email (lib/email-kit formatEventWhen)', () => {
  it.each(['en', 'fr', 'ht'] as const)('a Haiti event reads "8:00 PM" in %s', (lang) => {
    const when = formatEventWhen(HT_8PM, lang, HT_EVENT)!
    expect(when.time).toBe('8:00 PM')
    expect(when.line).toMatch(/ · 8:00 PM$/)
  })

  it('French elsewhere keeps "20h30"; English keeps 12-hour', () => {
    expect(formatEventWhen(FR_830PM, 'fr', FR_EVENT)!.time).toBe('20h30')
    expect(formatEventWhen(US_8PM, 'en', US_EVENT)!.time).toBe('8:00 PM')
  })
})

describe('the printed ticket', () => {
  it('a Haiti date line is French with the 12-hour clock', () => {
    expect(ticketDateLine(HT_8PM, HT_EVENT, 'en')).toBe('samedi 20 juin 2026 · 8:00 PM')
    expect(ticketDateLine(HT_8PM, HT_EVENT, 'ht')).toBe('samedi 20 juin 2026 · 8:00 PM')
  })

  it('other events keep their language and clock', () => {
    expect(ticketDateLine(FR_830PM, FR_EVENT, 'fr')).toBe('samedi 20 juin 2026 · 20:30')
    expect(plain(ticketDateLine(US_8PM, US_EVENT, 'en'))).toBe('Saturday, June 20, 2026 · 8:00 PM')
  })

  it('every fixed word has a French version', () => {
    expect(PDF_LABELS.fr.eyebrow).toBe('TIKÈM  ·  ENTRÉE')
    expect(PDF_LABELS.fr.validOnceSold).toBe('Valide une fois vendu')
    expect(PDF_LABELS.fr.stub).toBe('TALON')
    expect(PDF_LABELS.fr.page(1, 3)).toBe('page 1 sur 3')
    expect(PDF_LABELS.en.eyebrow).toBe('TIKÈM  ·  ADMIT ONE')
  })

  it('renders a French sheet (the drawn strings)', async () => {
    const drawn: string[] = []
    jest.doMock('jspdf', () => {
      const real = jest.requireActual('jspdf')
      class Recording extends real.jsPDF {
        constructor(...args: any[]) {
          super(...args)
          const draw = (this as any).text.bind(this)
          ;(this as any).text = (t: any, ...rest: any[]) => {
            drawn.push(...(Array.isArray(t) ? t : [t]).map(String))
            return draw(t, ...rest)
          }
        }
      }
      return { ...real, jsPDF: Recording }
    })
    let render: any
    jest.isolateModules(() => {
      render = require('@/lib/physical/pdf').renderBatchPdf
    })
    await render({
      event: { title: 'Konpa Live', dateLine: ticketDateLine(HT_8PM, HT_EVENT, 'fr'), venueLine: 'Royal Oasis, Pétion-Ville' },
      tickets: [{ serial: 'A-0001', qrPayload: 'x', tierName: 'VIP' }],
      lang: 'fr',
    })
    jest.dontMock('jspdf')
    expect(drawn).toEqual(
      expect.arrayContaining(['TIKÈM  ·  ENTRÉE', 'Valide une fois vendu', 'TALON', 'samedi 20 juin 2026 · 8:00 PM'])
    )
    expect(drawn.join(' ')).not.toMatch(/ADMIT ONE|STUB|Valid only|20 h|20:00/)
  }, 60_000)
})

const walletTicket = (over: Record<string, any> = {}) => ({
  id: 't1',
  qrPayload: 'QR',
  qrVersion: 0,
  eventId: 'e1',
  eventTitle: 'Konpa Live',
  tierName: 'VIP',
  holderName: 'Marie',
  venueName: 'Royal Oasis',
  city: 'Pétion-Ville',
  country: 'HT',
  startDatetime: HT_8PM,
  endDatetime: null,
  orderRef: 'TKM-ABC12345',
  bannerImageUrl: null,
  ...over,
})

describe('Wallet passes', () => {
  it('Apple: a Haiti pass is French and carries "… · 8:00 PM" as text', () => {
    const field = applePassDateField(walletTicket() as any, '2026-06-21T00:00:00Z')
    expect(field).toEqual({ key: 'date', label: 'DATE', value: 'samedi 20 juin 2026 · 8:00 PM' })
    expect(applePassLabels(true)).toMatchObject({ ticket: 'BILLET', admit: 'TITULAIRE', venue: 'LIEU', order: 'COMMANDE' })
  })

  it('Apple: elsewhere Wallet formats the raw instant itself (unchanged)', () => {
    const field = applePassDateField(walletTicket({ country: 'US', city: 'Miami' }) as any, '2026-06-21T00:00:00Z')
    expect(field).toMatchObject({ value: '2026-06-21T00:00:00Z', timeStyle: 'PKDateStyleShort' })
    expect(applePassLabels(false).ticket).toBe('TICKET')
  })

  it('Google: a Haiti pass is French with the date as text', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const cfg = {
      issuerId: 'ISS',
      issuerName: 'Tikèm',
      clientEmail: 'svc@x.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }
    const claims = (url: string) => JSON.parse(Buffer.from(url.split('/save/')[1].split('.')[1], 'base64url').toString())

    const ht = claims(buildGoogleSaveUrl(walletTicket() as any, cfg as any)).payload
    expect(ht.eventTicketClasses[0].eventName.defaultValue.language).toBe('fr-FR')
    expect(ht.eventTicketObjects[0].textModulesData).toEqual(
      expect.arrayContaining([{ id: 'date', header: 'Date', body: 'samedi 20 juin 2026 · 8:00 PM' }])
    )

    const us = claims(buildGoogleSaveUrl(walletTicket({ country: 'US', city: 'Miami' }) as any, cfg as any)).payload
    expect(us.eventTicketClasses[0].eventName.defaultValue.language).toBe('en-US')
    expect(us.eventTicketObjects[0].textModulesData).toBeUndefined()
  })
})

describe('lineup set times and poster descriptions', () => {
  it('a Haiti lineup reads 12-hour; others as typed', () => {
    expect(lineupTimeRange('20:00', '21:30', true)).toBe('8:00 PM – 9:30 PM')
    expect(appLineupTimeRange('20:00', '21:30', true)).toBe('8:00 PM – 9:30 PM')
    expect(lineupTimeRange('20:00', '21:30')).toBe('20:00 – 21:30')
  })

  it.each([
    ['web', webAlt],
    ['app', appAlt],
  ])('poster alt (%s): Haiti in French says "à 8:00 PM"', (_side, m) => {
    const ev = { title: 'Konpa Live', start_datetime: HT_8PM, timezone: 'America/Port-au-Prince', country: 'HT' }
    expect(m.posterAltFromFacts(ev, 'fr')).toContain('samedi 20 juin à 8:00 PM')
    expect(m.posterAltFromFacts(ev, 'ht')).toContain('a 8:00 PM')
    expect(m.posterAltFromFacts({ ...ev, country: 'FR', timezone: 'Europe/Paris', start_datetime: FR_830PM }, 'fr')).toContain(
      'à 20 h 30'
    )
  })
})

describe('generated flyers (lib/posters/render)', () => {
  it('a Haiti flyer in French prints "8:00 PM"; elsewhere French keeps "20h"', () => {
    const { cleanInput, dateParts } = require('@/lib/posters/render')
    const { TEMPLATES } = require('@/lib/posters/templates')
    expect(dateParts('2026-06-20T20:00', 'fr', true).time).toBe('8:00 PM')
    expect(dateParts('2026-06-20T20:30', 'fr', true).time).toBe('8:30 PM')
    expect(dateParts('2026-06-20T20:00', 'fr', false).time).toBe('20h')
    const base = { template: TEMPLATES[0].id, title: 'Konpa', start: '2026-06-20T20:00' }
    expect(cleanInput({ ...base, country: 'HT' })?.haiti).toBe(true)
    expect(cleanInput({ ...base, country: 'FR' })?.haiti).toBe(false)
  })
})
