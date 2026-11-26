/**
 * Which edits ticket holders hear about, the 10-minute debounce
 * (lib/events/change-detect.ts), who hears (lib/events/ticket-holders.ts) and
 * what the email says (lib/email-templates/eventChange.ts).
 */
import {
  changeContentAllowed,
  CHANGE_DEBOUNCE_MS,
  CHANGE_MAX_WAIT_MS,
  changeNoticeStamp,
  eventIsNotifiable,
  materialChanges,
  materialSnapshot,
  noticeDue,
  observe,
} from '@/lib/events/change-detect'
import { holdersFromRows, noticeLangFor } from '@/lib/events/ticket-holders'
import { eventChangeRows, getEventChangeEmail } from '@/lib/email-templates/eventChange'

const base = {
  title: 'Kompa Night',
  description: 'Old description',
  banner_image_url: 'https://x/old.png',
  start_datetime: '2099-05-01T23:00:00.000Z',
  end_datetime: '2099-05-02T03:00:00.000Z',
  venue_name: 'Ritz',
  address: '1 Main St',
  city: 'Montréal',
  is_online: false,
}

describe('material changes', () => {
  it('ignores cosmetic edits (description, poster, title)', () => {
    const after = { ...base, description: 'New', banner_image_url: 'https://x/new.png', title: 'Kompa Night!' }
    expect(materialChanges(materialSnapshot(base), materialSnapshot(after))).toEqual([])
  })

  it('sees a time, venue, commune, online switch or link change', () => {
    const s = materialSnapshot(base)
    expect(materialChanges(s, materialSnapshot({ ...base, start_datetime: '2099-05-02T00:00:00.000Z' }))).toEqual(['when'])
    expect(materialChanges(s, materialSnapshot({ ...base, venue_name: 'Olympia' }))).toEqual(['where'])
    expect(materialChanges(s, materialSnapshot({ ...base, commune: 'Pétion-Ville' }))).toEqual(['where'])
    expect(materialChanges(s, materialSnapshot({ ...base, is_online: true }))).toEqual(['where'])
    expect(materialChanges(s, materialSnapshot({ ...base, meeting_url: 'https://meet.example/a' }))).toEqual(['link'])
  })

  it('treats a Timestamp and the same ISO string as equal, and venue case as cosmetic', () => {
    const ts = { toDate: () => new Date(base.start_datetime) }
    expect(materialChanges(materialSnapshot(base), materialSnapshot({ ...base, start_datetime: ts, venue_name: 'RITZ' }))).toEqual([])
  })

  it('only live, upcoming events are notifiable', () => {
    const now = Date.parse('2099-04-01T00:00:00Z')
    expect(eventIsNotifiable({ ...base, is_published: true }, now)).toBe(true)
    expect(eventIsNotifiable({ ...base, is_published: false }, now)).toBe(false)
    expect(eventIsNotifiable({ ...base, is_published: true, status: 'cancelled' }, now)).toBe(false)
    expect(eventIsNotifiable({ ...base, is_published: true }, Date.parse('2099-06-01T00:00:00Z'))).toBe(false)
    // Rejected or hidden-for-review events are not live: no notice goes out.
    expect(eventIsNotifiable({ ...base, is_published: true, rejected: true }, now)).toBe(false)
    expect(eventIsNotifiable({ ...base, is_published: true, hidden_pending_review: true }, now)).toBe(false)
    expect(eventIsNotifiable({ ...base, is_published: true, rejected: false, hidden_pending_review: false }, now)).toBe(true)
  })
})

describe('debounce', () => {
  const t0 = 1_000_000_000_000
  const a = materialSnapshot(base)
  const b = materialSnapshot({ ...base, start_datetime: '2099-05-02T00:00:00.000Z' })
  const c = materialSnapshot({ ...base, start_datetime: '2099-05-02T01:00:00.000Z' })

  it('first observation stores a baseline and sends nothing', () => {
    const s = observe(null, a, t0)!
    expect(s.pending).toBe(false)
    expect(noticeDue(s, t0 + CHANGE_DEBOUNCE_MS * 5)).toBe(false)
  })

  it('waits for 10 quiet minutes after the last edit, then is due once', () => {
    let s = observe(null, a, t0)!
    s = observe(s, b, t0 + 1000)!
    expect(s.pending).toBe(true)
    expect(noticeDue(s, t0 + 1000 + CHANGE_DEBOUNCE_MS - 1)).toBe(false)
    s = observe(s, c, t0 + 5 * 60_000)!
    expect(noticeDue(s, t0 + 1000 + CHANGE_DEBOUNCE_MS)).toBe(false)
    expect(noticeDue(s, t0 + 5 * 60_000 + CHANGE_DEBOUNCE_MS)).toBe(true)
    expect(observe(s, c, t0 + 6 * 60_000)).toBeNull()
  })

  it('sends nothing when the edit is reverted before the notice', () => {
    let s = observe(null, a, t0)!
    s = observe(s, b, t0 + 1000)!
    s = observe(s, a, t0 + 2000)!
    expect(s.pending).toBe(false)
    expect(noticeDue(s, t0 + CHANGE_MAX_WAIT_MS * 2)).toBe(false)
  })

  it('never holds a notice past the max wait, and never sends twice within 10 minutes', () => {
    let s = observe(null, a, t0)!
    s = observe(s, b, t0)!
    s = observe(s, c, t0 + CHANGE_MAX_WAIT_MS - 1000)!
    expect(noticeDue(s, t0 + CHANGE_MAX_WAIT_MS)).toBe(true)
    const justSent = { ...s, last_notice_at: t0 + CHANGE_MAX_WAIT_MS - 60_000 }
    expect(noticeDue(justSent, t0 + CHANGE_MAX_WAIT_MS)).toBe(false)
  })

  it('the stamp on the event keeps what it was, never the link', () => {
    const stamp = changeNoticeStamp(a, materialSnapshot({ ...base, venue_name: 'Olympia', meeting_url: 'https://secret' }), t0)!
    expect(stamp.kinds).toEqual(['where', 'link'])
    expect(stamp.before).toEqual({ start: a.start, end: a.end, venue: 'Ritz', city: 'Montréal', online: false })
    expect(JSON.stringify(stamp)).not.toContain('secret')
    expect(changeNoticeStamp(a, a, t0)).toBeNull()
  })
})

