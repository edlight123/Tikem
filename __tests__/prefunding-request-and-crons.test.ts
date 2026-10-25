/**
 * MonCash prefunding: the French Digicel request, the request log's state
 * machine, the Monday brief timing, and cron authentication. Every Firestore,
 * MonCash and email dependency is mocked: nothing here reaches production.
 *
 * @jest-environment node
 */

const loadPrefundingPlan = jest.fn()
const claimRun = jest.fn()
const releaseRun = jest.fn()
const sendOpsEmail = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async () => {},
        create: async () => {},
        delete: async () => {},
      }),
    }),
  },
}))
jest.mock('@/lib/payouts/prefunding-plan-server', () => ({ loadPrefundingPlan: (...a: any[]) => loadPrefundingPlan(...a) }))
const moncashPrefundedBalance = jest.fn()
jest.mock('@/lib/moncash', () => ({ moncashPrefundedBalance: (...a: any[]) => moncashPrefundedBalance(...a) }))
jest.mock('@/lib/payouts/prefunding-alerts-server', () => ({
  autoConfirmSentRequests: jest.fn(),
  maybeSendLowBalanceAlert: jest.fn(),
  claimRun: (...a: any[]) => claimRun(...a),
  releaseRun: (...a: any[]) => releaseRun(...a),
  sendOpsEmail: (...a: any[]) => sendOpsEmail(...a),
}))

import {
  formatHtgFigures,
  numberToFrenchWords,
  prefundingRequestReference,
} from '@/lib/payouts/prefunding-email'
import { transitionPrefundingRequest } from '@/lib/payouts/prefunding-requests'
import { buildBriefEmail, isBriefHour } from '@/lib/payouts/prefunding-notify'
import { computePrefundingPlan } from '@/lib/payouts/prefunding-plan'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { GET as briefGET } from '@/app/api/cron/prefunding-brief/route'
import { GET as refreshGET } from '@/app/api/cron/prefunding-refresh/route'

describe('numberToFrenchWords', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [21, 'vingt et un'],
    [71, 'soixante et onze'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [97, 'quatre-vingt-dix-sept'],
    [100, 'cent'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [1000, 'mille'],
    [21000, 'vingt et un mille'],
    [50000, 'cinquante mille'],
    [80000, 'quatre-vingt mille'],
    [200000, 'deux cent mille'],
    [1000000, 'un million'],
    [2_000_000, 'deux millions'],
    [200_000_000, 'deux cents millions'],
    [1_234_567, 'un million deux cent trente-quatre mille cinq cent soixante-sept'],
  ])('%d → %s', (n, words) => {
    expect(numberToFrenchWords(n)).toBe(words)
  })

  it('groups figures with spaces', () => {
    expect(formatHtgFigures(50000)).toBe('50 000')
    expect(formatHtgFigures(1234567)).toBe('1 234 567')
    expect(formatHtgFigures(999)).toBe('999')
  })
})

describe('prefundingRequestReference', () => {
  it('is the Haiti day plus 4 characters of the doc id', () => {
    expect(prefundingRequestReference(new Date('2026-10-26T14:00:00Z'), 'abCD9xyz')).toBe('TKM-PF-20261026-ABCD')
  })
})

describe('transitionPrefundingRequest', () => {
  const now = new Date('2026-10-26T15:00:00Z')
  const base = { amountHtg: 50_000, balanceAtGenerationHtg: 1_000 }

  it('generated → sent records the live balance as the baseline', () => {
    const r = transitionPrefundingRequest({ ...base, status: 'generated' }, 'sent', { now, actorId: 'a', liveBalanceHtg: 1_200 })
    expect(r).toEqual({ ok: true, updates: expect.objectContaining({ status: 'sent', balanceAtSentHtg: 1_200 }) })
  })

  it('completed only once the pool has risen above the baseline', () => {
    const sent = { ...base, status: 'sent' as const, balanceAtSentHtg: 1_200 }
    const notYet = transitionPrefundingRequest(sent, 'completed', { now, actorId: 'a', liveBalanceHtg: 1_200 })
    expect(notYet.ok).toBe(false)
    const unknown = transitionPrefundingRequest(sent, 'completed', { now, actorId: 'a', liveBalanceHtg: null })
    expect(unknown).toEqual(expect.objectContaining({ ok: false, status: 503 }))
    const done = transitionPrefundingRequest(sent, 'completed', { now, actorId: 'a', liveBalanceHtg: 51_200 })
    expect(done).toEqual({ ok: true, updates: expect.objectContaining({ status: 'completed', balanceAtCompletionHtg: 51_200 }) })
  })

  it('refuses moves out of a final state and is idempotent', () => {
    expect(transitionPrefundingRequest({ ...base, status: 'completed' }, 'sent', { now, actorId: 'a', liveBalanceHtg: 1 }).ok).toBe(false)
    expect(transitionPrefundingRequest({ ...base, status: 'cancelled' }, 'completed', { now, actorId: 'a', liveBalanceHtg: 9e9 }).ok).toBe(false)
    expect(transitionPrefundingRequest({ ...base, status: 'sent' }, 'sent', { now, actorId: 'a', liveBalanceHtg: 1 })).toEqual({ ok: true, updates: {} })
  })
})

