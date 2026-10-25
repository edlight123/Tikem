/**
 * Page-side org gates (app/organizer/_lib/orgPage.ts), the redirect/notFound
 * twin of the API's requireOrg / requireEventAccess (docs/specs/org-teams.md):
 * admins and managers get into the portal, owner-only areas bounce them to
 * /organizer, a staff-only seat grants nothing org-wide, and per-event pages
 * answer to the event's own org.
 *
 * @jest-environment node
 */

jest.mock('server-only', () => ({}), { virtual: true })
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: (fn: any) => fn }))

class RedirectError extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`)
  }
}
class NotFoundError extends Error {}
jest.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to)
  },
  notFound: () => {
    throw new NotFoundError('notFound')
  },
}))

const mockUser = { current: null as any }
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => mockUser.current }))

const events: Record<string, any> = {}
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ exists: id in events, data: () => events[id] }),
      }),
    }),
  },
}))

const mockCtx = { current: null as any }
const mockEventRoles: Record<string, string | null> = {}
jest.mock('@/lib/organizer/context', () => {
  const { orgCan } = jest.requireActual('@/lib/organizer/teamRoles')
  return {
    getOrgContext: async () => mockCtx.current,
    canOnEvent: async (user: any, event: any, action: string) => {
      const orgId = event?.organizer_id
      if (orgId === user.id) return { allowed: true, role: 'owner' }
      const role = mockEventRoles[orgId] ?? null
      return { allowed: orgCan(role, action), role }
    },
  }
})

import { getPortalOrgContext, requireEventPage, requireOrgPage } from '@/app/organizer/_lib/orgPage'

const organizer = { id: 'me', role: 'organizer', email: 'me@x.co' }
const attendee = { id: 'me', role: 'attendee', email: 'me@x.co' }

function ctx(user: any, orgId: string, role: string) {
  return { user, orgId, role, isOwner: role === 'owner', isPlatformAdmin: false }
}

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof RedirectError) return `redirect:${e.to}`
    if (e instanceof NotFoundError) return 'notFound'
    throw e
  }
}

beforeEach(() => {
  mockUser.current = null
  mockCtx.current = null
  for (const k of Object.keys(events)) delete events[k]
  for (const k of Object.keys(mockEventRoles)) delete mockEventRoles[k]
})

describe('requireOrgPage', () => {
  it('lets a manager view and run events but not team, settings or money', async () => {
    mockUser.current = attendee
    mockCtx.current = ctx(attendee, 'org1', 'manager')
    expect(await outcome(requireOrgPage('view', '/organizer/orders'))).toBe('ok')
    expect(await outcome(requireOrgPage('manage_events', '/organizer/promo-codes'))).toBe('ok')
    expect(await outcome(requireOrgPage('manage_team', '/organizer/team'))).toBe('redirect:/organizer')
    expect(await outcome(requireOrgPage('manage_settings', '/organizer/settings'))).toBe('redirect:/organizer')
    expect(await outcome(requireOrgPage('owner_only', '/organizer/finance'))).toBe('redirect:/organizer')
  })

  it('lets an org admin manage the team and settings, never money', async () => {
    mockUser.current = attendee
    mockCtx.current = ctx(attendee, 'org1', 'admin')
    expect(await outcome(requireOrgPage('manage_team', '/organizer/team'))).toBe('ok')
    expect(await outcome(requireOrgPage('manage_settings', '/organizer/settings'))).toBe('ok')
    expect(await outcome(requireOrgPage('owner_only', '/organizer/finance'))).toBe('redirect:/organizer')
  })

  it('sends a signed-out visitor to sign in, coming back to the page', async () => {
    expect(await outcome(requireOrgPage('view', '/organizer/orders'))).toBe(
      'redirect:/auth/login?redirect=%2Forganizer%2Forders',
    )
  })

  it('treats a staff-only seat as no org: the upgrade prompt for an attendee', async () => {
    mockUser.current = attendee
    mockCtx.current = ctx(attendee, 'org1', 'staff')
    expect(await getPortalOrgContext()).toBeNull()
    expect(await outcome(requireOrgPage('view', '/organizer/orders'))).toBe(
      'redirect:/organizer?redirect=%2Forganizer%2Forders',
    )
  })

  it('falls an organizer back to their own org when the cookie points at a staff seat', async () => {
    mockUser.current = organizer
    mockCtx.current = ctx(organizer, 'org1', 'staff')
    const portal = await getPortalOrgContext()
    expect(portal).toMatchObject({ orgId: 'me', role: 'owner', isOwner: true })
  })
})

describe('requireEventPage', () => {
  it("opens another org's event to its manager", async () => {
    mockUser.current = attendee
    events.e1 = { organizer_id: 'org1', title: 'Konpa' }
    mockEventRoles.org1 = 'manager'
    const access = await requireEventPage('e1', 'manage_events')
    expect(access.orgId).toBe('org1')
    expect(access.role).toBe('manager')
  })

  it('sends a manager from owner-only event pages back to the event overview', async () => {
    mockUser.current = attendee
    events.e1 = { organizer_id: 'org1' }
    mockEventRoles.org1 = 'manager'
    expect(await outcome(requireEventPage('e1', 'owner_only'))).toBe('redirect:/organizer/events/e1')
  })

  it('404s for someone with no standing on the event, and for a missing event', async () => {
    mockUser.current = attendee
    events.e1 = { organizer_id: 'org1' }
    mockEventRoles.org1 = 'staff'
    expect(await outcome(requireEventPage('e1', 'view'))).toBe('notFound')
    expect(await outcome(requireEventPage('nope', 'view'))).toBe('notFound')
  })
})
