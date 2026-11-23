import {
  PUSH_TOKEN_REFRESH_MS,
  cachedPushToken,
  needsPushRegistration,
  parsePushTokenCache,
  serializePushTokenCache,
} from '../mobile/lib/pushTokenCache'

const T = 'ExponentPushToken[abc]'
const NOW = 1_800_000_000_000

describe('when the app re-sends its push token (mobile/lib/pushTokenCache)', () => {
  it('a fresh record for the same token and account skips the call', () => {
    const rec = { token: T, uid: 'u1', at: NOW - 1000 }
    expect(needsPushRegistration(parsePushTokenCache(serializePushTokenCache(rec)), T, 'u1', NOW)).toBe(false)
  })

  it('re-registers for a new token, another account, no account, a day-old or future record', () => {
    const rec = { token: T, uid: 'u1', at: NOW - 1000 }
    expect(needsPushRegistration(rec, 'ExponentPushToken[new]', 'u1', NOW)).toBe(true)
    expect(needsPushRegistration(rec, T, 'u2', NOW)).toBe(true)
    expect(needsPushRegistration(rec, T, null, NOW)).toBe(true)
    expect(needsPushRegistration({ ...rec, at: NOW - PUSH_TOKEN_REFRESH_MS }, T, 'u1', NOW)).toBe(true)
    expect(needsPushRegistration({ ...rec, at: NOW + 60_000 }, T, 'u1', NOW)).toBe(true)
    expect(needsPushRegistration(null, T, 'u1', NOW)).toBe(true)
  })

  it('the old bare-string cache counts as stale but sign-out still finds its token', () => {
    expect(parsePushTokenCache(T)).toBeNull()
    expect(cachedPushToken(T)).toBe(T)
    expect(cachedPushToken(serializePushTokenCache({ token: T, uid: 'u', at: 1 }))).toBe(T)
    expect(cachedPushToken('garbage')).toBeNull()
    expect(cachedPushToken(null)).toBeNull()
  })
})
