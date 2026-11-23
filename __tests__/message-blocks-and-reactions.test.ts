/**
 * Blocked people can't message, reply or react; reactions and quoted replies.
 *
 * Covers lib/moderation/blocks isBlockedByAny, lib/messages/blockGuard (both
 * directions, the org's owner + admins speaking for it, the team member who
 * types a reply), and every write path: POST /api/events/contact-organizer,
 * POST /api/messages/[id]/reply, POST /api/organizer/messages/[id]/reply and
 * POST /api/messages/[id]/react. Plus the server-built quote on a reply and
 * the conversation view's reactions / other_id / blocked fields.
 *
 * @jest-environment node
 */

type Doc = Record<string, any>
const store = new Map<string, Doc>()
let autoId = 0
let failBlockReads = false

const INC = Symbol('inc')
function applyWrite(prev: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge && prev ? { ...prev } : {}
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && (v as any)[INC] !== undefined) {
      base[k] = (Number(prev?.[k]) || 0) + (v as any)[INC]
    } else if (v === undefined) {
      delete base[k]
    } else {
      base[k] = v
    }
  }
  return base
}

function snap(path: string) {
  const data = store.get(path)
  return { id: path.split('/').pop()!, exists: data !== undefined, data: () => data, ref: docRef(path) }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop()!,
    path,
    get: async () => {
      if (failBlockReads && path.includes('/blocked_organizers/')) throw new Error('read fault')
      return snap(path)
    },
    set: async (data: Doc, opts?: { merge?: boolean }) => {
      store.set(path, applyWrite(store.get(path), data, !!opts?.merge))
    },
    update: async (data: Doc) => {
      if (!store.has(path)) throw new Error(`no doc ${path}`)
      store.set(path, applyWrite(store.get(path), data, true))
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string, filters: Array<[string, string, any]> = [], max = Infinity): any {
  const run = () => {
    const prefix = `${path}/`
    const docs = Array.from(store.keys())
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => snap(k))
      .filter((s) => filters.every(([f, op, v]) => op !== '==' || s.data()?.[f] === v))
      .slice(0, max)
    return { empty: docs.length === 0, size: docs.length, docs }
  }
  const self: any = {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    add: async (data: Doc) => {
      const ref = docRef(`${path}/auto${++autoId}`)
      await ref.set(data)
      return ref
    },
    where: (f: string, op: string, v: any) => collectionRef(path, [...filters, [f, op, v]], max),
    orderBy: () => self,
    limit: (n: number) => collectionRef(path, filters, n),
    get: async () => run(),
  }
  return self
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ [INC]: n }),
    serverTimestamp: () => new Date('2026-11-23T12:00:00Z'),
    delete: () => undefined,
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
    batch: () => {
      const ops: Array<() => Promise<void>> = []
      return {
        update: (ref: any, data: Doc) => ops.push(() => ref.update(data)),
        set: (ref: any, data: Doc, opts?: any) => ops.push(() => ref.set(data, opts)),
        delete: (ref: any) => ops.push(() => ref.delete()),
        commit: async () => {
          for (const op of ops) await op()
        },
      }
    },
    runTransaction: async (fn: any) => {
      const writes: Array<() => Promise<void>> = []
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Doc, opts?: any) => writes.push(() => ref.set(data, opts)),
        update: (ref: any, data: Doc) => writes.push(() => ref.update(data)),
      }
      const out = await fn(tx)
      for (const w of writes) await w()
      return out
    },
  },
}))

// The org team lives at organizers/{orgId}/team/{uid} (lib/organizer/context).
jest.mock('@/lib/organizer/context', () => ({
  teamCol: (orgId: string) => collectionRef(`organizers/${orgId}/team`),
  teamRoleIn: async (orgId: string, uid: string) => {
    const d = store.get(`organizers/${orgId}/team/${uid}`)
    return d && d.status === 'active' ? d.role : null
  },
  isPlatformAdmin: (u: any) => u?.role === 'admin',
  orgDisplayName: async () => 'Konpa Org',
}))

let currentUser: any = null
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => currentUser) }))

const alerts: any[] = []
jest.mock('@/lib/organizer-message-alerts', () => ({
  alertOrganizerOfMessage: jest.fn(async (p: any) => {
    alerts.push(p)
  }),
  pushAttendeeOfReply: jest.fn(async (p: any) => {
    alerts.push(p)
  }),
  attendeeThreadPath: (id: string) => `/profile?thread=${id}`,
}))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => {}) }))
jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async () => {}),
  getOrganizerReplyEmail: () => '<p/>',
  emailSubjects: { organizerReply: () => 'subject' },
}))
jest.mock('@/lib/email-kit/recipient', () => ({ resolveEmailLang: async () => 'en' }))

