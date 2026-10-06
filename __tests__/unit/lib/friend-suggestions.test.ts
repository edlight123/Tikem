/**
 * Friend suggestions and "friends going": the pure ranking and privacy rules
 * (lib/social/suggestions.ts).
 */
import {
  collectCandidates,
  holdsTicket,
  inSharedEventWindow,
  MIN_MUTUAL_FRIENDS,
  preselectCandidates,
  privacyFromUserDoc,
  rankSuggestions,
  selectFriendsGoing,
  suggestionReason,
  toMillis,
  type CandidatePrivacy,
} from '@/lib/social/suggestions'

const PUBLIC: CandidatePrivacy = { exists: true, discoverable: true, attendanceVisibility: 'everyone' }
const FRIENDS_ONLY: CandidatePrivacy = { exists: true, discoverable: true, attendanceVisibility: 'friends' }
const PRIVATE_ATT: CandidatePrivacy = { exists: true, discoverable: true, attendanceVisibility: 'nobody' }
const HIDDEN: CandidatePrivacy = { exists: true, discoverable: false, attendanceVisibility: 'everyone' }

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 5)

describe('privacyFromUserDoc', () => {
  it('defaults discoverable to true and attendance to nobody', () => {
    expect(privacyFromUserDoc({})).toEqual({ exists: true, discoverable: true, attendanceVisibility: 'nobody' })
  })
  it('only an explicit false hides', () => {
    expect(privacyFromUserDoc({ discoverable: false }).discoverable).toBe(false)
    expect(privacyFromUserDoc({ discoverable: 0 }).discoverable).toBe(true)
  })
  it('a missing doc is never eligible', () => {
    expect(privacyFromUserDoc(null)).toEqual({ exists: false, discoverable: false, attendanceVisibility: 'nobody' })
  })
  it('junk attendance values fall back to nobody', () => {
    expect(privacyFromUserDoc({ privacy: { attendance_visibility: 'all' } }).attendanceVisibility).toBe('nobody')
    expect(privacyFromUserDoc({ privacy: { attendance_visibility: 'everyone' } }).attendanceVisibility).toBe('everyone')
  })
})

describe('holdsTicket / window', () => {
  it('counts live and checked-in tickets, not refunded or cancelled', () => {
    for (const s of ['valid', 'confirmed', 'active', '', undefined, 'used', 'checked_in', 'VALID']) {
      expect(holdsTicket(s)).toBe(true)
    }
    for (const s of ['refunded', 'cancelled', 'transferred', 'pending']) {
      expect(holdsTicket(s)).toBe(false)
    }
  })
  it('upcoming and the last 90 days count; older and undated do not', () => {
    expect(inSharedEventWindow(new Date(NOW + 10 * DAY).toISOString(), NOW)).toBe(true)
    expect(inSharedEventWindow(new Date(NOW - 89 * DAY).toISOString(), NOW)).toBe(true)
    expect(inSharedEventWindow(new Date(NOW - 91 * DAY).toISOString(), NOW)).toBe(false)
    expect(inSharedEventWindow(null, NOW)).toBe(false)
    expect(inSharedEventWindow('not a date', NOW)).toBe(false)
  })
  it('reads Firestore timestamps', () => {
    expect(toMillis({ toMillis: () => 5 })).toBe(5)
    expect(toMillis({ _seconds: 2 })).toBe(2000)
  })
})

