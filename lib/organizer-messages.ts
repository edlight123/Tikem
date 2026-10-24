/**
 * Attendee ↔ organizer message threads (SERVER-SIDE ONLY).
 *
 * DATA MODEL
 * ----------
 * A thread IS the attendee's opening message: the `organizer_messages/{id}`
 * document written by /api/events/contact-organizer. Every later message, from
 * either side, lives in a `organizer_messages/{id}/replies/{replyId}`
 * SUBCOLLECTION.
 *
 * Why a subcollection rather than a flat `organizer_message_replies` collection
 * carrying a `thread_id`:
 *
 *  1. The thread root already exists and already has an id in the wild — the
 *     notification created on first contact deep-links with `messageId`. A flat
 *     collection would need a second id space (or a synthetic thread doc) for
 *     no gain.
 *  2. Authorization can't drift. Who may read or reply is decided by exactly
 *     one document (the parent's `organizer_id` / `sender_id`). With a flat
 *     collection every reply repeats that claim in its own `thread_id`, and a
 *     forged value is a real attack surface.
 *  3. Firestore rules stay untouched. The existing `organizer_messages/{id}`
 *     match scopes reads to the two participants; the subcollection is NOT
 *     covered by that match, so it falls through to the catch-all
 *     `match /{document=**} { allow read, write: if false }`. Replies are
 *     therefore server-only by default — no new rule, no client write path.
 *  4. Lifecycle is free: deleting a thread recursively takes its replies with
 *     it, so there is no orphan sweep to write later.
 *
 * The cost of a subcollection is that you cannot read every reply of every
 * thread in one query. That is fine here: a thread is bounded to
 * MAX_REPLIES_PER_THREAD and an organizer inbox page is bounded to
 * MAX_THREADS_PER_PAGE, so a page load is a bounded fan-out of small reads.
 * Hot list fields (`reply_count`, `last_reply_preview`, `last_reply_at`) are
 * denormalized onto the root so a preview never needs the subcollection.
 *
 * TWO-WAY THREADS (2026-10-24)
 * ----------------------------
 * The attendee can now answer back. A follow-up is a doc in the SAME `replies`
 * subcollection with `author_role: 'attendee'`; organizer replies carry
 * `author_role: 'organizer'` (every reply written before this change already
 * did). One ordered subcollection keeps the conversation in order for both
 * sides with no merge step, and `reply_count` / MAX_REPLIES_PER_THREAD now
 * count every message after the opener, whoever wrote it.
 *
 * Root fields added for the two-way flow (all optional; legacy docs read with
 * defaults):
 *  - `status`: 'open' = the attendee spoke last and is waiting on the
 *    organizer; 'replied' = the organizer answered last. A follow-up reopens it.
 *  - `organizer_read_at`: DELETED by a follow-up, so the organizer's unread dot
 *    comes back for the new message.
 *  - `attendee_unread`: true after an organizer reply until the attendee opens
 *    the thread.
 *  - `attendee_streak`: attendee messages since the organizer last spoke (the
 *    opener counts as 1). Capped at MAX_ATTENDEE_STREAK.
 *  - `last_message_preview` / `last_message_at` / `last_message_role`: the
 *    newest message from either side, for list previews.
 *  - `organizer_name`: the organizer's display name, snapshotted on reply.
 *  - `organizer_email_last_at`: when the organizer was last EMAILED about this
 *    thread; see claimOrganizerEmailSlot.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'

export const COLLECTION = 'organizer_messages'
export const REPLIES_SUBCOLLECTION = 'replies'

/**
 * Replies are longer than the attendee's 1000-char opener — an organizer
 * answering "is this real?" may need to explain the venue, the refund policy
 * and the door time — but still capped so one reply can't become a payload.
 */