import { blockOrganizer, isBlockedByAny } from '@/lib/moderation/blocks'
import { messagingRefusal, threadBlockState } from '@/lib/messages/blockGuard'
import { buildConversationView } from '@/lib/organizer-messages'
import { POST as contactOrganizer } from '@/app/api/events/contact-organizer/route'
import { POST as attendeeReply } from '@/app/api/messages/[id]/reply/route'
import { POST as organizerReply } from '@/app/api/organizer/messages/[id]/reply/route'
import { POST as react } from '@/app/api/messages/[id]/react/route'

const req = (body: unknown) =>
  new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const ATTENDEE = { id: 'att1', full_name: 'Ana', role: 'attendee' }
const OWNER = { id: 'org1', full_name: 'Owner', role: 'organizer' }
const ADMIN = { id: 'adm1', full_name: 'Ada', role: 'attendee' }
const MANAGER = { id: 'mgr1', full_name: 'Max', role: 'attendee' }
const STRANGER = { id: 'nobody', full_name: 'X', role: 'attendee' }

function seed() {
  store.set('events/e1', { organizer_id: 'org1', title: 'Konpa night', is_published: true })
  store.set('organizers/org1/team/adm1', { role: 'admin', status: 'active' })
  store.set('organizers/org1/team/mgr1', { role: 'manager', status: 'active' })
  store.set('organizers/org1/team/old1', { role: 'admin', status: 'removed' })
  store.set('organizer_messages/t1', {
    event_id: 'e1',
    event_title: 'Konpa night',
    organizer_id: 'org1',
    sender_id: 'att1',
    sender_name: 'Ana',
    topic: 'event',
    message: 'Is there parking?\nThanks',
    status: 'replied',
    reply_count: 1,
    attendee_streak: 0,
    created_at: new Date('2026-11-20T10:00:00Z'),
  })
  store.set('organizer_messages/t1/replies/r1', {
    body: 'Yes, behind the venue.',
    author_id: 'mgr1',
    author_role: 'organizer',
    author_name: 'Konpa Org',
    created_at: new Date('2026-11-20T11:00:00Z'),
  })
  // Another thread, to prove a quote can't reach across threads.
  store.set('organizer_messages/t2', { organizer_id: 'org2', sender_id: 'att9', message: 'secret', reply_count: 1 })
  store.set('organizer_messages/t2/replies/rX', { body: 'other thread', author_role: 'organizer' })
}

beforeEach(() => {
  store.clear()
  alerts.length = 0
  failBlockReads = false
  currentUser = ATTENDEE
  seed()
})

const replyDocs = () =>
  Array.from(store.keys()).filter((k) => k.startsWith('organizer_messages/t1/replies/') && k !== 'organizer_messages/t1/replies/r1')

describe('isBlockedByAny', () => {
  it('is directional and matches any of several ids', async () => {
    await blockOrganizer('org1', 'att1')
    expect(await isBlockedByAny('org1', ['att1'])).toBe(true)
    expect(await isBlockedByAny('att1', ['org1'])).toBe(false)
    expect(await isBlockedByAny('org1', ['x', 'att1'])).toBe(true)
  })

  it('ignores empty and self ids, and fails open on a read fault', async () => {
    store.set('users/u1/blocked_organizers/u1', {})
    expect(await isBlockedByAny('u1', ['u1', '', null])).toBe(false)
    await blockOrganizer('org1', 'att1')
    failBlockReads = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await isBlockedByAny('org1', ['att1'])).toBe(false)
    spy.mockRestore()
  })
})