const row = (over: Record<string, any>) =>
  ({
    id: 't',
    status: 'valid',
    buyerKey: 'u1',
    buyer: { name: 'A', email: 'a@x.example', city: '' },
    isGuest: false,
    printedSerial: '',
    ...over,
  }) as any

describe('ticket holders', () => {
  it('every live status and rail counts, once per person', () => {
    const people = holdersFromRows([
      row({ id: '1', status: 'valid' }),
      row({ id: '2', status: 'confirmed' }), // MonCash / SogePay
      row({ id: '3', status: 'active', buyerKey: 'u2', buyer: { email: 'b@x.example' } }),
      row({ id: '4', status: 'refunded', buyerKey: 'u3' }),
      row({ id: '5', status: 'confirmed', isGuest: true, buyerKey: 'guest_9', buyer: { email: 'G@x.example' } }),
      row({ id: '6', status: 'printed_unsold', printedSerial: 'P1', buyerKey: 'u4' }),
    ])
    expect(people.map((p) => p.key)).toEqual(['e:g@x.example', 'u:u1', 'u:u2'])
  })

  it('drops the sender and a guest copy of an account address', () => {
    const people = holdersFromRows(
      [row({ buyerKey: 'org1' }), row({ buyerKey: 'u2' }), row({ isGuest: true, buyerKey: 'guest_1', buyer: { email: 'a@x.example' } })],
      { excludeUid: 'org1' }
    )
    expect(people.map((p) => p.key)).toEqual(['u:u2'])
  })

  it('Haiti notices are French unless the person chose Kreyòl', () => {
    expect(noticeLangFor('en', { country: 'HT' })).toBe('fr')
    expect(noticeLangFor('ht', { country: 'HT' })).toBe('ht')
    expect(noticeLangFor('en', { country: 'US' })).toBe('en')
  })
})

describe('change email', () => {
  const ht = { ...base, id: 'ev1', country: 'HT', city: 'Port-au-Prince', timezone: 'America/Port-au-Prince' }
  it('Haiti times are 12-hour with AM/PM in French', () => {
    const before = materialSnapshot(ht)
    const after = materialSnapshot({ ...ht, start_datetime: '2099-05-02T00:30:00.000Z' })
    const rows = eventChangeRows(before, after, 'fr', ht)
    expect(rows).toHaveLength(1)
    expect(rows[0].after).toMatch(/PM/)
    expect(rows[0].after).not.toMatch(/\b20h|\b20:/)
  })

  it('escapes what the organizer typed', () => {
    const before = materialSnapshot(ht)
    const after = materialSnapshot({ ...ht, venue_name: '<script>x</script>' })
    const mail = getEventChangeEmail({ lang: 'fr', event: ht, before, after, ticketUrl: 'https://t', hasAccount: true })
    expect(mail.html).not.toContain('<script>x')
    expect(mail.subject).toContain('Kompa Night')
  })
})

describe('change notice content (organizer-typed venue and link)', () => {
  const base = { start: null, end: null, venue: 'Olympia', address: '28 Bd des Capucines', commune: '', city: 'Paris', online: false, link: '' }

  it('lets a normal venue and an https meeting link through', () => {
    expect(changeContentAllowed(base)).toBe(true)
    expect(changeContentAllowed({ ...base, online: true, link: 'https://zoom.us/j/123456789' })).toBe(true)
  })

  it('refuses phishing in the venue and unsafe links', () => {
    expect(changeContentAllowed({ ...base, venue: 'Verify your account and enter your password here' })).toBe(false)
    expect(changeContentAllowed({ ...base, link: 'http://evil.example/login' })).toBe(false)
    expect(changeContentAllowed({ ...base, link: 'https://bit.ly/abc' })).toBe(false)
  })

  it('checks the event title that goes out with it', () => {
    expect(changeContentAllowed(base, 'Kompa Night')).toBe(true)
    expect(changeContentAllowed(base, 'Verify your account: enter your password')).toBe(false)
    expect(changeContentAllowed(base, 'A very long but honest title '.repeat(10))).toBe(true)
  })
})