export const MAX_REPLY_LENGTH = 2000
/** Same ceiling as the attendee's opening message (contact-organizer route). */
export const MAX_FOLLOWUP_LENGTH = 1000
/** A trust conversation, not a chat room. Keeps thread reads bounded. */
export const MAX_REPLIES_PER_THREAD = 30
/**
 * Attendee messages in a row without an organizer answer (the opener counts).
 * Stops one side from spending the whole thread cap talking to itself.
 */
export const MAX_ATTENDEE_STREAK = 5
/** At most one "new message" EMAIL to the organizer per thread per window. */
export const ORGANIZER_EMAIL_COOLDOWN_MS = 30 * 60 * 1000
/** Ceiling on one inbox page, so a busy event can't fan out unbounded reads. */
export const MAX_THREADS_PER_PAGE = 100
export const DEFAULT_THREADS_PER_PAGE = 30
/** Ceiling on the attendee's own thread list. */
export const MAX_ATTENDEE_THREADS = 50
/** Characters of the latest message kept on the root doc for list previews. */
const PREVIEW_LENGTH = 160

export type ThreadStatus = 'open' | 'replied'
export type AuthorRole = 'attendee' | 'organizer'
export type ParticipantRole = AuthorRole

export interface OrganizerMessageReply {
  id: string
  body: string
  author_role: AuthorRole
  author_name: string
  created_at: string | null
}

export interface OrganizerMessageThread {
  id: string
  event_id: string
  event_title: string
  sender_name: string
  topic: string
  /** The attendee's opening message. */
  message: string
  status: ThreadStatus
  /** The attendee spoke last and is waiting on the organizer. */
  needs_reply: boolean
  created_at: string | null
  last_activity_at: string | null
  reply_count: number
  /** True until the organizer opens (or replies to) the newest attendee message. */
  unread: boolean
  /** Organizer replies AND attendee follow-ups, oldest first. */
  replies: OrganizerMessageReply[]
}

function toIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  const maybe = value as { toDate?: () => Date }
  if (typeof maybe.toDate === 'function') return maybe.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

/**
 * An organizer has not seen a thread until they open or answer it. A follow-up
 * from the attendee DELETES `organizer_read_at`, so "unread" stays one field
 * rather than a per-message cursor: unread means "the newest attendee message
 * has not been acknowledged". Legacy documents written before read tracking
 * existed correctly read as unread rather than vanishing from the badge.
 */
function isUnread(data: Record<string, any>): boolean {
  return !data.organizer_read_at
}

function mapReply(doc: QueryDocumentSnapshot): OrganizerMessageReply {
  const d = doc.data()
  // Every reply written before follow-ups existed is an organizer reply and
  // already carries the field; default the same way for safety.
  const role: AuthorRole = d.author_role === 'attendee' ? 'attendee' : 'organizer'
  return {
    id: doc.id,
    body: String(d.body || ''),
    author_role: role,
    author_name: String(d.author_name || (role === 'attendee' ? 'An attendee' : 'The organizer')),
    created_at: toIso(d.created_at),
  }
}

async function loadReplies(threadId: string): Promise<OrganizerMessageReply[]> {
  const snap = await adminDb
    .collection(COLLECTION)
    .doc(threadId)
    .collection(REPLIES_SUBCOLLECTION)
    .orderBy('created_at', 'asc')
    .limit(MAX_REPLIES_PER_THREAD)
    .get()
  return snap.docs.map((d: QueryDocumentSnapshot) => mapReply(d))
}

function mapThread(
  id: string,
  data: Record<string, any>,
  replies: OrganizerMessageReply[]
): OrganizerMessageThread {
  const createdAt = toIso(data.created_at)
  return {
    id,
    event_id: String(data.event_id || ''),
    event_title: String(data.event_title || 'Event'),
    sender_name: String(data.sender_name || 'An attendee'),
    topic: String(data.topic || 'other'),
    message: String(data.message || ''),
    status: data.status === 'replied' ? 'replied' : 'open',
    needs_reply: data.status !== 'replied',
    created_at: createdAt,
    last_activity_at: toIso(data.last_activity_at) ?? toIso(data.last_reply_at) ?? createdAt,
    reply_count: typeof data.reply_count === 'number' ? data.reply_count : replies.length,
    unread: isUnread(data),
    replies,
  }
}

