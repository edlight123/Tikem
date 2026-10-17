/**
 * @jest-environment node
 *
 * Contact matching (lib/firestore/connections.ts#matchContacts): verified
 * numbers only, phone discovery respected, and each match names the caller's
 * own submitted strings so the app can tell which contacts are on Tikèm
 * without guessing by display name.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockDb = new FakeFirestore()
const mockGetUsers = jest.fn()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockDb
  },
  adminAuth: { getUsers: (...a: any[]) => mockGetUsers(...a) },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}))

import { matchContacts } from '@/lib/firestore/connections'

// Verified Auth numbers by uid.
const AUTH: Record<string, string> = {
  bob: '+50937000001',
  carl: '+15551234567',
  dana: '+50937000002',
}

beforeEach(() => {
  mockDb.store.clear()
  mockGetUsers.mockReset()
  mockGetUsers.mockImplementation(async (ids: Array<{ phoneNumber: string }>) => ({
    users: Object.entries(AUTH)
      .filter(([, phone]) => ids.some((i) => i.phoneNumber === phone))
      .map(([uid, phoneNumber]) => ({ uid, phoneNumber, disabled: false })),
  }))
  mockDb.store.set('users/bob', { full_name: 'Bob' })
  mockDb.store.set('users/carl', { full_name: 'Carl' })
  mockDb.store.set('users/dana', { full_name: 'Dana', privacy: { discoverable_by_phone: false } })
  mockDb.store.set('connections/alice__bob', {
    users: ['alice', 'bob'],
    status: 'accepted',
    requester_id: 'alice',
    recipient_id: 'bob',
  })
})

describe('matchContacts', () => {
  it('echoes every submitted string that matched, in its original form', async () => {
    const out = await matchContacts('alice', ['3700 0001', '+509 37 00 0001', '(555) 123-4567', '+1 999 000 0000'])
    const byUid = Object.fromEntries(out.map((m) => [m.uid, m]))
    expect(Object.keys(byUid).sort()).toEqual(['bob', 'carl'])
    expect(byUid.bob.phones.sort()).toEqual(['+509 37 00 0001', '3700 0001'].sort())
    expect(byUid.carl.phones).toEqual(['(555) 123-4567'])
    expect(byUid.bob.friendship).toBe('friends')
    expect(byUid.carl.friendship).toBe('none')
  })

  it('leaves out people who turned phone discovery off, and the caller', async () => {
    AUTH.alice = '+50937000009'
    try {
      const out = await matchContacts('alice', ['+50937000002', '+50937000009'])
      expect(out).toEqual([])
    } finally {
      delete AUTH.alice
    }
  })

  it('never looks up a number it cannot read unambiguously', async () => {
    expect(await matchContacts('alice', ['12345', ''])).toEqual([])
    expect(mockGetUsers).not.toHaveBeenCalled()
  })
})
