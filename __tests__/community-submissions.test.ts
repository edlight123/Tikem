/**
 * Community-shared events, the pure half (lib/community/submissions,
 * lib/community/claim-proofs): what a share keeps, what the admin publishes,
 * what a claim needs, and what a transfer writes.
 */
import {
  COMMUNITY_ORG_ID,
  claimTransferPatch,
  communityTicketsUrl,
  handleMatches,
  parseClaimInput,
  parseHandle,
  parseSourceUrl,
  parseSubmissionFields,
  parseSubmissionInput,
  parseSubmitterDetails,
  submissionToEvent,
  zonedIso,
} from '@/lib/community/submissions'
import { checkEventPurchasable } from '@/lib/tickets/purchasable'
import { isClaimProofPath, isClaimProofPathFor } from '@/lib/community/claim-proofs'

const fields = {
  title: 'Kompa sou plaj',
  description: 'Bal kompa.',
  date: '2027-01-16',
  start_time: '21:00',
  end_time: '03:00',
  venue_name: 'Wahoo Bay',
  address: 'Route Nationale 1',
  city: 'Port-au-Prince',
  country: 'HT',
  category: 'Party',
  organizer_name: 'Kompa Nights',
  organizer_handle: '@kompa.nights',
  source_url: 'https://instagram.com/p/abc',
  ticket_url: 'https://tickets.example.com/kompa',
  free: false,
  price: '1500',
  currency: 'HTG',
}

describe('source links', () => {
  it('keeps only http(s) links with a real host', () => {
    expect(parseSourceUrl('https://instagram.com/p/abc')).toBe('https://instagram.com/p/abc')
    expect(parseSourceUrl('http://kompa.ht/events')).toBe('http://kompa.ht/events')
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com/a', 'https://localhost', 'https://u:p@x.com', 'not a link', '']) {
      expect(parseSourceUrl(bad)).toBeNull()
    }
  })
  it('reads handles from @names and profile links', () => {
    expect(parseHandle('@Kompa.Nights')).toBe('kompa.nights')
    expect(parseHandle('https://www.instagram.com/kompa.nights/')).toBe('kompa.nights')
    expect(parseHandle('<script>')).toBe('')
    expect(handleMatches('@KOMPA.nights', 'kompa.nights')).toBe(true)
    expect(handleMatches('other', 'kompa.nights')).toBe(false)
    expect(handleMatches('', '')).toBe(false)
  })
})

describe('what a member shares', () => {
  it('drops invalid optional details instead of refusing the share', () => {
    const d = parseSubmitterDetails({ date: 'tomorrow', start_time: '9pm', country: 'XX', currency: 'BTC', price: '-4', free: false, ticket_url: 'javascript:x', category: 'Rave' })
    expect(d).toMatchObject({ date: '', start_time: '', country: '', currency: '', price: null, ticket_url: '', category: '' })
  })
  it('keeps a valid share as typed', () => {
    const v = parseSubmissionInput({ source_url: 'https://instagram.com/p/1', organizer_name: '  Kompa   Nights ', organizer_handle: '@kompa', details: { ...fields, price: '1,500.5' } })
    expect(v).toMatchObject({ source_url: 'https://instagram.com/p/1', organizer_name: 'Kompa Nights', organizer_handle: 'kompa' })
    expect(v.details).toMatchObject({ date: '2027-01-16', country: 'HT', currency: 'HTG', free: false, category: 'Party' })
  })
})