/**
 * Every thread addressed to `organizerId`, newest first, optionally narrowed to
 * one event.
 *
 * Ordered on `created_at` because that is the one timestamp every document is
 * guaranteed to carry — ordering on `last_activity_at` would silently drop the
 * threads written before this feature shipped, since Firestore excludes
 * documents missing the sort field. The page is then re-sorted in memory by
 * last activity so an old thread with a fresh reply floats to the top of what
 * was fetched.
 */
export async function listThreadsForOrganizer(options: {
  organizerId: string
  eventId?: string
  limit?: number
}): Promise<OrganizerMessageThread[]> {
  const limit = Math.min(
    Math.max(1, options.limit || DEFAULT_THREADS_PER_PAGE),
    MAX_THREADS_PER_PAGE
  )

  let query = adminDb
    .collection(COLLECTION)
    .where('organizer_id', '==', options.organizerId)
  if (options.eventId) {
    query = query.where('event_id', '==', options.eventId)
  }

  const snap = await query.orderBy('created_at', 'desc').limit(limit).get()

  const threads = await Promise.all(
    snap.docs.map(async (doc: QueryDocumentSnapshot) => {
      const data = doc.data()
      const replies =
        (typeof data.reply_count === 'number' ? data.reply_count : 0) > 0
          ? await loadReplies(doc.id)
          : []
      return mapThread(doc.id, data, replies)
    })
  )

  return threads.sort((a, b) => {
    const at = a.last_activity_at ? Date.parse(a.last_activity_at) : 0
    const bt = b.last_activity_at ? Date.parse(b.last_activity_at) : 0
    return bt - at
  })
}

export interface ThreadRecord {
  id: string
  data: Record<string, any>
}

/**
 * Load a thread only if `organizerId` owns it.
 *
 * Returns null both when the thread is missing and when it belongs to somebody
 * else — callers surface a single "not found" for both so the endpoint can't be
 * used to probe which message ids exist.
 */
export async function getThreadForOrganizer(
  threadId: string,
  organizerId: string
): Promise<ThreadRecord | null> {
  const snap = await adminDb.collection(COLLECTION).doc(threadId).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  if (String(data.organizer_id || '') !== organizerId) return null
  return { id: snap.id, data }
}

/**
 * Load a thread only if `userId` is one of its two participants: the attendee
 * who opened it (`sender_id`) or the organizer it is addressed to
 * (`organizer_id`). Anyone else gets null, the same as a missing thread.
 */
export async function getThreadForParticipant(
  threadId: string,
  userId: string
): Promise<(ThreadRecord & { role: ParticipantRole }) | null> {
  if (!threadId || !userId) return null
  const snap = await adminDb.collection(COLLECTION).doc(threadId).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  if (String(data.sender_id || '') === userId) return { id: snap.id, data, role: 'attendee' }
  if (String(data.organizer_id || '') === userId) return { id: snap.id, data, role: 'organizer' }
  return null
}

/** Acknowledge a thread. Idempotent: the first acknowledgement is the one kept. */
export async function markThreadRead(threadId: string, alreadyRead: boolean): Promise<void> {
  if (alreadyRead) return
  await adminDb.collection(COLLECTION).doc(threadId).update({
    organizer_read_at: FieldValue.serverTimestamp(),
  })
}

/** The attendee opened the thread: clear their unread dot. Idempotent. */
export async function markThreadReadByAttendee(
  threadId: string,
  data: Record<string, any>
): Promise<void> {
  if (data.attendee_unread !== true) return
  await adminDb.collection(COLLECTION).doc(threadId).update({
    attendee_unread: false,
    attendee_read_at: FieldValue.serverTimestamp(),
  })
}

