/**
 * Who on an organization hears about what (lib/notifications/orgRecipients.ts).
 * Owner request 2026-11-15: people added to the org get event notifications
 * "depending on their admin level".
 */

type Doc = Record<string, any>
const store = new Map<string, Doc>()
let teamReadFails = false
let autoId = 0

function docRef(path: string): any {
  const id = path.split('/').pop()!
  return {
    id,
    path,
    get: async () => ({ id, exists: store.has(path), data: () => store.get(path) }),
    set: async (data: Doc) => {
      store.set(path, data)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string, filters: Array<[string, any]> = []): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    add: async (data: Doc) => {
      const ref = docRef(`${path}/auto${++autoId}`)
      await ref.set(data)
      return ref
    },
    where: (f: string, _op: string, v: any) => collectionRef(path, [...filters, [f, v]]),
    get: async () => {
      if (teamReadFails && path.endsWith('/team')) throw new Error('firestore down')
      const prefix = `${path}/`
      const docs = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .filter((k) => filters.every(([f, v]) => store.get(k)?.[f] === v))
        .map((k) => ({ id: k.split('/').pop()!, data: () => store.get(k) }))
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '<ts>' },
}))

const sendPushNotification = jest.fn(async (..._args: any[]) => undefined)
jest.mock('@/lib/notification-triggers', () => ({
  sendPushNotification: (...args: any[]) => sendPushNotification(...args),
}))

import { pickOrgRecipients, resolveOrgRecipients, seatReceives, type OrgSeat } from '@/lib/notifications/orgRecipients'
import { notifyOrganizerTicketSale } from '@/lib/notifications/helpers'

const OWNER = 'org_owner'
const seats: OrgSeat[] = [
  { uid: 'admin_fin', role: 'admin', financeView: true },
  { uid: 'admin_plain', role: 'admin', financeView: false },
  { uid: 'manager_1', role: 'manager', financeView: false },
  { uid: 'staff_door', role: 'staff', financeView: false },
  { uid: 'staff_other', role: 'staff', financeView: false },
]

describe('pickOrgRecipients (policy)', () => {
  it('event_ops: owner, admins and managers; never staff', () => {
    expect(pickOrgRecipients({ ownerId: OWNER, seats, kind: 'event_ops' })).toEqual([
      OWNER,
      'admin_fin',
      'admin_plain',
      'manager_1',
    ])
  })

  it('finance: owner and only admins granted finance_view', () => {
    expect(pickOrgRecipients({ ownerId: OWNER, seats, kind: 'finance' })).toEqual([OWNER, 'admin_fin'])
  })

  it('a manager never gets finance, even with a stray finance_view flag', () => {
    const odd: OrgSeat[] = [{ uid: 'mgr', role: 'manager', financeView: true }]
    expect(pickOrgRecipients({ ownerId: OWNER, seats: odd, kind: 'finance' })).toEqual([OWNER])
  })

  it('team: owner and admins', () => {
    expect(pickOrgRecipients({ ownerId: OWNER, seats, kind: 'team' })).toEqual([OWNER, 'admin_fin', 'admin_plain'])
  })

  it('event_day: staff only when assigned to that event', () => {
    expect(
      pickOrgRecipients({ ownerId: OWNER, seats, kind: 'event_day', eventStaffIds: ['staff_door'] })
    ).toEqual([OWNER, 'admin_fin', 'admin_plain', 'manager_1', 'staff_door'])
    expect(pickOrgRecipients({ ownerId: OWNER, seats, kind: 'event_day' })).not.toContain('staff_door')
  })

  it('owner_only: the owner alone', () => {
    expect(pickOrgRecipients({ ownerId: OWNER, seats, kind: 'owner_only' })).toEqual([OWNER])
  })

  it('never notifies the actor, including the owner', () => {
    expect(
      pickOrgRecipients({ ownerId: OWNER, seats, kind: 'event_ops', excludeUserIds: ['manager_1', null, undefined] })
    ).toEqual([OWNER, 'admin_fin', 'admin_plain'])
    expect(pickOrgRecipients({ ownerId: OWNER, seats, kind: 'event_ops', excludeUserIds: [OWNER] })).not.toContain(OWNER)
  })

  it('dedupes, and ignores a seat that is the owner', () => {
    const dupes: OrgSeat[] = [
      { uid: OWNER, role: 'admin', financeView: true },
      { uid: 'manager_1', role: 'manager', financeView: false },
      { uid: 'manager_1', role: 'manager', financeView: false },
    ]
    expect(pickOrgRecipients({ ownerId: OWNER, seats: dupes, kind: 'event_ops' })).toEqual([OWNER, 'manager_1'])
  })

  it('seatReceives matches the table', () => {
    expect(seatReceives({ uid: 'a', role: 'admin', financeView: false }, 'finance')).toBe(false)
    expect(seatReceives({ uid: 's', role: 'staff', financeView: false }, 'event_ops', { assignedToEvent: true })).toBe(false)
    expect(seatReceives({ uid: 's', role: 'staff', financeView: false }, 'event_day', { assignedToEvent: true })).toBe(true)
  })
})