describe('Monday brief timing', () => {
  it('fires at 12:00 UTC while Haiti is on EDT and 13:00 UTC on EST', () => {
    expect(isBriefHour(new Date('2026-10-26T12:00:00Z'))).toBe(true)
    expect(isBriefHour(new Date('2026-10-26T13:00:00Z'))).toBe(false)
    expect(isBriefHour(new Date('2026-11-02T12:00:00Z'))).toBe(false)
    expect(isBriefHour(new Date('2026-11-02T13:00:00Z'))).toBe(true)
    // Not on a Tuesday.
    expect(isBriefHour(new Date('2026-10-27T12:00:00Z'))).toBe(false)
  })

  it('the brief reads "nothing due" on an empty plan', () => {
    const plan = computePrefundingPlan({ now: new Date('2026-10-26T12:00:00Z'), events: [], unsentWithdrawals: [], poolBalanceHtg: 0 })
    const { subject, html } = buildBriefEmail(plan)
    expect(subject).toContain('nothing due')
    expect(html).toContain('Nothing due')
    expect(html).toContain('/admin/money/moncash-funding')
  })
})

describe('cron auth', () => {
  const OLD = process.env.CRON_SECRET
  afterEach(() => {
    process.env.CRON_SECRET = OLD
    jest.clearAllMocks()
  })

  const req = (auth?: string, url = 'https://www.tikem.co/api/cron/prefunding-brief') =>
    new Request(url, { headers: auth ? { authorization: auth } : {} })

  it('isAuthorizedCronRequest fails closed', () => {
    expect(isAuthorizedCronRequest(req('Bearer s'), undefined)).toBe(false)
    expect(isAuthorizedCronRequest(req('Bearer s'), '')).toBe(false)
    expect(isAuthorizedCronRequest(req(), 's')).toBe(false)
    expect(isAuthorizedCronRequest(req('Bearer x'), 's')).toBe(false)
    expect(isAuthorizedCronRequest(req('s'), 's')).toBe(false)
    expect(isAuthorizedCronRequest(req('Bearer s'), 's')).toBe(true)
  })

  it('the brief route refuses without the secret and does no work', async () => {
    process.env.CRON_SECRET = 'secret'
    expect((await briefGET(req())).status).toBe(401)
    expect((await briefGET(req('Bearer wrong'))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await briefGET(req('Bearer undefined'))).status).toBe(401)
    expect(loadPrefundingPlan).not.toHaveBeenCalled()
    expect(sendOpsEmail).not.toHaveBeenCalled()
  })

  it('the 15-minute refresh (which now also sends the low-balance alert) refuses without the secret', async () => {
    process.env.CRON_SECRET = 'secret'
    expect((await refreshGET(req('Bearer wrong'))).status).toBe(401)
    expect((await refreshGET(req())).status).toBe(401)
    expect(moncashPrefundedBalance).not.toHaveBeenCalled()
  })

  it('authorized outside 8 AM Haiti: skips without computing', async () => {
    process.env.CRON_SECRET = 'secret'
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T13:00:00Z'))
    try {
      const res = await briefGET(req('Bearer secret'))
      expect(res.status).toBe(200)
      expect((await res.json()).skipped).toBe('not_brief_hour_in_haiti')
      expect(loadPrefundingPlan).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('authorized at 8 AM Haiti: computes and emails ops once', async () => {
    process.env.CRON_SECRET = 'secret'
    const now = new Date('2026-10-26T12:00:00Z')
    jest.useFakeTimers().setSystemTime(now)
    try {
      claimRun.mockResolvedValueOnce(true)
      loadPrefundingPlan.mockResolvedValueOnce({
        plan: computePrefundingPlan({ now, events: [], unsentWithdrawals: [], poolBalanceHtg: 0 }),
      })
      sendOpsEmail.mockResolvedValueOnce({ sent: 3, recipients: ['a@x', 'b@x', 'c@x'] })
      const res = await briefGET(req('Bearer secret'))
      expect(res.status).toBe(200)
      expect((await res.json()).sent).toBe(3)
      expect(claimRun).toHaveBeenCalledWith('prefunding-brief-2026-10-26', expect.any(Object))
      expect(sendOpsEmail).toHaveBeenCalledTimes(1)

      claimRun.mockResolvedValueOnce(false)
      const again = await briefGET(req('Bearer secret'))
      expect((await again.json()).skipped).toBe('already_sent_today')
      expect(sendOpsEmail).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})