function attendeeStreak(data: Record<string, any>): number {
  if (typeof data.attendee_streak === 'number') return data.attendee_streak
  // Legacy threads: the opener is one attendee message; an answered thread has
  // a streak of zero.
  return data.status === 'replied' ? 0 : 1
}

async function eventPoster(eventId: string): Promise<string | null> {
  if (!eventId) return null
  try {
    const snap = await adminDb.collection('events').doc(eventId).get()
    const url = String((snap.exists && (snap.data() as any)?.banner_image_url) || '').trim()
    return url || null
  } catch {
    return null
  }
}

/** One message of a conversation as either participant sees it. */
export type ConversationMessage = OrganizerMessageReply

export interface ConversationView {
  id: string
  event_id: string
  event_title: string
  event_poster: string | null
  topic: string
  /** Which side the viewer is on, so the client can put "mine" on the right. */
  viewer_role: ParticipantRole
  /** The attendee's display name as they gave it. Never their email or phone. */
  attendee_name: string
  organizer_name: string
  needs_reply: boolean
  reply_count: number
  /** No more messages fit: MAX_REPLIES_PER_THREAD reached. */
  closed: boolean
  /** The attendee has sent MAX_ATTENDEE_STREAK in a row and must wait. */
  awaiting_organizer: boolean
  /** Opening message first, then every reply in order. */
  messages: ConversationMessage[]
}

/** The full conversation for one of its participants. */
export async function buildConversationView(
  record: ThreadRecord & { role: ParticipantRole }
): Promise<ConversationView> {
  const { data } = record
  const replyCount = typeof data.reply_count === 'number' ? data.reply_count : 0
  const [replies, poster] = await Promise.all([
    replyCount > 0 ? loadReplies(record.id) : Promise.resolve([] as OrganizerMessageReply[]),
    eventPoster(String(data.event_id || '')),
  ])
  const attendeeName = String(data.sender_name || 'An attendee')
  const organizerName =
    String(data.organizer_name || '').trim() ||
    [...replies].reverse().find((r) => r.author_role === 'organizer')?.author_name ||
    ''
  const opener: ConversationMessage = {
    id: 'opening',
    body: String(data.message || ''),
    author_role: 'attendee',
    author_name: attendeeName,
    created_at: toIso(data.created_at),
  }
  return {
    id: record.id,
    event_id: String(data.event_id || ''),
    event_title: String(data.event_title || 'Event'),
    event_poster: poster,
    topic: String(data.topic || 'other'),
    viewer_role: record.role,
    attendee_name: attendeeName,
    organizer_name: organizerName,
    needs_reply: data.status !== 'replied',
    reply_count: replyCount,
    closed: replyCount >= MAX_REPLIES_PER_THREAD,
    awaiting_organizer: attendeeStreak(data) >= MAX_ATTENDEE_STREAK,
    messages: [opener, ...replies],
  }
}

/** A row of the attendee's own Messages list. */
export interface AttendeeThreadSummary {
  id: string
  event_id: string
  event_title: string
  event_poster: string | null
  organizer_name: string
  topic: string
  last_message_preview: string
  last_message_role: AuthorRole
  last_activity_at: string | null
  /** The organizer has said something the attendee has not opened yet. */
  unread: boolean
}

function summarizeForAttendee(
  id: string,
  data: Record<string, any>,
  poster: string | null
): AttendeeThreadSummary {
  const createdAt = toIso(data.created_at)
  const replyCount = typeof data.reply_count === 'number' ? data.reply_count : 0
  const lastRole: AuthorRole =
    data.last_message_role === 'organizer' || data.last_message_role === 'attendee'
      ? data.last_message_role
      : // Legacy: only organizer replies existed after the opener.
        replyCount > 0
        ? 'organizer'
        : 'attendee'
  const lastPreview =
    String(data.last_message_preview || '') ||
    (lastRole === 'organizer' ? String(data.last_reply_preview || '') : '') ||
    preview(String(data.message || ''))
  return {
    id,
    event_id: String(data.event_id || ''),
    event_title: String(data.event_title || 'Event'),
    event_poster: poster,
    organizer_name: String(data.organizer_name || ''),
    topic: String(data.topic || 'other'),
    last_message_preview: lastPreview,
    last_message_role: lastRole,
    last_activity_at:
      toIso(data.last_message_at) ??
      toIso(data.last_activity_at) ??
      toIso(data.last_reply_at) ??
      createdAt,
    unread: data.attendee_unread === true,
  }
}

