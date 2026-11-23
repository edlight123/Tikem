/**
 * The flyer reader's rules (lib/flyer/parse), fed text the way Tesseract
 * returns it: one entry per line, with its pixel height and confidence.
 * Flyers are in English, French and Haitian Kreyòl, often mixed.
 */
import { fold, parseFlyerText, type OcrLine } from '@/lib/flyer/parse'

// A Monday, local time: every "next occurrence" below is counted from here.
const REF = new Date(2026, 10, 23, 12, 0, 0)
const L = (text: string, height = 30, confidence = 90): OcrLine => ({ text, height, confidence })

describe('Kreyòl flyers', () => {
  it('reads a konpa party flyer (real Tesseract output from a rendered flyer)', () => {
    // Tesseract on our test render read "Pòt" as "Pot" and kept "9è".
    const r = parseFlyerText(
      [
        L('DJ MAKY PREZANTE\n', 29, 92),
        L('KONPA LAKAY\n', 124, 92),
        L('Samdi 12 Desanm 2026\n', 42, 93),
        L('a 9è diswa\n', 34, 90),
        L('Hotel Montana\n', 38, 95),
        L('Pétion-Ville\n', 26, 91),
        L('Prevant 1,500 HTG - Pot 2,000 HTG\n', 43, 88),
        L('Info: 3712-4455\n', 22, 96),
      ],
      REF
    )
    expect(r.title).toBe('Konpa Lakay')
    expect(r.date).toBe('2026-12-12')
    expect(r.start_time).toBe('21:00')
    expect(r.uncertain).toEqual([])
    expect(r.venue_name).toBe('Hotel Montana')
    expect(r.city).toBe('Pétion-Ville')
    expect(r).toMatchObject({ price_type: 'paid', price: 1500, currency: 'HTG' })
    expect(r.personal_details).toEqual(['3712-4455'])
    expect(r.description).toBeNull()
  })

  it('reads every Kreyòl month', () => {
    const months = ['janvye', 'fevriye', 'mas', 'avril', 'me', 'jen', 'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm']
    months.forEach((m, i) => {
      const r = parseFlyerText([L('Gran Fèt', 80), L(`Vandredi 3 ${m} 2027`)], REF)
      expect(r.date).toBe(`2027-${String(i + 1).padStart(2, '0')}-03`)
    })
  })

  it('a bare "a 9è" is read as the evening and flagged', () => {
    const r = parseFlyerText([L('BAL KONPA', 90), L('Dimanch 3 janvye a 9è')], REF)
    expect(r.date).toBe('2027-01-03')
    expect(r.uncertain).not.toContain('date')
    expect(r.start_time).toBe('21:00')
    expect(r.uncertain).toContain('start_time')
  })

  it('reads "di maten" as the morning', () => {
    const r = parseFlyerText([L('Kous 5K pou Lapè', 90), L('Samdi 6 mas 2027, 7è di maten')], REF)
    expect(r.start_time).toBe('07:00')
    expect(r.uncertain).not.toContain('start_time')
  })

  it('reads a Kreyòl time range ("9è rive 3è")', () => {
    const r = parseFlyerText([L('Bal Mask', 90), L('Madi 16 fevriye'), L('9è diswa rive 3è')], REF)
    expect(r.date).toBe('2027-02-16')
    expect(r.start_time).toBe('21:00')
    expect(r.end_time).toBe('03:00')
  })

  it('reads "Gratis" as a free event and "Kote:" as the venue', () => {
    const r = parseFlyerText(
      [L('KONSÈ POU TIMOUN', 90), L('Jedi 24 desanm'), L('Kote: Parc Historique de la Canne à Sucre'), L('Antre gratis')],
      REF
    )
    expect(r.price_type).toBe('free')
    expect(r.price).toBeNull()
    expect(r.venue_name).toBe('Parc Historique de la Canne à Sucre')
    expect(r.title).toBe('Konsè pou Timoun')
  })

  it('reads goud and gdes, keeps the lowest price', () => {
    const r = parseFlyerText([L('RARA LAKAY', 90), L('VIP 2500 goud'), L('Jeneral 500 gdes')], REF)
    expect(r).toMatchObject({ price_type: 'paid', price: 500, currency: 'HTG' })
  })

  it('reads a Delmas road as the address and keeps the presenter out of the title', () => {
    const r = parseFlyerText(
      [
        L('Kreyòl Vibes pwezante', 24),
        L('LAKOU MIZIK', 100),
        L('Samdi 19 desanm 2026 a 8è'),
        L('Delmas 75, Lakou Lakay'),
        L('Potoprens', 22),
        L('Pri: 1 000 HTG'),
      ],
      REF
    )
    expect(r.title).toBe('Lakou Mizik')
    expect(r.address).toBe('Delmas 75, Lakou Lakay')
    expect(r.city).toBe('Port-au-Prince')
    expect(r.price).toBe(1000)
  })

  it('reads a weekday alone as the coming one, flagged', () => {
    const r = parseFlyerText([L('Fèt Lakay', 90), L('Samdi sa a!')], REF)
    expect(r.date).toBe('2026-11-28')
    expect(r.uncertain).toContain('date')
  })
})

