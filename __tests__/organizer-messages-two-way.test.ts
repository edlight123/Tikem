/**
 * Two-way attendee ↔ organizer messaging.
 *
 * Runs the REAL routes and the REAL lib/organizer-messages +
 * lib/organizer-message-alerts code against an in-memory Firestore. Only the
 * outside world is faked: the session (getCurrentUser), push delivery
 * (sendPushNotification) and the mail provider (sendEmail).
 *
 * Covers: organizer alert on a new thread (in-app + push + email, in the
 * organizer's language, honouring preferences), no attendee PII in the
 * organizer email, the per-thread email rate limit, participant-only reads,
 * attendee follow-ups (same subcollection, author_role, thread reopened), the
 * caps, the attendee's own thread list and unread flag, and the organizer
 * reply now linking to the conversation.
 *
 * @jest-environment node
 */

// ── In-memory Firestore ──────────────────────────────────────────────────────
type Doc = Record<string, any>
const store = new Map<string, Doc>()
let autoId = 0
let tick = 0
const BASE = Date.now()

const INC = Symbol('inc')
const DEL = Symbol('del')
const TS = Symbol('ts')

function applyWrite(prev: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge && prev ? { ...prev } : {}
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && (v as any)[INC] !== undefined) {
      base[k] = (Number(prev?.[k]) || 0) + (v as any)[INC]
    } else if (v && typeof v === 'object' && (v as any)[DEL]) {
      delete base[k]
    } else if (v && typeof v === 'object' && (v as any)[TS]) {
      // A strictly increasing server clock, so subcollection order is stable.
      base[k] = new Date(BASE + ++tick * 1000)
    } else {
      base[k] = v
    }
  }
  return base
}

function docRef(path: string): any {
  const id = path.split('/').pop()!
  return {
    id,
    path,
    get: async () => snap(path),
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

function snap(path: string) {
  const data = store.get(path)
  return { id: path.split('/').pop()!, exists: data !== undefined, data: () => data, ref: docRef(path) }
}

const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a
  const bv = b instanceof Date ? b.getTime() : b
  return av < bv ? -1 : av > bv ? 1 : 0
}

type Filter = [string, string, any]
function collectionRef(
  path: string,
  filters: Filter[] = [],
  order: [string, 'asc' | 'desc'] | null = null,
  max = Infinity
): any {
  const run = () => {
    const prefix = `${path}/`
    let docs = Array.from(store.keys())
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => snap(k))
      .filter((s) =>
        filters.every(([f, op, v]) => {
          const val = s.data()?.[f]
          if (op === '==') return val === v
          if (op === '>=') return val !== undefined && cmp(val, v) >= 0
          throw new Error(`op ${op}`)
        })
      )
    if (order) {
      const [f, dir] = order
      docs = docs.filter((s) => s.data()?.[f] !== undefined)
      docs.sort((a, b) => cmp(a.data()![f], b.data()![f]) * (dir === 'desc' ? -1 : 1))
    }
    docs = docs.slice(0, max)
    return { empty: docs.length === 0, size: docs.length, docs }
  }
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    add: async (data: Doc) => {
      const ref = docRef(`${path}/auto${++autoId}`)
      await ref.set(data)
      return ref
    },
    where: (f: string, op: string, v: any) => collectionRef(path, [...filters, [f, op, v]], order, max),
    orderBy: (f: string, dir: 'asc' | 'desc' = 'asc') => collectionRef(path, filters, [f, dir], max),
    limit: (n: number) => collectionRef(path, filters, order, n),
    get: async () => run(),
  }
}

function batch() {
  const ops: Array<() => Promise<void>> = []
  return {
    update: (ref: any, data: Doc) => ops.push(() => ref.update(data)),
    set: (ref: any, data: Doc, opts?: any) => ops.push(() => ref.set(data, opts)),
    delete: (ref: any) => ops.push(() => ref.delete()),
    commit: async () => {
      for (const op of ops) await op()
    },
  }
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ [INC]: n }),
    serverTimestamp: () => ({ [TS]: true }),
    delete: () => ({ [DEL]: true }),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => collectionRef(name),
    batch: () => batch(),
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