function isMissingIndex(error: any): boolean {
  const code = error?.code
  return code === 9 || code === 'failed-precondition' || /FAILED_PRECONDITION|requires an index/i.test(String(error?.message || ''))
}

/**
 * Every thread the attendee opened, most recent activity first.
 *
 * Ordered on `created_at` server-side (composite index sender_id + created_at
 * desc in firestore.indexes.json). If that index has not been deployed yet the
 * query fails with FAILED_PRECONDITION; rather than break the screen, fall
 * back to the single-field equality query (auto-indexed) and sort in memory.
 */
export async function listThreadsForAttendee(userId: string): Promise<AttendeeThreadSummary[]> {
  const base = adminDb.collection(COLLECTION).where('sender_id', '==', userId)
  let docs: QueryDocumentSnapshot[]
  try {
    const snap = await base.orderBy('created_at', 'desc').limit(MAX_ATTENDEE_THREADS).get()
    docs = snap.docs
  } catch (error) {
    if (!isMissingIndex(error)) throw error
    console.warn('organizer-messages: sender_id+created_at index missing, sorting in memory')
    const snap = await base.limit(MAX_ATTENDEE_THREADS * 2).get()
    docs = snap.docs
  }

  const eventIds = Array.from(
    new Set(docs.map((d) => String(d.data().event_id || '')).filter(Boolean))
  )
  const posters = new Map<string, string | null>()
  await Promise.all(eventIds.map(async (id) => posters.set(id, await eventPoster(id))))

  return docs
    .map((d) =>
      summarizeForAttendee(d.id, d.data(), posters.get(String(d.data().event_id || '')) ?? null)
    )
    .sort((a, b) => {
      const at = a.last_activity_at ? Date.parse(a.last_activity_at) : 0
      const bt = b.last_activity_at ? Date.parse(b.last_activity_at) : 0
      return bt - at
    })
    .slice(0, MAX_ATTENDEE_THREADS)
}

export type FollowUpRefusal = 'thread_not_found' | 'thread_reply_limit' | 'awaiting_reply'

export type FollowUpResult =
  | { ok: true; reply: OrganizerMessageReply; thread: Record<string, any> }
  | { ok: false; code: FollowUpRefusal }

/**
 * Append the attendee's follow-up to their own thread.
 *
 * Runs in a transaction so the two caps (thread total, attendee streak) are
 * checked against the same snapshot the write lands on: two quick taps can't
 * both slip under a limit. Deletes `organizer_read_at` and reopens the thread
 * so the organizer's inbox marks it as needing a reply.
 */
