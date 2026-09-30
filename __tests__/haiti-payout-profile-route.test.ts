/**
 * POST /api/organizer/payout-profiles/haiti — the preference-only path mobile
 * uses for the "Instant MonCash payouts" toggle, and the step-up signal.
 *
 * @jest-environment node
 */

const session = { uid: 'org_1' as string | null }
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () =>
    session.uid ? { user: { id: session.uid }, error: null } : { user: null, error: 'Not authenticated' }
  ),
}))

const profiles: Record<string, any> = {}
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: jest.fn(async (uid: string) => profiles[uid] ?? null),
}))

const updateMock = jest.fn()
jest.mock('@/lib/firestore/payout', () => ({
  updatePayoutProfileConfig: (...args: any[]) => updateMock(...args),
}))

import { POST } from '@/app/api/organizer/payout-profiles/haiti/route'

const post = (body: any) =>
  POST(
    new Request('http://localhost/api/organizer/payout-profiles/haiti', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as any
  )

beforeEach(() => {
  session.uid = 'org_1'
  for (const k of Object.keys(profiles)) delete profiles[k]
  updateMock.mockReset()
  updateMock.mockResolvedValue({ success: true })
})

describe('preference-only allowInstantMoncash update', () => {
  it('writes ONLY allowInstantMoncash — no method, provider or details', async () => {
    profiles.org_1 = { method: 'mobile_money', payoutProvider: 'moncash' }
    const res = await post({ allowInstantMoncash: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, allowInstantMoncash: true })
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith('org_1', 'haiti', { allowInstantMoncash: true })
  })

  it('can turn it off', async () => {
    profiles.org_1 = { method: 'mobile_money', allowInstantMoncash: true }
    const res = await post({ allowInstantMoncash: false })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith('org_1', 'haiti', { allowInstantMoncash: false })
  })

  it('refuses when there is no Haiti profile to attach it to', async () => {
    const res = await post({ allowInstantMoncash: true })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('HAITI_PROFILE_REQUIRED')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('surfaces a write failure as a 500', async () => {
    profiles.org_1 = { method: 'mobile_money' }
    updateMock.mockResolvedValue({ success: false, error: 'boom' })
    const res = await post({ allowInstantMoncash: true })
    expect(res.status).toBe(500)
  })

  it('requires auth', async () => {
    session.uid = null
    const res = await post({ allowInstantMoncash: true })
    expect(res.status).toBe(401)
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('full save', () => {
  it('still validates details when a method is sent', async () => {
    const res = await post({ method: 'mobile_money', allowInstantMoncash: true })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('returns a 403 with a machine-readable code when OTP step-up is needed', async () => {
    updateMock.mockResolvedValue({ success: false, error: 'PAYOUT_CHANGE_VERIFICATION_REQUIRED' })
    const res = await post({
      method: 'mobile_money',
      mobileMoneyDetails: { provider: 'moncash', phoneNumber: '+50937000000', accountName: 'A B' },
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
    expect(body.requiresVerification).toBe(true)
  })
})