describe('what the admin publishes', () => {
  it('turns Port-au-Prince wall-clock time into the right instant', () => {
    // Haiti observes DST: EST (UTC-5) in January, EDT (UTC-4) in July.
    expect(zonedIso('2027-01-16', '21:00', 'America/Port-au-Prince')).toBe('2027-01-17T02:00:00.000Z')
    expect(zonedIso('2027-07-01', '21:00', 'America/Port-au-Prince')).toBe('2027-07-02T01:00:00.000Z')
    expect(zonedIso('2027-01-16', '9pm', 'America/Port-au-Prince')).toBeNull()
  })
  it('validates the edited fields', () => {
    expect(parseSubmissionFields(fields)).toMatchObject({ ok: true })
    expect(parseSubmissionFields({ ...fields, title: '' })).toMatchObject({ ok: false, field: 'title' })
    expect(parseSubmissionFields({ ...fields, start_time: '' })).toMatchObject({ ok: false, field: 'date' })
    expect(parseSubmissionFields({ ...fields, city: '', venue_name: '' })).toMatchObject({ ok: false, field: 'city' })
    const v = (parseSubmissionFields({ ...fields, source_url: 'javascript:x' }) as any).value
    expect(v.source_url).toBe('')
  })
  it('publishes it owned by the community account, credited, claimable and selling nothing', () => {
    const v = (parseSubmissionFields(fields) as any).value
    const e = submissionToEvent(v, { submissionId: 's1', bannerUrl: 'https://x/f.jpg', now: 'NOW' })!
    expect(e).toMatchObject({
      organizer_id: COMMUNITY_ORG_ID,
      organizer_name: 'Tikèm Community',
      source_name: 'Kompa Nights',
      source_handle: 'kompa.nights',
      source_url: 'https://instagram.com/p/abc',
      external_url: 'https://tickets.example.com/kompa',
      community_shared: true,
      claimable: true,
      is_published: true,
      status: 'published',
      rejected: false,
      reports_count: 0,
      has_paid_tiers: false,
      total_tickets: 0,
      ticket_price: 1500,
      currency: 'HTG',
      start_datetime: '2027-01-17T02:00:00.000Z',
      // 03:00 is after midnight.
      end_datetime: '2027-01-17T08:00:00.000Z',
    })
    expect(checkEventPurchasable(e, new Date('2027-01-10T00:00:00Z'))).toMatchObject({ ok: false, code: 'community_event' })
    expect(communityTicketsUrl(e)).toBe('https://tickets.example.com/kompa')
    expect(communityTicketsUrl({ ...e, external_url: 'javascript:x' })).toBeNull()
    expect(communityTicketsUrl({ ...e, community_shared: false })).toBeNull()
  })
  it('never makes a ticket link-out from a plain http link', () => {
    const v = (parseSubmissionFields({ ...fields, ticket_url: 'http://tickets.example.com' }) as any).value
    expect(submissionToEvent(v, { submissionId: 's', bannerUrl: null })!.external_url).toBeUndefined()
  })
  it('gives an event with no end two hours', () => {
    const v = (parseSubmissionFields({ ...fields, end_time: '' }) as any).value
    expect(submissionToEvent(v, { submissionId: 's', bannerUrl: null })!.end_datetime).toBe('2027-01-17T04:00:00.000Z')
  })
})

describe('claims', () => {
  it('needs a proof that matches its method', () => {
    expect(parseClaimInput({ method: 'nope' })).toMatchObject({ ok: false, code: 'invalid_method' })
    expect(parseClaimInput({ method: 'instagram', instagram_handle: '' })).toMatchObject({ ok: false, code: 'invalid_proof' })
    expect(parseClaimInput({ method: 'link', proof_url: 'javascript:x' })).toMatchObject({ ok: false, code: 'invalid_proof' })
    expect(parseClaimInput({ method: 'upload' })).toMatchObject({ ok: false, code: 'invalid_proof' })
    expect(parseClaimInput({ method: 'instagram', instagram_handle: '@me' })).toMatchObject({ ok: true })
  })
  it('moves the event and removes the community credit', () => {
    const DEL = Symbol('delete')
    const patch = claimTransferPatch('org9', 'Kompa Nights', 'NOW', DEL)
    expect(patch).toMatchObject({ organizer_id: 'org9', organizer_name: 'Kompa Nights', community_shared: false, claimable: false, claimed_by: 'org9', claimed_at: 'NOW' })
    for (const f of ['source_name', 'source_handle', 'source_url', 'external_url', 'community_free']) expect(patch[f]).toBe(DEL)
  })
})

describe('claim proof paths', () => {
  it('accepts one file directly under the owner’s claim-proofs/{uid}/', () => {
    expect(isClaimProofPathFor('claim-proofs/u1/proof_1.jpg', 'u1')).toBe(true)
    expect(isClaimProofPath('claim-proofs/u1/proof_1.pdf')).toBe(true)
  })
  it.each([
    ['claim-proofs/u2/proof_1.jpg'],
    ['claim-proofs/u1/../u2/x.jpg'],
    ['claim-proofs/u1/a/b.jpg'],
    ['claim-proofs/u1/'],
    ['claim-proofs/u1/.hidden'],
    ['event-images/u1_x.jpg'],
    ['gs://bucket/claim-proofs/u1/x.jpg'],
    ['https://firebasestorage.googleapis.com/v0/b/x/o/claim-proofs%2Fu1%2Fx.jpg'],
  ])('refuses %s for u1', (p) => {
    expect(isClaimProofPathFor(p, 'u1')).toBe(false)
  })
})