describe('resolveOrgRecipients (Firestore)', () => {
  beforeEach(() => {
    store.clear()
    teamReadFails = false
    sendPushNotification.mockClear()
    const team = `organizers/${OWNER}/team`
    store.set(`${team}/admin_fin`, { uid: 'admin_fin', role: 'admin', finance_view: true, status: 'active' })
    store.set(`${team}/manager_1`, { uid: 'manager_1', role: 'manager', status: 'active' })
    // A manager who was given finance_view in some old write: still no finance.
    store.set(`${team}/manager_2`, { uid: 'manager_2', role: 'manager', finance_view: true, status: 'active' })
    store.set(`${team}/staff_door`, { uid: 'staff_door', role: 'staff', status: 'active' })
    store.set(`${team}/staff_other`, { uid: 'staff_other', role: 'staff', status: 'active' })
    // Not active: never notified.
    store.set(`${team}/pending_one`, { uid: 'pending_one', role: 'admin', status: 'pending' })
    store.set(`${team}/odd_role`, { uid: 'odd_role', role: 'superuser', status: 'active' })
    store.set('events/evt_1/members/staff_door', { role: 'staff', permissions: { checkin: true } })
  })

  it('reads active seats only', async () => {
    const ids = await resolveOrgRecipients({ orgId: OWNER, kind: 'event_ops', eventId: 'evt_1' })
    expect(ids.sort()).toEqual([OWNER, 'admin_fin', 'manager_1', 'manager_2'].sort())
  })

  it('finance reaches the finance admin only', async () => {
    expect(await resolveOrgRecipients({ orgId: OWNER, kind: 'finance' })).toEqual([OWNER, 'admin_fin'])
  })

  it('event_day includes staff assigned to that event, not other staff', async () => {
    const ids = await resolveOrgRecipients({ orgId: OWNER, kind: 'event_day', eventId: 'evt_1' })
    expect(ids).toContain('staff_door')
    expect(ids).not.toContain('staff_other')
  })

  it('falls back to the owner when the team cannot be read', async () => {
    teamReadFails = true
    expect(await resolveOrgRecipients({ orgId: OWNER, kind: 'event_ops', excludeUserIds: ['buyer'] })).toEqual([OWNER])
  })

  it('no org, nobody', async () => {
    expect(await resolveOrgRecipients({ orgId: '', kind: 'event_ops' })).toEqual([])
  })

  it('a sale reaches the owner, admin and managers once each, never the buyer or staff', async () => {
    await notifyOrganizerTicketSale(OWNER, 'evt_1', 'Konpa Night', 2, 50, 'Ana', 'USD', 'manager_2')
    const bell = (uid: string) =>
      Array.from(store.keys()).filter((k) => k.startsWith(`users/${uid}/notifications/`)).length
    expect(bell(OWNER)).toBe(1)
    expect(bell('admin_fin')).toBe(1)
    expect(bell('manager_1')).toBe(1)
    expect(bell('manager_2')).toBe(0) // the buyer
    expect(bell('staff_door')).toBe(0)
    const pushed = sendPushNotification.mock.calls.map((c) => c[0]).sort()
    expect(pushed).toEqual([OWNER, 'admin_fin', 'manager_1'].sort())
  })

  it("the org's sale-push switch off: bell entries, no pushes", async () => {
    store.set(`organizers/${OWNER}/notificationPreferences/main`, { push_ticket_sales: false })
    await notifyOrganizerTicketSale(OWNER, 'evt_1', 'Konpa Night', 1, 0, 'Ana')
    expect(sendPushNotification).not.toHaveBeenCalled()
    expect(Array.from(store.keys()).filter((k) => k.includes('/notifications/')).length).toBe(4)
  })
})