describe('French flyers', () => {
  it('reads "samedi 6 mars 2027 à 21h" and "Entrée libre"', () => {
    const r = parseFlyerText([L('Soirée Rara', 80), L('samedi 6 mars 2027 à 21h'), L('Entrée libre', 24)], REF)
    expect(r.date).toBe('2027-03-06')
    expect(r.start_time).toBe('21:00')
    expect(r.price_type).toBe('free')
  })

  it('reads "21h30", "de 21h à 3h", "1er janvier"', () => {
    const r = parseFlyerText([L('Réveillon', 80), L('Vendredi 1er janvier'), L('de 21h30 à 3h')], REF)
    expect(r.date).toBe('2027-01-01')
    expect(r.start_time).toBe('21:30')
    expect(r.end_time).toBe('03:00')
  })

  it('reads a street, a city and a euro price', () => {
    const r = parseFlyerText(
      [L('KOMPA PARIS', 100), L('Vendredi 12 février 2027 – 23h'), L('Le Bataclan'), L('50 Boulevard Voltaire, Paris'), L('Prévente 25€ · Sur place 30€')],
      REF
    )
    expect(r).toMatchObject({ date: '2027-02-12', start_time: '23:00', city: 'Paris', price: 25, currency: 'EUR', venue_name: 'Le Bataclan' })
    expect(r.uncertain).toContain('venue_name')
    expect(r.address).toBe('50 Boulevard Voltaire, Paris')
  })

  it('reads a numeric date day first', () => {
    const r = parseFlyerText([L('Fête de la musique', 80), L('Le 21/06/2027 à 18h')], REF)
    expect(r.date).toBe('2027-06-21')
    expect(r.start_time).toBe('18:00')
  })

  it('does not take an ordinal ("5e édition") for a time', () => {
    const r = parseFlyerText([L('Festival Jazz', 90), L('5e édition'), L('14 décembre 2026')], REF)
    expect(r.start_time).toBeNull()
    expect(r.date).toBe('2026-12-14')
  })
})

describe('English flyers', () => {
  it('reads a Miami diaspora flyer', () => {
    const r = parseFlyerText(
      [
        L('HAITIAN FLAG DAY', 100),
        L('CELEBRATION', 92),
        L('Saturday, May 15th 10PM - 4AM'),
        L('Club Space'),
        L('34 NE 11th St, Miami'),
        L('Tickets $20 · VIP $50'),
        L('21+ | Dress code: All white'),
        L('Info: (305) 555-0142 · party@example.com'),
      ],
      REF
    )
    expect(r.title).toBe('Haitian Flag Day Celebration')
    expect(r.date).toBe('2027-05-15')
    expect(r.start_time).toBe('22:00')
    expect(r.end_time).toBe('04:00')
    expect(r.venue_name).toBe('Club Space')
    expect(r.city).toBe('Miami')
    expect(r).toMatchObject({ price_type: 'paid', price: 20, currency: 'USD', age_policy: '21+' })
    expect(r.personal_details).toEqual(['(305) 555-0142', 'party@example.com'])
  })

  it('reads "20 US", "US$15" and a numeric date month first on an English flyer', () => {
    const r = parseFlyerText([L('Kompa Night', 80), L('Friday 12/18 at 9pm'), L('Entry US$15 / 20 US at the door')], REF)
    expect(r.date).toBe('2026-12-18')
    expect(r.start_time).toBe('21:00')
    expect(r).toMatchObject({ price: 15, currency: 'USD' })
  })

  it('reads "Free" with a price as paid, and flags the price', () => {
    const r = parseFlyerText([L('Ladies Night', 80), L('Ladies free before 11pm'), L('$10 after')], REF)
    expect(r).toMatchObject({ price_type: 'paid', price: 10 })
    expect(r.uncertain).toContain('price')
  })

  it('reads 18+ and a plain dress code line', () => {
    const r = parseFlyerText([L('Bal Blan', 80), L('Dress code: Tout blan'), L('18 ans et plus')], REF)
    expect(r.age_policy).toBe('18+')
    expect(r.dress_code).toBe('Tout blan')
  })

  it('does not read "10 out of 10" as an August date', () => {
    const r = parseFlyerText([L('Comedy Show', 80), L('Rated 10 out of 10 by fans')], REF)
    expect(r.date).toBeNull()
  })

  it('does not read "join us" as a price', () => {
    const r = parseFlyerText([L('Brunch', 80), L('Join us 14 december')], REF)
    expect(r.price_type).toBe('unknown')
    expect(r.date).toBe('2026-12-14')
  })
})

describe('caution', () => {
  it('stays empty rather than guessing on unreadable text', () => {
    const r = parseFlyerText([L('~~ ||| ..', 80, 20), L('xq', 20, 30)], REF)
    expect(r).toMatchObject({ title: null, date: null, start_time: null, venue_name: null, price_type: 'unknown' })
  })

  it('flags a title read with low confidence', () => {
    const r = parseFlyerText([L('Fèt Chanpèt', 80, 65), L('Dimanch 3 janvye 2027')], REF)
    expect(r.title).toBe('Fèt Chanpèt')
    expect(r.uncertain).toContain('title')
  })

  it('rolls a past date without a year into next year', () => {
    const r = parseFlyerText([L('Kanaval', 80), L('15 fevriye')], REF)
    expect(r.date).toBe('2027-02-15')
  })

  it('keeps a date that is coming this year in this year', () => {
    const r = parseFlyerText([L('Fèt Desanm', 80), L('31 desanm')], REF)
    expect(r.date).toBe('2026-12-31')
  })

  it('folds accents so OCR slips still match', () => {
    expect(fold('Jiyè Oktòb Pétion-Ville')).toBe('jiye oktob petion-ville')
  })

  it('keeps phone numbers out of the description', () => {
    const r = parseFlyerText([L('Bal Granmoun', 90), L('Yon bèl swa ak tout fanmi an, mizik ak manje.'), L('Rele 509-3712-4455 pou plis enfo')], REF)
    expect(r.description).toBe('Yon bèl swa ak tout fanmi an, mizik ak manje.')
    expect(r.personal_details).toEqual(['509-3712-4455'])
  })
})
