/**
 * Organizer deactivation (lib/account/deactivation.ts): refuses while attendees
 * hold tickets; otherwise unpublishes upcoming published events, records which,
 * and reactivation restores exactly those.
 *
 * @jest-environment node
 */

type Doc = Record<string, any>
const db: Record<string, Record<string, Doc>> = {}
let obligations: any[] = []

function snapOf(col: string, id: string) {
  const d = db[col]?.[id]
  return {
    id,
    exists: Boolean(d),
    data: () => d,
    ref: refOf(col, id),
  }
}
function refOf(col: string, id: string) {
  return {
    id,
    get: async () => snapOf(col, id),
    update: async (patch: Doc) => Object.assign(db[col][id], patch),
    set: async (data: Doc, opts?: any) => {
      db[col] = db[col] || {}
      db[col][id] = opts?.merge ? { ...(db[col][id] || {}), ...data } : data
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({
      doc: (id: string) => refOf(col, id),
      where: (f: string, _op: string, v: any) => ({
        get: async () => ({
          docs: Object.keys(db[col] || {})
            .filter((id) => db[col][id][f] === v)
            .map((id) => snapOf(col, id)),
        }),
      }),
    }),
    batch: () => {
      const ops: Array<() => Promise<any>> = []
      return {
        update: (ref: any, patch: Doc) => ops.push(() => ref.update(patch)),
        commit: async () => { for (const op of ops) await op() },
      }
    },
  },
}))
jest.mock('@/lib/account/deletion', () => ({ findActiveObligations: jest.fn(async () => obligations) }))

import { deactivateOrganizerAccount, getDeactivation, reactivateOrganizerAccount } from '@/lib/account/deactivation'

const NOW = new Date('2026-10-25T12:00:00.000Z')

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  obligations = []
  db.users = { org1: { email: 'o@x.com' } }
  db.events = {
    upcoming: { organizer_id: 'org1', is_published: true, start_datetime: '2026-12-01T20:00:00.000Z' },
    draft: { organizer_id: 'org1', is_published: false, start_datetime: '2026-12-02T20:00:00.000Z' },
    past: { organizer_id: 'org1', is_published: true, start_datetime: '2026-01-01T20:00:00.000Z' },
    other: { organizer_id: 'someoneElse', is_published: true, start_datetime: '2026-12-01T20:00:00.000Z' },
  }
})

describe('deactivateOrganizerAccount', () => {
  it('refuses while an upcoming event has sold tickets, and changes nothing', async () => {
    obligations = [{ type: 'upcoming_events_with_sales', events: [{ id: 'upcoming', title: 'Show', ticketsSold: 3 }] }]
    const out = await deactivateOrganizerAccount('org1', NOW)
    expect(out).toEqual({ status: 'refused', events: [{ id: 'upcoming', title: 'Show', ticketsSold: 3 }] })
    expect(db.events.upcoming.is_published).toBe(true)
    expect(db.users.org1.account_status).toBeUndefined()
  })

  it('ignores money obligations that are not attendee tickets', async () => {
    obligations = [{ type: 'unwithdrawn_balance', balances: [{ currency: 'USD', amountMinor: 500 }] }]
    const out = await deactivateOrganizerAccount('org1', NOW)
    expect(out.status).toBe('deactivated')
  })

  it('unpublishes only upcoming published events, records them, and reactivation restores exactly those', async () => {
    const out = await deactivateOrganizerAccount('org1', NOW)
    expect(out).toEqual({ status: 'deactivated', unpublishedEventIds: ['upcoming'] })
    expect(db.events.upcoming.is_published).toBe(false)
    expect(db.events.upcoming.unpublished_by_deactivation).toBe(true)
    expect(db.events.past.is_published).toBe(true)
    expect(db.events.other.is_published).toBe(true)
    expect(db.users.org1.account_status).toBe('deactivated')
    expect((await getDeactivation('org1'))?.unpublished_event_ids).toEqual(['upcoming'])

    const back = await reactivateOrganizerAccount('org1', NOW)
    expect(back.restoredEventIds).toEqual(['upcoming'])
    expect(db.events.upcoming.is_published).toBe(true)
    expect(db.events.draft.is_published).toBe(false)
    expect(db.users.org1.account_status).toBe('active')
    expect(await getDeactivation('org1')).toBeNull()
  })
})
