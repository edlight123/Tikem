/**
 * The app mirrors the approval-list rules (mobile/lib/attendRequests.ts) because
 * it cannot import lib/events/approval.ts. If the two drift, the app's sheet
 * offers a plus-one the server then refuses (or hides one it would accept).
 * Reconcile mobile/lib/attendRequests.ts with lib/events/approval.ts, which is
 * the source of truth.
 *
 * @jest-environment node
 */

jest.mock('@/mobile/lib/api/backend', () => ({ backendJson: jest.fn() }))

import * as web from '@/lib/events/approval'
import * as app from '@/mobile/lib/attendRequests'
import { MAX_FREE_TICKETS_PER_PERSON as WEB_CAP } from '@/lib/ticketPricing'
import { MAX_FREE_TICKETS_PER_PERSON as APP_CAP } from '@/mobile/lib/ticketPricing'

describe('approval-list rules: app mirrors web', () => {
  it('shares the constants and the free cap', () => {
    expect(app.PLUS_ONES_SETTING_MAX).toBe(web.PLUS_ONES_SETTING_MAX)
    expect(app.ATTEND_NOTE_MAX).toBe(web.ATTEND_NOTE_MAX)
    expect(app.PLUS_ONE_NAME_MAX).toBe(web.PLUS_ONE_NAME_MAX)
    expect(APP_CAP).toBe(WEB_CAP)
  })

  const settings: unknown[] = [0, 1, 2, 3, 4, 9, -1, '2', 'x', null, undefined, 2.5]
  const caps = [0, 1, 2, 3, 4, 10]

  it('allowedPlusOnes agrees on every setting x cap', () => {
    for (const s of settings) {
      for (const c of caps) expect([s, c, app.allowedPlusOnes(s, c)]).toEqual([s, c, web.allowedPlusOnes(s, c)])
      expect(app.allowedPlusOnes(s)).toBe(web.allowedPlusOnes(s))
    }
  })

  it('event helpers agree', () => {
    const events: any[] = [null, {}, { plus_ones_max: 3 }, { requires_approval: true }, { requires_approval: 'true' }]
    for (const e of events) {
      expect(app.plusOnesSetting(e)).toBe(web.plusOnesSetting(e))
      expect(app.eventAllowedPlusOnes(e)).toBe(web.eventAllowedPlusOnes(e))
      expect(app.eventRequiresApproval(e)).toBe(web.eventRequiresApproval(e))
    }
  })
})
