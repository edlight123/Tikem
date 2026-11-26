/**
 * The preference centre's contract: transactional messages (tickets,
 * reminders for tickets you hold, event changes and cancellations, payouts)
 * ALWAYS send, whatever a switch says; only discretionary ones obey a switch.
 */
import { decideSend, isCategoryEnabled, type NotificationCategory } from '@/lib/notifications/policy'
import { sanitizeUserNotifyPrefs, USER_NOTIFY_FIELDS } from '@/lib/notifications/userPreferences'
import { followerNewEventCopy } from '@/lib/notifications/follower-new-event'
import { eventShowsAttendees, isSociallyVisibleEvent } from '@/lib/social/event-privacy'

const EVERYTHING_OFF: Record<string, any> = {
  notify_ticket_purchase: false,
  notify_event_updates: false,
  notify_reminders: false,
  notify_discovery: false,
  notify_weekend_digest: false,
  notify_filling_fast: false,
  notify_national_day: false,
  notify_friend_invites: false,
  notify_followed_organizers: false,
  notify: { reminders: false, updates: false },
  last_seen_country: 'HT',
}
// Noon in Port-au-Prince: outside quiet hours.
const NOON = new Date('2026-09-06T17:00:00.000Z')

describe('preference centre: transactional always sends', () => {
  it.each(['purchase', 'reminder', 'event_change', 'payout'] as NotificationCategory[])(
    '%s goes out with every switch off',
    (category) => {
      expect(isCategoryEnabled(EVERYTHING_OFF, category)).toBe(true)
      expect(decideSend({ user: EVERYTHING_OFF, category, now: NOON }).send).toBe(true)
    }
  )
})

describe('preference centre: discretionary obeys its switch', () => {
  const cases: [NotificationCategory, string][] = [
    ['discovery', 'notify_discovery'],
    ['weekend_digest', 'notify_weekend_digest'],
    ['filling_fast', 'notify_filling_fast'],
    ['national_day', 'notify_national_day'],
    ['saved_event', 'notify_reminders'],
    ['event_feedback', 'notify_reminders'],
    ['friend_invite', 'notify_friend_invites'],
    ['friend_request', 'notify_friend_invites'],
    ['organizer_follow', 'notify_followed_organizers'],
  ]
  it.each(cases)('%s is silenced by %s and on by default', (category, field) => {
    expect(decideSend({ user: { last_seen_country: 'HT', [field]: false }, category, now: NOON })).toEqual({
      send: false,
      reason: 'category_disabled',
    })
    expect(decideSend({ user: { last_seen_country: 'HT' }, category, now: NOON }).send).toBe(true)
  })

  it('every switch the profile can write is one the senders read', () => {
    expect([...USER_NOTIFY_FIELDS].sort()).toEqual(
      [
        'notify_discovery',
        'notify_filling_fast',
        'notify_followed_organizers',
        'notify_friend_invites',
        'notify_national_day',
        'notify_reminders',
        'notify_weekend_digest',
      ].sort()
    )
    // The transactional switches can't be written from the profile any more.
    expect(sanitizeUserNotifyPrefs({ notify_ticket_purchase: false, notify_event_updates: false })).toEqual({})
  })
})

describe('follower new-event push', () => {
  it('speaks the follower’s language', () => {
    expect(followerNewEventCopy('fr', 'Kompa Club', 'Bal')).toEqual({ title: 'Nouveau chez Kompa Club', body: 'Bal' })
    expect(followerNewEventCopy('ht', '', 'Bal').title).toBe('Nouvo nan Yon òganizatè ou swiv')
    expect(followerNewEventCopy(undefined, 'X', '').body).toBe('A new event is up.')
  })

  it('never announces a password-protected or unlisted event', () => {
    const base = { is_published: true, status: 'published' }
    expect(isSociallyVisibleEvent(base)).toBe(true)
    expect(isSociallyVisibleEvent({ ...base, is_password_protected: true })).toBe(false)
    expect(isSociallyVisibleEvent({ ...base, visibility: 'unlisted' })).toBe(false)
    expect(isSociallyVisibleEvent({ ...base, unlisted: true })).toBe(false)
    expect(isSociallyVisibleEvent({ ...base, is_published: false })).toBe(false)
    expect(isSociallyVisibleEvent({ ...base, status: 'cancelled' })).toBe(false)
    expect(isSociallyVisibleEvent({ ...base, rejected: true })).toBe(false)
    expect(eventShowsAttendees({ ...base, guestlist_visibility: 'count' })).toBe(false)
    expect(eventShowsAttendees({ ...base, show_guestlist: false })).toBe(false)
    expect(eventShowsAttendees(base)).toBe(true)
  })
})
