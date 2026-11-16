/**
 * The organizer post-event recap email (getEventRecapEmail): all three
 * languages, ticket sales only when allowed, empty states, and escaping of
 * everything a person typed (event title, attendee names, comments).
 */
import { chartBuckets, getEventRecapEmail, type RecapEmailData } from '@/lib/email-templates/eventRecap'
import type { EmailLang } from '@/lib/email-kit/i18n'

const event = {
  id: 'ev1',
  title: 'Kompa Lakay',
  start_datetime: '2026-11-15T01:00:00.000Z',
  timezone: 'America/Port-au-Prince',
  country: 'HT',
  banner_image_url: 'https://cdn.example.com/poster.jpg',
}

const slot = (i: number) => new Date(Date.parse('2026-11-15T01:00:00.000Z') + i * 1_800_000).toISOString()

const recap: RecapEmailData = {
  sold: 41,
  checkedIn: 38,
  revenue: 152000,
  currency: 'HTG',
  arrivals: [3, 7, 14, 9, 4, 1].map((count, i) => ({ at: slot(i), count })),
  newFollowers: 5,
  feedback: {
    total: 16,
    counts: { 1: 1, 2: 3, 3: 12 },
    comments: [{ name: 'Nadège Pierre', rating: 3, text: 'Best night of the year.', at: null }],
  },
}

const url = 'https://www.tikem.co/organizer/events/ev1/recap'

const EXPECT: Record<EmailLang, { subject: string; cta: string; loved: string; turnout: string }> = {
  en: { subject: '38 of 41 came to Kompa Lakay', cta: 'See the full recap', loved: 'Loved it', turnout: '93% turnout' },
  fr: { subject: '38 sur 41 sont venus à Kompa Lakay', cta: 'Voir le bilan complet', loved: 'Génial', turnout: '93 % de présence' },
  ht: { subject: '38 sou 41 te vini nan Kompa Lakay', cta: 'Wè tout rezime a', loved: 'Te renmen l', turnout: '93% prezans' },
}

describe('getEventRecapEmail', () => {
  it.each(['en', 'fr', 'ht'] as EmailLang[])('renders in %s', (lang) => {
    const { subject, html } = getEventRecapEmail({ lang, event, recap, includeRevenue: true, recapUrl: url })
    const e = EXPECT[lang]
    expect(subject).toBe(e.subject)
    expect(html).toContain(`lang="${lang}"`)
    expect(html).toContain(e.cta)
    expect(html).toContain(e.loved)
    expect(html).toContain(e.turnout)
    expect(html).toContain(url)
    expect(html).toContain('https://cdn.example.com/poster.jpg')
    expect(html).toContain('HTG')
    expect(html).toContain('Best night of the year.')
    // First names only under a quote.
    expect(html).toContain('Nadège')
    expect(html).not.toContain('Pierre')
  })

  it('leaves ticket sales out when the recipient may not see finances', () => {
    const { html } = getEventRecapEmail({ lang: 'en', event, recap, includeRevenue: false, recapUrl: url })
    expect(html).not.toContain('Ticket sales')
    expect(html).not.toContain('152,000')
    expect(html).not.toContain('HTG')
    expect(html).toContain('New followers')
  })

  it('handles no check-ins, no ratings, no poster and no revenue', () => {
    const { subject, html } = getEventRecapEmail({
      lang: 'en',
      event: { ...event, banner_image_url: null },
      recap: {
        ...recap,
        checkedIn: 0,
        revenue: 0,
        arrivals: [],
        newFollowers: 0,
        feedback: { total: 0, counts: { 1: 0, 2: 0, 3: 0 }, comments: [] },
      },
      includeRevenue: true,
      recapUrl: url,
    })
    expect(subject).toBe('Your recap for Kompa Lakay')
    expect(html).toContain('No check-ins were recorded at the door.')
    expect(html).not.toContain('how it felt')
    expect(html).not.toContain('arrivals')
    expect(html).not.toContain('Ticket sales')
    expect(html).not.toContain('<img src="https://cdn')
  })

  it('escapes the event title, names and comments', () => {
    const { subject, html } = getEventRecapEmail({
      lang: 'en',
      event: { ...event, title: '<b>Fèt</b> & "Kompa"' },
      recap: {
        ...recap,
        feedback: {
          ...recap.feedback,
          comments: [
            { name: '<img src=x onerror=alert(1)>', rating: 3, text: '<script>alert("x")</script> great', at: null },
          ],
        },
      },
      includeRevenue: true,
      recapUrl: url,
    })
    expect(subject).toContain('<b>Fèt</b>') // subjects are plain text
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>Fèt</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;Fèt&lt;/b&gt; &amp; &quot;Kompa&quot;')
  })

  it('shows at most three comments', () => {
    const comments = Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, rating: 2, text: `comment-${i}`, at: null }))
    const { html } = getEventRecapEmail({
      lang: 'en',
      event,
      recap: { ...recap, feedback: { ...recap.feedback, comments } },
      includeRevenue: false,
      recapUrl: url,
    })
    expect(html).toContain('comment-2')
    expect(html).not.toContain('comment-3')
  })
})

describe('chartBuckets', () => {
  it('merges neighbouring slots until there are at most 12 bars, keeping the total', () => {
    const arrivals = Array.from({ length: 30 }, (_, i) => ({ at: slot(i), count: 1 }))
    const out = chartBuckets(arrivals)
    expect(out.length).toBeLessThanOrEqual(12)
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(30)
    expect(out[0].at).toBe(slot(0))
  })
})