let currentUser: any = null
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => currentUser) }))

const pushes: Array<{ userId: string; title: string; body: string; url?: string; data?: any }> = []
jest.mock('@/lib/notification-triggers', () => ({
  sendPushNotification: jest.fn(async (userId: string, title: string, body: string, url?: string, data?: any) => {
    pushes.push({ userId, title, body, url, data })
  }),
}))

const emails: Array<{ to: string; subject: string; html: string }> = []
jest.mock('@/lib/email', () => {
  const actual = jest.requireActual('@/lib/email')
  return {
    ...actual,
    sendEmail: jest.fn(async (p: any) => {
      emails.push(p)
      return { success: true, messageId: 'm' }
    }),
  }
})

import { POST as contactOrganizer } from '@/app/api/events/contact-organizer/route'
import { GET as listMyThreads } from '@/app/api/messages/route'
import { GET as getThread } from '@/app/api/messages/[id]/route'
import { POST as markRead } from '@/app/api/messages/[id]/read/route'
import { POST as attendeeReply } from '@/app/api/messages/[id]/reply/route'
import { POST as organizerReply } from '@/app/api/organizer/messages/[id]/reply/route'
import {
  listThreadsForOrganizer,
  MAX_ATTENDEE_STREAK,
  MAX_FOLLOWUP_LENGTH,
  MAX_REPLIES_PER_THREAD,
  ORGANIZER_EMAIL_COOLDOWN_MS,
} from '@/lib/organizer-messages'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ATTENDEE = {
  id: 'att1',
  full_name: 'Marie-Claire Joseph',
  email: 'marie.private@example.com',
  phone_number: '+50937000000',
}
const ORGANIZER = { id: 'org1', role: 'organizer', full_name: 'Kompa Nights', email: 'org@example.com' }
const STRANGER = { id: 'nobody', full_name: 'Eve', email: 'eve@example.com' }

function seed() {
  store.clear()
  pushes.length = 0
  emails.length = 0
  autoId = 0
  store.set('events/ev1', {
    title: 'Kompa Fest',
    organizer_id: 'org1',
    is_published: true,
    country: 'HT',
    banner_image_url: 'https://cdn.example.com/poster.jpg',
  })
  store.set('users/att1', { ...ATTENDEE, language: 'en' })
  store.set('users/org1', { ...ORGANIZER, language: 'fr' })
  store.set('users/nobody', { ...STRANGER })
}

const json = (body: unknown) =>
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const as = (u: any) => {
  currentUser = u
}

async function openThread(message = 'Is there parking at the venue?'): Promise<string> {
  as(ATTENDEE)
  const res = await contactOrganizer(json({ eventId: 'ev1', topic: 'event', message }))
  expect(res.status).toBe(200)
  return (await res.json()).id
}

beforeEach(seed)

// ── Organizer alert on a new thread ──────────────────────────────────────────
describe('new message alerts the organizer', () => {
  it('writes the in-app notification, pushes, and emails in the organizer language', async () => {
    const id = await openThread()

    const notes = Array.from(store.entries()).filter(([k]) => k.startsWith('users/org1/notifications/'))
    expect(notes).toHaveLength(1)
    const note = notes[0][1]
    expect(note.type).toBe('organizer_message')
    expect(note.actionUrl).toBe(`/organizer/events/ev1/messages?thread=${id}`)
    expect(note.title).toBe('Marie-Claire vous a écrit à propos de Kompa Fest')

    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatchObject({
      userId: 'org1',
      url: `/organizer/events/ev1/messages?thread=${id}`,
      data: { type: 'organizer_message', eventId: 'ev1', messageId: id },
    })

    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe('org@example.com')
    expect(emails[0].subject).toBe('Marie-Claire vous a écrit à propos de Kompa Fest')
    expect(emails[0].html).toContain('Marie-Claire')
    expect(emails[0].html).toContain('Is there parking at the venue?')
    expect(emails[0].html).toContain(`/organizer/events/ev1/messages?thread=${id}`)
    expect(emails[0].html).toContain("L&#39;événement") // topic, French
  })

  it('never puts the attendee email, phone or surname in the organizer email', async () => {
    await openThread()
    const { html, subject } = emails[0]
    for (const leak of [ATTENDEE.email, ATTENDEE.phone_number, 'Joseph']) {
      expect(html).not.toContain(leak)
      expect(subject).not.toContain(leak)
    }
    // Nor anywhere on the stored thread.
    const thread = Array.from(store.entries()).find(([k]) => /^organizer_messages\/[^/]+$/.test(k))![1]
    expect(JSON.stringify(thread)).not.toContain(ATTENDEE.email)
    expect(JSON.stringify(thread)).not.toContain(ATTENDEE.phone_number)
  })

  it('honours the organizer push and email preferences', async () => {
    store.set('organizers/org1/notificationPreferences/main', {
      push_attendee_messages: false,
      email_attendee_messages: false,
    })
    await openThread()
    expect(pushes).toHaveLength(0)
    expect(emails).toHaveLength(0)
    // The in-app notification is not a preference: it is the inbox's own badge.
    expect(Array.from(store.keys()).filter((k) => k.startsWith('users/org1/notifications/'))).toHaveLength(1)
  })
})

