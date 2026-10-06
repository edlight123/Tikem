/**
 * When may the app ask "add your number"? Pure, no React Native imports, so
 * the root jest suite tests it directly (__tests__/phone-prompt-policy.test.ts).
 *
 * Rules:
 *  - Never when the remote switch is off, when signed out, or when the account
 *    already has a verified phone (auth.currentUser.phoneNumber).
 *  - An automatic ask (after a ticket) happens at most once every 7 days and
 *    never more than 3 times in total. Skipping counts as one of the three.
 *  - An ask the person started themselves ("find friends from contacts") is
 *    always allowed and does not use up the automatic budget.
 */

export const PHONE_PROMPT_MAX_SHOWS = 3;
export const PHONE_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** User-scoped AsyncStorage prefix; AuthContext clears it on sign-out. */
export const PHONE_PROMPT_STORAGE_PREFIX = 'tikem_phone_prompt_';

export type PhonePromptTrigger = 'post_purchase' | 'find_friends';

export interface PhonePromptState {
  /** Automatic asks shown so far. */
  shownCount: number;
  /** Epoch ms of the last automatic ask, or null. */
  lastShownAt: number | null;
}

export const EMPTY_PHONE_PROMPT_STATE: PhonePromptState = { shownCount: 0, lastShownAt: null };

export interface PhonePromptDecisionInput {
  flagOn: boolean;
  signedIn: boolean;
  hasVerifiedPhone: boolean;
  trigger: PhonePromptTrigger;
  state: PhonePromptState;
  now: number;
}

export function shouldShowPhonePrompt(i: PhonePromptDecisionInput): boolean {
  if (i.flagOn !== true || i.signedIn !== true || i.hasVerifiedPhone) return false;
  if (i.trigger === 'find_friends') return true;
  const count = Number.isFinite(i.state?.shownCount) ? i.state.shownCount : 0;
  if (count >= PHONE_PROMPT_MAX_SHOWS) return false;
  const last = i.state?.lastShownAt;
  if (typeof last === 'number' && Number.isFinite(last)) {
    // A clock that went backwards (last in the future) also waits.
    if (i.now - last < PHONE_PROMPT_COOLDOWN_MS) return false;
  }
  return true;
}

/** The state after an ask was shown. Only automatic asks are counted. */
export function recordPhonePromptShown(
  state: PhonePromptState,
  trigger: PhonePromptTrigger,
  now: number,
): PhonePromptState {
  if (trigger !== 'post_purchase') return state;
  return { shownCount: Math.max(0, state.shownCount || 0) + 1, lastShownAt: now };
}

export function phonePromptStorageKey(uid: string): string {
  return `${PHONE_PROMPT_STORAGE_PREFIX}${uid}`;
}

/** Parse what was stored; anything unreadable is a fresh state. */
export function parsePhonePromptState(raw: string | null | undefined): PhonePromptState {
  if (!raw) return { ...EMPTY_PHONE_PROMPT_STATE };
  try {
    const v = JSON.parse(raw);
    const shownCount = Number.isFinite(v?.shownCount) && v.shownCount > 0 ? Math.floor(v.shownCount) : 0;
    const lastShownAt = Number.isFinite(v?.lastShownAt) ? Number(v.lastShownAt) : null;
    return { shownCount, lastShownAt };
  } catch {
    return { ...EMPTY_PHONE_PROMPT_STATE };
  }
}