describe('collectCandidates', () => {
  const base = {
    viewerId: 'me',
    connectedIds: new Set(['f1', 'f2', 'f3', 'pendingP']),
    blocked: new Set<string>(),
    eventHolders: new Map<string, string[]>(),
  }

  it('counts each mutual friend once and excludes self, connections and pending requests', () => {
    const c = collectCandidates({
      ...base,
      friendsOfFriends: new Map([
        ['f1', ['me', 'x', 'x', 'f2', 'pendingP']],
        ['f2', ['me', 'x', 'y']],
        ['f3', ['x']],
      ]),
    })
    expect(c.get('x')?.mutualCount).toBe(3)
    expect(c.get('y')?.mutualCount).toBe(1)
    expect(c.has('me')).toBe(false)
    expect(c.has('f2')).toBe(false)
    expect(c.has('pendingP')).toBe(false)
  })

  it('excludes blocked users and ignores what a blocked friend brings', () => {
    const c = collectCandidates({
      ...base,
      blocked: new Set(['x', 'f3']),
      friendsOfFriends: new Map([
        ['f1', ['x', 'z']],
        ['f3', ['z']],
      ]),
      eventHolders: new Map([['e1', ['x', 'z']]]),
    })
    expect(c.has('x')).toBe(false)
    expect(c.get('z')).toEqual({ uid: 'z', mutualCount: 1, sharedEvents: 1 })
  })

  it('counts shared events per event, not per ticket', () => {
    const c = collectCandidates({
      ...base,
      friendsOfFriends: new Map(),
      eventHolders: new Map([
        ['e1', ['a', 'a', 'a', 'me']],
        ['e2', ['a', 'b']],
      ]),
    })
    expect(c.get('a')?.sharedEvents).toBe(2)
    expect(c.get('b')?.sharedEvents).toBe(1)
    expect(c.has('me')).toBe(false)
  })
})

describe('suggestionReason / rankSuggestions', () => {
  it(`friends-of-friends needs at least ${MIN_MUTUAL_FRIENDS} mutual friends`, () => {
    expect(suggestionReason({ uid: 'a', mutualCount: 1, sharedEvents: 0 }, PUBLIC)).toBeNull()
    expect(suggestionReason({ uid: 'a', mutualCount: 2, sharedEvents: 0 }, PRIVATE_ATT)).toBe('mutual_friends')
  })

  it('non-discoverable people are never suggested, for any reason', () => {
    expect(suggestionReason({ uid: 'a', mutualCount: 9, sharedEvents: 9 }, HIDDEN)).toBeNull()
    expect(suggestionReason({ uid: 'a', mutualCount: 9, sharedEvents: 9 }, undefined)).toBeNull()
    expect(suggestionReason({ uid: 'a', mutualCount: 9, sharedEvents: 9 }, privacyFromUserDoc(null))).toBeNull()
  })

  it('shared events only suggest people whose attendance is public', () => {
    const c = { uid: 'a', mutualCount: 0, sharedEvents: 3 }
    expect(suggestionReason(c, PUBLIC)).toBe('same_events')
    expect(suggestionReason(c, FRIENDS_ONLY)).toBeNull()
    expect(suggestionReason(c, PRIVATE_ATT)).toBeNull()
  })

  it('ranks mutual friends first, by count, then shared events, and caps the list', () => {
    const cands = [
      { uid: 'ev3', mutualCount: 0, sharedEvents: 3 },
      { uid: 'm2', mutualCount: 2, sharedEvents: 0 },
      { uid: 'm5', mutualCount: 5, sharedEvents: 0 },
      { uid: 'ev1', mutualCount: 1, sharedEvents: 1 },
      { uid: 'hidden', mutualCount: 10, sharedEvents: 10 },
      { uid: 'm2b', mutualCount: 2, sharedEvents: 4 },
    ]
    const privacy = new Map<string, CandidatePrivacy>([
      ['ev3', PUBLIC],
      ['m2', PUBLIC],
      ['m5', PRIVATE_ATT],
      ['ev1', PUBLIC],
      ['hidden', HIDDEN],
      ['m2b', PUBLIC],
    ])
    const ranked = rankSuggestions(cands, privacy)
    expect(ranked.map((r) => r.uid)).toEqual(['m5', 'm2b', 'm2', 'ev3', 'ev1'])
    expect(ranked[0]).toEqual({ uid: 'm5', reason: 'mutual_friends', mutualCount: 5 })
    expect(ranked[3].reason).toBe('same_events')
    expect(rankSuggestions(cands, privacy, 2).map((r) => r.uid)).toEqual(['m5', 'm2b'])
  })

  it('private attendance does not leak through the tie-break', () => {
    const ranked = rankSuggestions(
      [
        { uid: 'b', mutualCount: 2, sharedEvents: 9 },
        { uid: 'a', mutualCount: 2, sharedEvents: 0 },
      ],
      new Map([
        ['a', PUBLIC],
        ['b', PRIVATE_ATT],
      ])
    )
    expect(ranked.map((r) => r.uid)).toEqual(['a', 'b'])
  })

  it('returns only a reason and a mutual count, never event data', () => {
    const [r] = rankSuggestions([{ uid: 'a', mutualCount: 0, sharedEvents: 2 }], new Map([['a', PUBLIC]]))
    expect(Object.keys(r).sort()).toEqual(['mutualCount', 'reason', 'uid'])
  })

  it('preselect drops people who cannot qualify and keeps the strongest', () => {
    const m = new Map([
      ['weak', { uid: 'weak', mutualCount: 1, sharedEvents: 0 }],
      ['ev', { uid: 'ev', mutualCount: 0, sharedEvents: 1 }],
      ['m3', { uid: 'm3', mutualCount: 3, sharedEvents: 0 }],
    ])
    expect(preselectCandidates(m, 10).map((c) => c.uid)).toEqual(['m3', 'ev'])
    expect(preselectCandidates(m, 1).map((c) => c.uid)).toEqual(['m3'])
  })
})