// ── Participant-only reads ───────────────────────────────────────────────────
describe('GET /api/messages/[id] is for the two participants only', () => {
  it('401 signed out, 404 for a stranger and for a missing id', async () => {
    const id = await openThread()
    as(null)
    expect((await getThread(new Request('http://x'), ctx(id))).status).toBe(401)
    as(STRANGER)
    const res = await getThread(new Request('http://x'), ctx(id))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('thread_not_found')
    as(ATTENDEE)
    expect((await getThread(new Request('http://x'), ctx('does-not-exist'))).status).toBe(404)
  })

  it('a stranger cannot mark a thread read or post into it', async () => {
    const id = await openThread()
    as(STRANGER)
    expect((await markRead(new Request('http://x'), ctx(id))).status).toBe(404)
    expect((await attendeeReply(json({ message: 'hi' }), ctx(id))).status).toBe(404)
  })

  it('both participants see the whole conversation in order, each with their role', async () => {
    const id = await openThread()
    as(ORGANIZER)
    expect((await organizerReply(json({ message: 'Yes, free parking.' }), ctx(id))).status).toBe(200)
    as(ATTENDEE)
    expect((await attendeeReply(json({ message: 'Great, thanks!' }), ctx(id))).status).toBe(200)

    const mine = await (await getThread(new Request('http://x'), ctx(id))).json()
    expect(mine.thread.viewer_role).toBe('attendee')
    expect(mine.thread.messages.map((m: any) => [m.author_role, m.body])).toEqual([
      ['attendee', 'Is there parking at the venue?'],
      ['organizer', 'Yes, free parking.'],
      ['attendee', 'Great, thanks!'],
    ])
    expect(mine.thread.event_poster).toBe('https://cdn.example.com/poster.jpg')
    expect(mine.thread.organizer_name).toBe('Kompa Nights')
    expect(JSON.stringify(mine)).not.toContain(ATTENDEE.email)

    as(ORGANIZER)
    const theirs = await (await getThread(new Request('http://x'), ctx(id))).json()
    expect(theirs.thread.viewer_role).toBe('organizer')
    expect(theirs.thread.messages).toHaveLength(3)
    expect(JSON.stringify(theirs)).not.toContain(ATTENDEE.email)
    expect(JSON.stringify(theirs)).not.toContain(ATTENDEE.phone_number)
  })
})

