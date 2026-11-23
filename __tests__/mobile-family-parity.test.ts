import * as web from '@/lib/events/family'
import * as app from '../mobile/lib/family'
import { eventAllowedPlusOnes as webAllowed } from '@/lib/events/approval'
import { eventAllowedPlusOnes as appAllowed } from '@/mobile/lib/attendRequests'

jest.mock('@/mobile/lib/api/backend', () => ({ backendJson: jest.fn() }))

describe('the app’s family rules match the web', () => {
  const cases = [
    {},
    { family_registration: true },
    { family_registration: true, family_max: 1 },
    { family_registration: true, family_max: 4 },
    { family_registration: true, family_max: 99 },
    { family_registration: false, family_max: 5, plus_ones_max: 3 },
  ]
  it('agrees on size, cap and plus-ones for every case', () => {
    expect(app.FAMILY_MAX_LIMIT).toBe(web.FAMILY_MAX_LIMIT)
    for (const e of cases) {
      expect(app.familyMax(e)).toBe(web.familyMax(e))
      expect(app.freeClaimCapFor(e)).toBe(web.freeClaimCapFor(e))
      expect(appAllowed(e)).toBe(webAllowed(e))
    }
  })
})
