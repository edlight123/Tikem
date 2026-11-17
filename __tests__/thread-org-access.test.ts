/**
 * lib/messages/threadViewer: access to a conversation follows the THREAD'S own
 * organization, not the org the app is acting for.
 *
 * Regression (2026-11-17): an organizer who is also an admin on another org's
 * team (Freddy, admin at Tikèm) got "Message not found" replying to a question
 * on his OWN event, because the reply route looked the thread up under the
 * acting org (Tikèm).
 *
 * @jest-environment node
 */

const threads: Record<string, Record<string, any>> = {
  own: { organizer_id: 'freddy', sender_id: 'attendee1' },
  tikem: { organizer_id: 'tikem-org', sender_id: 'attendee2' },
  other: { organizer_id: 'stranger-org', sender_id: 'attendee3' },
}
const seats: Record<string, Record<string, string>> = {
  'tikem-org': { freddy: 'admin', door: 'staff' },
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ id, exists: !!threads[id], data: () => threads[id] }),
      }),
    }),
  },
}))

jest.mock('@/lib/organizer/context', () => ({
  teamRoleIn: jest.fn(async (orgId: string, uid: string) => seats[orgId]?.[uid] ?? null),
  isPlatformAdmin: (u: any) => u.role === 'admin',
}))

jest.mock('@/lib/organizer-messages', () => ({
  getThreadForParticipant: jest.fn(async (threadId: string, userId: string) => {
    const t = threads[threadId]
    if (!t) return null
    if (t.sender_id === userId) return { id: threadId, data: t, role: 'attendee' }
    if (t.organizer_id === userId) return { id: threadId, data: t, role: 'organizer' }
    return null
  }),
}))

import { getThreadForOrgMember, getThreadForViewer } from '@/lib/messages/threadViewer'

const freddy = { id: 'freddy', role: 'organizer' } as any
const door = { id: 'door', role: 'attendee' } as any
const nobody = { id: 'nobody', role: 'attendee' } as any

describe('getThreadForOrgMember', () => {
  it("lets an organizer answer on his OWN org's thread whatever org he is acting for", async () => {
    const t = await getThreadForOrgMember('own', freddy, 'manage_events')
    expect(t).toMatchObject({ orgId: 'freddy', isOwner: true })
  })

  it("lets a team admin answer on that org's thread", async () => {
    const t = await getThreadForOrgMember('tikem', freddy, 'manage_events')
    expect(t).toMatchObject({ orgId: 'tikem-org', isOwner: false })
  })

  it('refuses door staff (their role cannot run events)', async () => {
    expect(await getThreadForOrgMember('tikem', door, 'manage_events')).toBeNull()
  })

  it('refuses strangers and missing threads alike', async () => {
    expect(await getThreadForOrgMember('other', freddy, 'manage_events')).toBeNull()
    expect(await getThreadForOrgMember('missing', freddy, 'manage_events')).toBeNull()
    expect(await getThreadForOrgMember('own', nobody, 'view')).toBeNull()
  })
})

describe('getThreadForViewer', () => {
  it('opens for the attendee, the organizer and a viewing team member', async () => {
    expect(await getThreadForViewer('own', { id: 'attendee1' } as any)).toMatchObject({ role: 'attendee' })
    expect(await getThreadForViewer('own', freddy)).toMatchObject({ role: 'organizer' })
    expect(await getThreadForViewer('tikem', freddy)).toMatchObject({ role: 'organizer' })
  })

  it('stays closed to everyone else', async () => {
    expect(await getThreadForViewer('other', freddy)).toBeNull()
    expect(await getThreadForViewer('tikem', door)).toBeNull()
  })
})