// ── Attendee follow-ups ──────────────────────────────────────────────────────
describe('POST /api/messages/[id]/reply (attendee follow-up)', () => {
  it('stores the follow-up in the replies subcollection and reopens the thread for the organizer', async () => {
    const id = await openThread()
    as(ORGANIZER)
    await organizerReply(json({ message: 'Yes.' }), ctx(id))
    expect(store.get(`organizer_messages/${id}`)!.status).toBe('replied')
    expect(store.get(`organizer_messages/${id}`)!.organizer_read_at).toBeDefined()

    as(ATTENDEE)
    const res = await attendeeReply(json({ message: '  And is it covered?  ' }), ctx(id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reply).toMatchObject({ author_role: 'attendee', body: 'And is it covered?' })

    const replyDocs = Array.from(store.entries()).filter(([k]) => k.startsWith(`organizer_messages/${id}/replies/`))
    expect(replyDocs.map(([, d]) => d.author_role).sort()).toEqual(['attendee', 'organizer'])
    expect(replyDocs.find(([, d]) => d.author_role === 'attendee')![1].author_id).toBe('att1')

    const root = store.get(`organizer_messages/${id}`)!
    expect(root.status).toBe('open')
    expect(root.organizer_read_at).toBeUndefined()
    expect(root.reply_count).toBe(2)
    expect(root.last_message_role).toBe('attendee')

    // The organizer inbox shows it in order, as unread and needing a reply.
    const [thread] = await listThreadsForOrganizer({ organizerId: 'org1', eventId: 'ev1' })
    expect(thread.unread).toBe(true)
    expect(thread.needs_reply).toBe(true)
    expect(thread.replies.map((r) => r.author_role)).toEqual(['organizer', 'attendee'])
  })

  it('the organizer cannot use the attendee route', async () => {
    const id = await openThread()
    as(ORGANIZER)
    const res = await attendeeReply(json({ message: 'hi' }), ctx(id))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('organizer_use_inbox')
  })

  it('validates the body', async () => {
    const id = await openThread()
    as(ATTENDEE)
    expect((await attendeeReply(json({ message: '   ' }), ctx(id))).status).toBe(400)
    const long = await attendeeReply(json({ message: 'x'.repeat(MAX_FOLLOWUP_LENGTH + 1) }), ctx(id))
    expect(long.status).toBe(400)
    expect((await long.json()).code).toBe('message_too_long')
    as(null)
    expect((await attendeeReply(json({ message: 'hi' }), ctx(id))).status).toBe(401)
  })

  it('caps attendee messages in a row until the organizer answers', async () => {
    const id = await openThread()
    as(ATTENDEE)
    // The opener counts as one.
    for (let i = 1; i < MAX_ATTENDEE_STREAK; i++) {
      expect((await attendeeReply(json({ message: `ping ${i}` }), ctx(id))).status).toBe(200)
    }
    const blocked = await attendeeReply(json({ message: 'one more' }), ctx(id))
    expect(blocked.status).toBe(429)
    expect((await blocked.json()).code).toBe('awaiting_reply')

    as(ORGANIZER)
    await organizerReply(json({ message: 'Here!' }), ctx(id))
    as(ATTENDEE)
    expect((await attendeeReply(json({ message: 'thanks' }), ctx(id))).status).toBe(200)
  })

  it('caps the thread at MAX_REPLIES_PER_THREAD messages', async () => {
    const id = await openThread()
    store.set(`organizer_messages/${id}`, {
      ...store.get(`organizer_messages/${id}`)!,
      reply_count: MAX_REPLIES_PER_THREAD,
      attendee_streak: 0,
    })
    as(ATTENDEE)
    const res = await attendeeReply(json({ message: 'hello?' }), ctx(id))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('thread_reply_limit')

    const view = await (await getThread(new Request('http://x'), ctx(id))).json()
    expect(view.thread.closed).toBe(true)
  })

  it('treats a legacy thread (no streak field) as one attendee message', async () => {
    store.set('organizer_messages/legacy', {
      event_id: 'ev1',
      event_title: 'Kompa Fest',
      organizer_id: 'org1',
      sender_id: 'att1',
      sender_name: 'Marie-Claire Joseph',
      topic: 'ticket',
      message: 'Old question',
      status: 'open',
      created_at: new Date(BASE - 60_000),
    })
    as(ATTENDEE)
    expect((await attendeeReply(json({ message: 'Following up' }), ctx('legacy'))).status).toBe(200)
    expect(store.get('organizer_messages/legacy')!.attendee_streak).toBe(2)
  })
})

// ── Email rate limit ─────────────────────────────────────────────────────────
describe('organizer email rate limit (one per thread per 30 minutes)', () => {
  it('pushes every follow-up but emails once per window', async () => {
    const id = await openThread()
    expect(emails).toHaveLength(1)
    expect(pushes).toHaveLength(1)

    as(ATTENDEE)
    await attendeeReply(json({ message: 'one' }), ctx(id))
    await attendeeReply(json({ message: 'two' }), ctx(id))
    expect(pushes).toHaveLength(3)
    expect(emails).toHaveLength(1)
    // Every follow-up still lands in the bell.
    expect(Array.from(store.keys()).filter((k) => k.startsWith('users/org1/notifications/'))).toHaveLength(3)
    expect(pushes[2].title).toBe('Marie-Claire vous a réécrit à propos de Kompa Fest')

    // Once the window has passed, the next follow-up emails again.
    const root = store.get(`organizer_messages/${id}`)!
    store.set(`organizer_messages/${id}`, {
      ...root,
      organizer_email_last_at: new Date(Date.now() - ORGANIZER_EMAIL_COOLDOWN_MS - 1000),
    })
    await attendeeReply(json({ message: 'three' }), ctx(id))
    expect(emails).toHaveLength(2)
    expect(emails[1].subject).toBe('Marie-Claire vous a réécrit à propos de Kompa Fest')
    expect(emails[1].html).toContain('three')
  })

  it('limits per thread, not per organizer: a second thread emails right away', async () => {
    await openThread('first question')
    await openThread('second question')
    expect(emails).toHaveLength(2)
  })
})

// ── The attendee's own list ──────────────────────────────────────────────────
describe('GET /api/messages (attendee threads)', () => {
  it('lists only my threads, with an unread dot after an organizer reply that read clears', async () => {
    const id = await openThread()
    store.set('organizer_messages/someone-else', {
      event_id: 'ev1',
      organizer_id: 'org1',
      sender_id: 'nobody',
      message: 'not yours',
      created_at: new Date(BASE),
    })

    as(ATTENDEE)
    let res = await (await listMyThreads()).json()
    expect(res.threads.map((t: any) => t.id)).toEqual([id])
    expect(res.threads[0]).toMatchObject({
      event_title: 'Kompa Fest',
      event_poster: 'https://cdn.example.com/poster.jpg',
      unread: false,
      last_message_role: 'attendee',
    })

    as(ORGANIZER)
    await organizerReply(json({ message: 'See you there' }), ctx(id))

    as(ATTENDEE)
    res = await (await listMyThreads()).json()
    expect(res.unreadCount).toBe(1)
    expect(res.threads[0]).toMatchObject({
      unread: true,
      last_message_role: 'organizer',
      last_message_preview: 'See you there',
      organizer_name: 'Kompa Nights',
    })

    expect((await markRead(new Request('http://x'), ctx(id))).status).toBe(200)
    res = await (await listMyThreads()).json()
    expect(res.threads[0].unread).toBe(false)
  })

  it('401 when signed out', async () => {
    as(null)
    expect((await listMyThreads()).status).toBe(401)
  })
})

// ── Organizer reply now opens the conversation ───────────────────────────────
describe('organizer reply links the attendee to the thread', () => {
  it('in-app link, push deep link and email button all open the conversation', async () => {
    const id = await openThread()
    pushes.length = 0
    emails.length = 0
    as(ORGANIZER)
    await organizerReply(json({ message: 'Doors at 8.' }), ctx(id))

    const note = Array.from(store.entries()).find(
      ([k, d]) => k.startsWith('users/att1/notifications/') && d.type === 'organizer_reply'
    )![1]
    expect(note.actionUrl).toBe(`/profile?thread=${id}#messages`)
    expect(note.metadata.messageId).toBe(id)

    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatchObject({
      userId: 'att1',
      url: `/profile?thread=${id}#messages`,
      data: { type: 'organizer_reply', deepLink: `tikem://messages/${id}` },
    })

    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe(ATTENDEE.email)
    expect(emails[0].html).toContain(`/profile?thread=${id}#messages`)
  })

  it('skips the attendee push when they turned message notifications off', async () => {
    const id = await openThread()
    store.set('users/att1', { ...store.get('users/att1')!, notify_messages: false })
    pushes.length = 0
    as(ORGANIZER)
    await organizerReply(json({ message: 'ok' }), ctx(id))
    expect(pushes).toHaveLength(0)
  })
})
