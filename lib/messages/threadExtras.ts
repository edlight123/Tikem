/**
 * Reactions and quoted replies on attendee ↔ organizer messages: the PURE
 * validation and shaping helpers (no Firestore), so they can be unit tested
 * and shared by lib/organizer-messages.ts and the message routes.
 *
 * STORAGE (every write is server-only, through the routes):
 *  - Reactions on a reply: `reactions` on the reply doc
 *    (organizer_messages/{id}/replies/{replyId}, a server-only subcollection).
 *  - Reactions on the opening message: `by` on
 *    organizer_messages/{id}/reactions/opening. NOT on the thread root: the
 *    root is client-readable by both participants (firestore.rules), and the
 *    map's keys are uids, so a team member's reaction would tell the attendee
 *    which person on the team reacted. Externally the org answers, never a
 *    person (lib/organizer-messages.ts).
 *  Both are a map `{ [userId]: emoji }`: one reaction per person per message.
 *  The raw map never leaves the server; viewers get counts plus "mine".
 *  - A reply that quotes another message carries
 *    `reply_to: { id, excerpt, author_role }`, built SERVER-SIDE from the
 *    quoted message (the client only names the id), so the excerpt can't be
 *    forged and never carries a name, email or phone.
 */

/** The only reactions offered. Mirrored in mobile/components/messages/types.ts. */
export const ALLOWED_REACTIONS = ['❤️', '👍', '😂', '😮', '🙏', '🔥'] as const
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number]

/** The thread's opening message has this id in the conversation view. */
export const OPENING_MESSAGE_ID = 'opening'

/** Subcollection holding the opener's reactions (see STORAGE above). */
export const REACTIONS_SUBCOLLECTION = 'reactions'

/** Characters of the quoted message kept on a reply. */
export const REPLY_EXCERPT_LENGTH = 120

/** Firestore auto ids (and 'opening'); anything else can't name a message. */
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type QuoteAuthorRole = 'attendee' | 'organizer'

export interface ReplyTo {
  id: string
  excerpt: string
  author_role: QuoteAuthorRole
}

export interface ReactionSummary {
  emoji: ReactionEmoji
  count: number
  /** The viewer's own reaction is this one. */
  mine: boolean
}

export type ReactionMap = Record<string, string>

export function isAllowedReaction(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && (ALLOWED_REACTIONS as readonly string[]).includes(value)
}

export function isValidMessageId(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value)
}

/** Only `{ userId: allowedEmoji }` entries survive; anything else stored is ignored. */
export function sanitizeReactionMap(raw: unknown): ReactionMap {
  const out: ReactionMap = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [uid, emoji] of Object.entries(raw as Record<string, unknown>)) {
    if (uid && isAllowedReaction(emoji)) out[uid] = emoji
  }
  return out
}

/**
 * Tap an emoji: the same one again takes your reaction off, a different one
 * replaces it. Returns a NEW map and what the viewer's reaction now is.
 */
export function toggleReaction(
  current: unknown,
  userId: string,
  emoji: ReactionEmoji
): { reactions: ReactionMap; mine: ReactionEmoji | null } {
  const reactions = sanitizeReactionMap(current)
  if (reactions[userId] === emoji) {
    delete reactions[userId]
    return { reactions, mine: null }
  }
  reactions[userId] = emoji
  return { reactions, mine: emoji }
}

/**
 * What a viewer sees: one entry per emoji (in ALLOWED_REACTIONS order), with
 * its count and whether it is theirs. Never who reacted.
 */
export function summarizeReactions(raw: unknown, viewerId?: string | null): ReactionSummary[] {
  const map = sanitizeReactionMap(raw)
  const counts = new Map<ReactionEmoji, number>()
  for (const emoji of Object.values(map)) {
    counts.set(emoji as ReactionEmoji, (counts.get(emoji as ReactionEmoji) || 0) + 1)
  }
  const mine = viewerId ? map[viewerId] : undefined
  return ALLOWED_REACTIONS.filter((e) => counts.has(e)).map((emoji) => ({
    emoji,
    count: counts.get(emoji) || 0,
    mine: mine === emoji,
  }))
}

/** First line of a message, whitespace flattened, clipped to `max` characters. */
export function clipExcerpt(text: unknown, max = REPLY_EXCERPT_LENGTH): string {
  const raw = typeof text === 'string' ? text : ''
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) || ''
  const flat = firstLine.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  if (chars.length <= max) return flat
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/**
 * The quoted message's id from a send body: `reply_to_id`, or `reply_to.id`.
 * `undefined` = not a quoted reply; `null` = an id was sent but is malformed.
 */
export function readReplyToId(body: unknown): string | null | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, any>
  const raw =
    b.reply_to_id !== undefined && b.reply_to_id !== null && b.reply_to_id !== ''
      ? b.reply_to_id
      : b.reply_to && typeof b.reply_to === 'object'
        ? b.reply_to.id
        : undefined
  if (raw === undefined || raw === null || raw === '') return undefined
  return isValidMessageId(raw) ? raw : null
}

/** Build the stored quote from the quoted message's own data. */
export function buildReplyTo(
  id: string,
  quoted: { body?: unknown; author_role?: unknown }
): ReplyTo {
  return {
    id,
    excerpt: clipExcerpt(quoted.body),
    author_role: quoted.author_role === 'organizer' ? 'organizer' : 'attendee',
  }
}

/** A stored quote, re-validated on read (legacy or hand-edited docs read as none). */
export function readStoredReplyTo(raw: unknown): ReplyTo | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!isValidMessageId(r.id)) return undefined
  return {
    id: r.id,
    excerpt: clipExcerpt(r.excerpt),
    author_role: r.author_role === 'organizer' ? 'organizer' : 'attendee',
  }
}
