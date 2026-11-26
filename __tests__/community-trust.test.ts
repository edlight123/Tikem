/**
 * Publish-right-away safety checks (lib/submission-trust): every hold rule,
 * the link judge (URL only, nothing fetched) and the spam heuristic.
 */
import { holdReasons, linkIssue, extractUrls, spamSignals, dateIssue, type TrustInput } from '@/lib/community/trust'

const NOW = new Date('2026-11-25T18:00:00Z')
const ZONE = 'America/Port-au-Prince'
const DAY = 86400_000
const goodDetails = {
  title: 'Konpa Night',
  date: '2026-12-05',
  start_time: '21:00',
  venue_name: 'Kokoye',
  city: 'Pétion-Ville',
  country: 'HT',
  category: 'Concert',
  free: true,
  ticket_url: 'https://forms.gle/abc123',
}
const base = (over: Partial<TrustInput> = {}, body: Partial<TrustInput['body']> = {}): TrustInput => ({
  signedIn: true,
  authCreatedAtMs: NOW.getTime() - 30 * DAY,
  hasPastRemoval: false,
  recentCount: 0,
  now: NOW,
  zone: ZONE,
  ...over,
  body: { note: 'Bring a dish to share.', organizer_name: 'Kompa Co', source_url: 'https://instagram.com/p/abc', details: goodDetails, ...body },
})

describe('holdReasons', () => {
  it('a trusted, complete, clean share publishes (no reasons)', () => {
    expect(holdReasons(base())).toEqual([])
  })

  it('new account: under 24h by Firebase Auth creation time, or unknown', () => {
    expect(holdReasons(base({ authCreatedAtMs: NOW.getTime() - 3600_000 }))).toContain('new_account')
    expect(holdReasons(base({ authCreatedAtMs: null }))).toContain('new_account')
    expect(holdReasons(base({ authCreatedAtMs: NOW.getTime() - 25 * 3600_000 }))).not.toContain('new_account')
  })

  it('past removals (read directly by lib/community/publish)', () => {
    expect(holdReasons(base({ hasPastRemoval: true }))).toEqual(['past_removals'])
  })

  it('rate limit: a 4th share in the window is held (count from the atomic counter)', () => {
    expect(holdReasons(base({ recentCount: 2 }))).toEqual([])
    expect(holdReasons(base({ recentCount: 3 }))).toEqual(['rate_limit'])
  })

  it('bad links in the note, ticket link or source', () => {
    expect(holdReasons(base({}, { note: 'Register at http://masjid.ca/x' }))).toContain('bad_link')
    expect(holdReasons(base({}, { note: 'Tickets: bit.ly/abc' }))).toContain('bad_link')
    expect(holdReasons(base({}, { details: { ...goodDetails, ticket_url: 'https://192.168.0.1/form' } }))).toContain('bad_link')
    expect(holdReasons(base({}, { source_url: 'https://free-tickets.xyz/e' }))).toContain('bad_link')
    expect(holdReasons(base({}, { details: { ...goodDetails, ticket_url: 'javascript:alert(1)' } }))).toContain('bad_link')
    expect(holdReasons(base({}, { note: 'Sign up: https://docs.google.com/forms/d/e/1/viewform' }))).toEqual([])
  })

  it('bad date: past, or more than a year ahead', () => {
    expect(holdReasons(base({}, { details: { ...goodDetails, date: '2026-11-20' } }))).toContain('bad_date')
    expect(holdReasons(base({}, { details: { ...goodDetails, date: '2028-01-10' } }))).toContain('bad_date')
    expect(dateIssue('2026-11-25', '09:00', ZONE, NOW)).toBe('past') // 09:00 PST = 17:00Z, before 18:00Z
    expect(dateIssue('2026-11-25', '15:00', ZONE, NOW)).toBeNull()
  })

  it('spam text: wording or many links', () => {
    expect(holdReasons(base({}, { note: 'Learn crypto trading, double your money!' }))).toContain('spam_text')
    expect(holdReasons(base({}, { details: { ...goodDetails, title: 'Casino night' } }))).toContain('spam_text')
    expect(holdReasons(base({}, { note: 'https://a.ca/1 https://b.ca/2 https://c.ca/3' }))).toContain('spam_text')
    expect(spamSignals('Payday loans available')).toEqual(expect.arrayContaining(['payday', 'loans']))
    expect(spamSignals('Halaqa after Maghrib, bring your family')).toEqual([])
  })

  it('incomplete: needs title, date, start, organizer, category and a place (or online)', () => {
    expect(holdReasons(base({}, { details: { ...goodDetails, title: '' } }))).toContain('incomplete')
    expect(holdReasons(base({}, { details: { ...goodDetails, start_time: '' } }))).toContain('incomplete')
    // Tikèm: the organizer credit is optional (lib/community/submissions), so no hold for it.
    expect(holdReasons(base({}, { organizer_name: '' }))).not.toContain('incomplete')
    expect(holdReasons(base({}, { details: { ...goodDetails, category: '' } }))).toContain('incomplete')
    expect(holdReasons(base({}, { details: { ...goodDetails, venue_name: '', city: '' } }))).toContain('incomplete')
    expect(holdReasons(base({}, { details: { ...goodDetails, venue_name: 'Online (Zoom)', city: '' } }))).toEqual([])
  })

  it('paid with no ticket link is held', () => {
    expect(holdReasons(base({}, { details: { ...goodDetails, free: false, price: 10, ticket_url: '' } }))).toContain('paid_no_link')
    expect(holdReasons(base({}, { details: { ...goodDetails, free: false, price: 10 } }))).toEqual([])
  })

  it('not signed in (no anonymous submissions today, but held if they ever exist)', () => {
    expect(holdReasons(base({ signedIn: false }))).toContain('not_signed_in')
  })
})

describe('linkIssue', () => {
  it.each([
    ['https://masjid.ca/events', null],
    ['https://forms.gle/xyz', null],
    ['https://docs.google.com/forms/d/e/1/viewform?usp=sf_link', null],
    ['http://masjid.ca', 'not_https'],
    ['https://bit.ly/x', 'shortener'],
    ['https://tinyurl.com/x', 'shortener'],
    ['https://10.0.0.1/x', 'ip_host'],
    ['https://user:pw@masjid.ca', 'credentials'],
    ['https://masjid.ca:8443/x', 'port'],
    ['https://win-prizes.tk/x', 'bad_tld'],
    ['https://xn--80ak6aa92e.com', 'punycode'],
    ['https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.ca', 'redirect'],
    ['https://www.google.com/url?q=https://evil.ca', 'redirect'],
    ['https://masjid.ca/go?to=https://evil.ca/x', 'redirect'],
    ['https://masjid.ca/go?next=https://masjid.ca/y', null],
    ['not a url', 'invalid'],
  ])('%s → %s', (url, issue) => {
    expect(linkIssue(url)).toBe(issue)
  })

  it('finds links in free text, bare ones too', () => {
    expect(extractUrls('see https://a.ca/x, or www.b.ca and bit.ly/y.')).toEqual(['https://a.ca/x', 'https://www.b.ca', 'https://bit.ly/y'])
  })
})