export async function appendAttendeeFollowUp(params: {
  threadId: string
  attendeeId: string
  authorName: string
  body: string
}): Promise<FollowUpResult> {
  const threadRef = adminDb.collection(COLLECTION).doc(params.threadId)
  const replyRef = threadRef.collection(REPLIES_SUBCOLLECTION).doc()

  return adminDb.runTransaction(async (tx: any): Promise<FollowUpResult> => {
    const snap = await tx.get(threadRef)
    if (!snap.exists) return { ok: false, code: 'thread_not_found' }
    const data = snap.data() || {}
    if (String(data.sender_id || '') !== params.attendeeId) {
      return { ok: false, code: 'thread_not_found' }
    }
    const replyCount = typeof data.reply_count === 'number' ? data.reply_count : 0
    if (replyCount >= MAX_REPLIES_PER_THREAD) return { ok: false, code: 'thread_reply_limit' }
    const streak = attendeeStreak(data)
    if (streak >= MAX_ATTENDEE_STREAK) return { ok: false, code: 'awaiting_reply' }

    tx.set(replyRef, {
      body: params.body,
      author_id: params.attendeeId,
      author_role: 'attendee',
      author_name: params.authorName,
      created_at: FieldValue.serverTimestamp(),
    })
    tx.update(threadRef, {
      status: 'open',
      reply_count: FieldValue.increment(1),
      attendee_streak: streak + 1,
      organizer_read_at: FieldValue.delete(),
      last_message_preview: preview(params.body),
      last_message_role: 'attendee',
      last_message_at: FieldValue.serverTimestamp(),
      last_activity_at: FieldValue.serverTimestamp(),
    })
    return {
      ok: true,
      thread: data,
      reply: {
        id: replyRef.id,
        body: params.body,
        author_role: 'attendee',
        author_name: params.authorName,
        created_at: new Date().toISOString(),
      },
    }
  })
}

/**
 * Claim the right to EMAIL the organizer about this thread now.
 *
 * True at most once per ORGANIZER_EMAIL_COOLDOWN_MS per thread. The claim is
 * recorded in the same transaction, BEFORE the email is sent: a chatty
 * attendee firing five follow-ups in a minute produces one email (and five
 * pushes). If the send then fails, that one email is lost; that is the right
 * side to fail on for an alert that also arrives as a push and in the app.
 */
export async function claimOrganizerEmailSlot(
  threadId: string,
  now: Date = new Date()
): Promise<boolean> {
  const threadRef = adminDb.collection(COLLECTION).doc(threadId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(threadRef)
    if (!snap.exists) return false
    const last = toIso((snap.data() || {}).organizer_email_last_at)
    if (last && now.getTime() - Date.parse(last) < ORGANIZER_EMAIL_COOLDOWN_MS) return false
    tx.update(threadRef, { organizer_email_last_at: now })
    return true
  })
}

/**
 * Append an organizer reply and roll the thread's denormalized summary forward.
 * Replying implies reading, so it also clears the unread flag.
 */
export async function appendOrganizerReply(params: {
  threadId: string
  organizerId: string
  authorName: string
  body: string
  alreadyRead: boolean
}): Promise<OrganizerMessageReply> {
  const threadRef = adminDb.collection(COLLECTION).doc(params.threadId)
  const replyRef = threadRef.collection(REPLIES_SUBCOLLECTION).doc()

  const batch = adminDb.batch()
  batch.set(replyRef, {
    body: params.body,
    author_id: params.organizerId,
    author_role: 'organizer',
    author_name: params.authorName,
    created_at: FieldValue.serverTimestamp(),
  })
  batch.update(threadRef, {
    status: 'replied',
    reply_count: FieldValue.increment(1),
    last_reply_preview: preview(params.body),
    last_reply_at: FieldValue.serverTimestamp(),
    last_message_preview: preview(params.body),
    last_message_role: 'organizer',
    last_message_at: FieldValue.serverTimestamp(),
    last_activity_at: FieldValue.serverTimestamp(),
    organizer_name: params.authorName,
    // The organizer answered: the attendee has something new to read, and may
    // write again (up to MAX_ATTENDEE_STREAK times).
    attendee_unread: true,
    attendee_streak: 0,
    ...(params.alreadyRead ? {} : { organizer_read_at: FieldValue.serverTimestamp() }),
  })
  await batch.commit()

  // The write above uses server timestamps, so the authoritative created_at is
  // only knowable after a read. Echo the client's own clock instead of paying
  // for that read — the list endpoint returns the real value next load.
  return {
    id: replyRef.id,
    body: params.body,
    author_role: 'organizer',
    author_name: params.authorName,
    created_at: new Date().toISOString(),
  }
}

export function countUnread(threads: OrganizerMessageThread[]): number {
  return threads.filter((t) => t.unread).length
}
