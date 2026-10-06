/**
 * The app's "add your number" prompt: when it may appear
 * (mobile/lib/phonePromptPolicy.ts), and that its per-account counter is
 * cleared on sign-out like the other user-scoped keys.
 */
import fs from 'fs'
import path from 'path'
import {
  EMPTY_PHONE_PROMPT_STATE,
  PHONE_PROMPT_COOLDOWN_MS,
  PHONE_PROMPT_MAX_SHOWS,
  PHONE_PROMPT_STORAGE_PREFIX,
  parsePhonePromptState,
  phonePromptStorageKey,
  recordPhonePromptShown,
  shouldShowPhonePrompt,
  type PhonePromptDecisionInput,
} from '../mobile/lib/phonePromptPolicy'

const NOW = 1_800_000_000_000
const base: PhonePromptDecisionInput = {
  flagOn: true,
  signedIn: true,
  hasVerifiedPhone: false,
  trigger: 'post_purchase',
  state: EMPTY_PHONE_PROMPT_STATE,
  now: NOW,
}

describe('shouldShowPhonePrompt', () => {
  it('shows the first time', () => {
    expect(shouldShowPhonePrompt(base)).toBe(true)
  })

  it('never with the switch off, signed out, or a verified phone, whatever the trigger', () => {
    for (const trigger of ['post_purchase', 'find_friends'] as const) {
      expect(shouldShowPhonePrompt({ ...base, trigger, flagOn: false })).toBe(false)
      expect(shouldShowPhonePrompt({ ...base, trigger, signedIn: false })).toBe(false)
      expect(shouldShowPhonePrompt({ ...base, trigger, hasVerifiedPhone: true })).toBe(false)
    }
  })

  it('waits 7 days between automatic asks', () => {
    const state = { shownCount: 1, lastShownAt: NOW }
    expect(shouldShowPhonePrompt({ ...base, state, now: NOW + PHONE_PROMPT_COOLDOWN_MS - 1 })).toBe(false)
    expect(shouldShowPhonePrompt({ ...base, state, now: NOW + PHONE_PROMPT_COOLDOWN_MS })).toBe(true)
  })

  it('a clock that went backwards still waits', () => {
    expect(shouldShowPhonePrompt({ ...base, state: { shownCount: 1, lastShownAt: NOW + 1000 } })).toBe(false)
  })

  it(`never more than ${PHONE_PROMPT_MAX_SHOWS} automatic asks in total`, () => {
    let state = EMPTY_PHONE_PROMPT_STATE
    let now = NOW
    let shown = 0
    for (let week = 0; week < 10; week++) {
      if (shouldShowPhonePrompt({ ...base, state, now })) {
        state = recordPhonePromptShown(state, 'post_purchase', now)
        shown++
      }
      now += PHONE_PROMPT_COOLDOWN_MS
    }
    expect(shown).toBe(PHONE_PROMPT_MAX_SHOWS)
  })

  it('a user-started ask (find friends) is always allowed and does not use the budget', () => {
    const spent = { shownCount: PHONE_PROMPT_MAX_SHOWS, lastShownAt: NOW }
    expect(shouldShowPhonePrompt({ ...base, trigger: 'find_friends', state: spent })).toBe(true)
    expect(recordPhonePromptShown(spent, 'find_friends', NOW + 5)).toBe(spent)
  })
})

describe('stored state', () => {
  it('round-trips and tolerates junk', () => {
    const s = recordPhonePromptShown(EMPTY_PHONE_PROMPT_STATE, 'post_purchase', NOW)
    expect(parsePhonePromptState(JSON.stringify(s))).toEqual({ shownCount: 1, lastShownAt: NOW })
    expect(parsePhonePromptState(null)).toEqual(EMPTY_PHONE_PROMPT_STATE)
    expect(parsePhonePromptState('{nope')).toEqual(EMPTY_PHONE_PROMPT_STATE)
    expect(parsePhonePromptState('{"shownCount":-4,"lastShownAt":"x"}')).toEqual(EMPTY_PHONE_PROMPT_STATE)
  })

  it('is keyed per account and cleared on sign-out (AuthContext user-scoped prefixes)', () => {
    expect(phonePromptStorageKey('abc')).toBe(`${PHONE_PROMPT_STORAGE_PREFIX}abc`)
    const auth = fs.readFileSync(path.join(__dirname, '../mobile/contexts/AuthContext.tsx'), 'utf8')
    const prefixes = auth.slice(auth.indexOf('const USER_SCOPED_PREFIXES'), auth.indexOf('];', auth.indexOf('const USER_SCOPED_PREFIXES')))
    expect(prefixes).toContain(`'${PHONE_PROMPT_STORAGE_PREFIX}'`)
  })
})