describe('threadBlockState / messagingRefusal', () => {
  it('nothing blocked: no refusal either way', async () => {
    expect(await messagingRefusal({ side: 'attendee', orgId: 'org1', attendeeId: 'att1' })).toBeNull()
    expect(
      await messagingRefusal({ side: 'organizer', orgId: 'org1', attendeeId: 'att1', actingUserId: 'mgr1' })
    ).toBeNull()
  })

  it('the org account blocking the attendee closes the thread for both sides', async () => {
    await blockOrganizer('org1', 'att1')
    expect(await messagingRefusal({ side: 'attendee', orgId: 'org1', attendeeId: 'att1' })).toBe('blocked')
    expect(
      await messagingRefusal({ side: 'organizer', orgId: 'org1', attendeeId: 'att1', actingUserId: 'mgr1' })
    ).toBe('you_blocked')
  })

  it('an active admin speaks for the org; a removed admin or a manager does not', async () => {
    await blockOrganizer('adm1', 'att1')
    expect((await threadBlockState({ orgId: 'org1', attendeeId: 'att1' })).orgBlockedAttendee).toBe(true)

    store.delete('users/adm1/blocked_organizers/att1')
    await blockOrganizer('old1', 'att1')
    await blockOrganizer('mgr1', 'att1')
    expect((await threadBlockState({ orgId: 'org1', attendeeId: 'att1' })).orgBlockedAttendee).toBe(false)
    // ...but the manager's own block stops the manager's own replies.
    expect(
      await messagingRefusal({ side: 'organizer', orgId: 'org1', attendeeId: 'att1', actingUserId: 'mgr1' })
    ).toBe('you_blocked')
  })

  it('the attendee blocking the org (or the member typing) refuses org replies', async () => {
    await blockOrganizer('att1', 'org1')
    expect(await messagingRefusal({ side: 'attendee', orgId: 'org1', attendeeId: 'att1' })).toBe('you_blocked')
    expect(
      await messagingRefusal({ side: 'organizer', orgId: 'org1', attendeeId: 'att1', actingUserId: 'mgr1' })
    ).toBe('blocked')

    store.delete('users/att1/blocked_organizers/org1')
    await blockOrganizer('att1', 'mgr1')
    expect(await messagingRefusal({ side: 'attendee', orgId: 'org1', attendeeId: 'att1' })).toBeNull()
    expect(
      await messagingRefusal({ side: 'organizer', orgId: 'org1', attendeeId: 'att1', actingUserId: 'mgr1' })
    ).toBe('blocked')
    expect(
      await messagingRefusal({ side: 'organizer', orgId: 'org1', attendeeId: 'att1', actingUserId: 'adm1' })
    ).toBeNull()
  })
})

describe('POST /api/events/contact-organizer', () => {
  const send = () => contactOrganizer(req({ eventId: 'e1', topic: 'event', message: 'Hello' }))
  const threadCount = () => Array.from(store.keys()).filter((k) => /^organizer_messages\/[^/]+$/.test(k)).length

  it('refuses someone the org blocked, storing and alerting nothing', async () => {
    await blockOrganizer('adm1', 'att1')
    const before = threadCount()
    const res = await send()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked')
    expect(threadCount()).toBe(before)
    expect(alerts).toHaveLength(0)
  })

  it('refuses writing to an org you blocked, with its own code', async () => {
    await blockOrganizer('att1', 'org1')
    const res = await send()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('you_blocked')
  })

  it('still delivers when nobody blocked anybody', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    expect(alerts).toHaveLength(1)
  })
})