describe('selectFriendsGoing', () => {
  const privacy = new Map<string, CandidatePrivacy>([
    ['f1', FRIENDS_ONLY],
    ['f2', PUBLIC],
    ['f3', PRIVATE_ATT],
    ['f4', HIDDEN],
    ['f5', PUBLIC],
    ['stranger', PUBLIC],
  ])
  const holders = new Set(['f1', 'f2', 'f3', 'f4', 'f5', 'stranger'])

  it('returns only connections, never another ticket holder', () => {
    const r = selectFriendsGoing({
      friendIds: ['f1', 'f2'],
      holderIds: holders,
      privacy,
      blocked: new Set(),
      guestlist: 'faces',
    })
    expect(r).toEqual({ count: 2, friendIds: ['f1', 'f2'] })
    expect(r.friendIds).not.toContain('stranger')
  })

  it('drops non-discoverable, private-attendance and blocked friends', () => {
    const r = selectFriendsGoing({
      friendIds: ['f1', 'f2', 'f3', 'f4', 'f5'],
      holderIds: holders,
      privacy,
      blocked: new Set(['f5']),
      guestlist: 'faces',
    })
    expect(r).toEqual({ count: 2, friendIds: ['f1', 'f2'] })
  })

  it('friends without a ticket are not going', () => {
    const r = selectFriendsGoing({
      friendIds: ['f1', 'f2'],
      holderIds: new Set(['f2']),
      privacy,
      blocked: new Set(),
      guestlist: 'faces',
    })
    expect(r.friendIds).toEqual(['f2'])
  })

  it('caps the faces but counts everyone eligible', () => {
    const many = Array.from({ length: 8 }, (_, i) => `p${i}`)
    const r = selectFriendsGoing({
      friendIds: many,
      holderIds: new Set(many),
      privacy: new Map(many.map((id) => [id, PUBLIC])),
      blocked: new Set(),
      guestlist: 'faces',
    })
    expect(r.count).toBe(8)
    expect(r.friendIds).toHaveLength(5)
  })

  it.each(['count', 'hidden'] as const)('an organizer guest list set to %s hides friends too', (guestlist) => {
    expect(
      selectFriendsGoing({ friendIds: ['f2'], holderIds: holders, privacy, blocked: new Set(), guestlist })
    ).toEqual({ count: 0, friendIds: [] })
  })
})