describe('POST /api/messages/[id]/reply (attendee)', () => {
  it('refuses a follow-up once the org blocked the attendee', async () => {
    await blockOrganizer('org1', 'att1')
    const res = await attendeeReply(req({ message: 'Hello?' }), params('t1'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked')
    expect(replyDocs()).toHaveLength(0)
    expect(alerts).toHaveLength(0)
  })

  it('stores a quote built from THIS thread, never from the client', async () => {
    const res = await attendeeReply(
      req({ message: 'Great', reply_to_id: 'r1', reply_to: { excerpt: 'forged' } }),
      params('t1')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reply.reply_to).toEqual({ id: 'r1', excerpt: 'Yes, behind the venue.', author_role: 'organizer' })
    const [stored] = replyDocs()
    expect(store.get(stored)?.reply_to).toEqual({ id: 'r1', excerpt: 'Yes, behind the venue.', author_role: 'organizer' })
  })

  it('quotes the opening message by its first line', async () => {
    const res = await attendeeReply(req({ message: 'Also', reply_to_id: 'opening' }), params('t1'))
    expect((await res.json()).reply.reply_to).toEqual({ id: 'opening', excerpt: 'Is there parking?', author_role: 'attendee' })
  })

  it("refuses a quote of another thread's message, or a malformed id", async () => {
    let res = await attendeeReply(req({ message: 'x', reply_to_id: 'rX' }), params('t1'))
    expect((await res.json()).code).toBe('reply_to_not_found')
    res = await attendeeReply(req({ message: 'x', reply_to_id: '../t2' }), params('t1'))
    expect((await res.json()).code).toBe('reply_to_not_found')
    expect(replyDocs()).toHaveLength(0)
  })
})

describe('POST /api/organizer/messages/[id]/reply', () => {
  it('refuses a team reply once the attendee blocked the org', async () => {
    currentUser = MANAGER
    await blockOrganizer('att1', 'org1')
    const res = await organizerReply(req({ message: 'Hi' }), params('t1'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked')
    expect(replyDocs()).toHaveLength(0)
    expect(alerts).toHaveLength(0)
  })

  it('tells the org side it blocked this person', async () => {
    currentUser = OWNER
    await blockOrganizer('adm1', 'att1')
    const res = await organizerReply(req({ message: 'Hi' }), params('t1'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('you_blocked')
  })

  it('sends with a quote when nothing is blocked', async () => {
    currentUser = ADMIN
    const res = await organizerReply(req({ message: 'Yes', reply_to_id: 'opening' }), params('t1'))
    expect(res.status).toBe(200)
    expect((await res.json()).reply.reply_to).toMatchObject({ id: 'opening', author_role: 'attendee' })
  })
})

describe('POST /api/messages/[id]/react', () => {
  const tap = (message_id: string, emoji: string) => react(req({ message_id, emoji }), params('t1'))

  it('toggles one reaction per person and returns counts, never who', async () => {
    let res = await tap('r1', '❤️')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ reactions: [{ emoji: '❤️', count: 1, mine: true }], mine: '❤️' })
    expect(store.get('organizer_messages/t1/replies/r1')?.reactions).toEqual({ att1: '❤️' })

    // A different emoji replaces it; the same again removes it.
    res = await tap('r1', '👍')
    expect((await res.json()).reactions).toEqual([{ emoji: '👍', count: 1, mine: true }])
    res = await tap('r1', '👍')
    expect(await res.json()).toMatchObject({ reactions: [], mine: null })
  })

  it("keeps the opener's reactions off the client-readable thread root", async () => {
    currentUser = ADMIN
    const res = await tap('opening', '🙏')
    expect(res.status).toBe(200)
    expect(store.get('organizer_messages/t1/reactions/opening')?.by).toEqual({ adm1: '🙏' })
    expect(store.get('organizer_messages/t1')).not.toHaveProperty('opening_reactions')
  })

  it('refuses emoji outside the allow-list and unknown messages', async () => {
    expect((await (await tap('r1', '💩')).json()).code).toBe('invalid_reaction')
    expect((await tap('nope', '❤️')).status).toBe(404)
  })

  it('refuses strangers and door staff with the same 404', async () => {
    currentUser = STRANGER
    expect((await tap('r1', '❤️')).status).toBe(404)
    store.set('organizers/org1/team/door1', { role: 'staff', status: 'active' })
    currentUser = { id: 'door1', role: 'attendee' }
    expect((await tap('r1', '❤️')).status).toBe(404)
  })

  it('a block either way stops reactions too', async () => {
    await blockOrganizer('org1', 'att1')
    let res = await tap('r1', '❤️')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked')

    currentUser = MANAGER
    res = await tap('r1', '❤️')
    expect((await res.json()).code).toBe('you_blocked')
    expect(store.get('organizer_messages/t1/replies/r1')?.reactions).toBeUndefined()
  })
})

describe('buildConversationView', () => {
  it('carries reactions (with mine), quotes, the other side and the block state', async () => {
    store.set('organizer_messages/t1/reactions/opening', { by: { mgr1: '❤️', adm1: '❤️' } })
    store.set('organizer_messages/t1/replies/r1', {
      ...store.get('organizer_messages/t1/replies/r1')!,
      reactions: { att1: '👍', junk: '💩' },
      reply_to: { id: 'opening', excerpt: 'Is there parking?', author_role: 'attendee' },
    })
    await blockOrganizer('att1', 'org1')
    const record = { id: 't1', data: store.get('organizer_messages/t1')!, role: 'attendee' as const }
    const view = await buildConversationView(record, 'att1')
    expect(view.other_id).toBe('org1')
    expect(view.messages[0].reactions).toEqual([{ emoji: '❤️', count: 2, mine: false }])
    expect(view.messages[1].reactions).toEqual([{ emoji: '👍', count: 1, mine: true }])
    expect(view.messages[1].reply_to).toEqual({ id: 'opening', excerpt: 'Is there parking?', author_role: 'attendee' })
    expect(view).toMatchObject({ blocked: true, blocked_by_viewer: true })
    // The attendee never sees which teammate wrote the reply.
    expect(view.messages[1]).not.toHaveProperty('author_id')

    const orgView = await buildConversationView({ ...record, role: 'organizer' }, 'mgr1')
    expect(orgView.other_id).toBe('att1')
    expect(orgView.messages[0].reactions).toEqual([{ emoji: '❤️', count: 2, mine: true }])
    expect(orgView).toMatchObject({ blocked: true, blocked_by_viewer: false })
  })
})
