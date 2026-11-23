'use client'

import { useTranslation } from 'react-i18next'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { OrgEmptyState, SectionHeader } from '@/components/organizer/ui'
import type { OrganizerMessageReply, OrganizerMessageThread } from '@/lib/organizer-messages'
import type { ReactionEmoji, ReactionSummary, ReplyTo } from '@/lib/messages/threadExtras'
import { QuoteBlock, ReactPicker, ReactionRow, postReaction, toggleLocal } from '@/components/messages/MessageExtras'

interface MessagesClientProps {
  eventTitle: string
  threads: OrganizerMessageThread[]
  /** Server-owned cap, passed down so there is one source of truth for it. */
  maxReplyLength: number
  /** Thread to open on arrival (?thread= from the alert email / push). */
  initialThreadId?: string | null
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The organizer's inbox for one event. Attendees can now write back, so a
 * conversation is the opening question followed by replies from BOTH sides:
 * the attendee's messages sit on the left on a quiet fill, the organizer's own
 * on the right on a brighter one. A thread whose last word is the attendee's
 * is marked "Needs a reply" with a dot and a label (house rule: no status
 * pills).
 */
export default function MessagesClient({
  threads: initialThreads,
  maxReplyLength,
  initialThreadId,
}: MessagesClientProps) {
  const { t: tx } = useTranslation('organizer')

  const [threads, setThreads] = useState(initialThreads)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (initialThreadId && initialThreads.some((th) => th.id === initialThreadId)) return initialThreadId
    return initialThreads[0]?.id ?? null
  })
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Threads a block closed this session (the server refused with blocked / you_blocked). */
  const [blockedThreads, setBlockedThreads] = useState<Record<string, 'blocked' | 'you_blocked'>>({})
  /** Threads already acknowledged this session, so opening one twice is one write. */
  const acknowledged = useRef<Set<string>>(new Set())

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  )

  const waitingCount = threads.filter((t) => t.needs_reply).length

  const topicLabel = (topic: string) =>
    topic === 'event'
      ? tx('messages.about_event')
      : topic === 'ticket'
        ? tx('messages.about_ticket')
        : tx('messages.about_other')

  const markRead = useCallback(async (threadId: string) => {
    if (acknowledged.current.has(threadId)) return
    acknowledged.current.add(threadId)
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t))
    )
    try {
      await fetch(`/api/organizer/messages/${threadId}/read`, { method: 'POST' })
    } catch {
      // The badge is a convenience, not a record. A failed acknowledgement just
      // means the thread shows unread again on the next load.
    }
  }, [])

  // Whichever thread is on screen has been read, including the one auto-selected
  // on arrival — its messages are fully visible above the composer.
  useEffect(() => {
    if (selected?.unread) void markRead(selected.id)
  }, [selected, markRead])

  const handleSelect = (threadId: string) => {
    setSelectedId(threadId)
    setReply('')
    setError(null)
  }

  const handleSend = async () => {
    const body = reply.trim()
    if (!selected || !body || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizer/messages/${selected.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.code === 'blocked' || data?.code === 'you_blocked') {
          setBlockedThreads((prev) => ({ ...prev, [selected.id]: data.code }))
          return
        }
        throw new Error(
          data?.code === 'thread_reply_limit' ? tx('messages.error_limit') : tx('messages.error_generic')
        )
      }

      // The reply is already stored server-side; if the echo is missing for any
      // reason, show what was typed rather than pushing an undefined bubble.
      const saved: OrganizerMessageReply = data?.reply ?? {
        id: `local-${Date.now()}`,
        body,
        author_role: 'organizer',
        author_name: tx('messages.you'),
        created_at: new Date().toISOString(),
      }

      const threadId = selected.id
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                status: 'replied',
                needs_reply: false,
                unread: false,
                reply_count: t.reply_count + 1,
                last_activity_at: saved.created_at,
                replies: [...t.replies, saved],
              }
            : t
        )
      )
      setReply('')
    } catch (e: any) {
      setError(e?.message || tx('messages.error_generic'))
    } finally {
      setSending(false)
    }
  }

  /** The opener's reactions live on the thread; a reply's on the reply. */
  const setReactions = (threadId: string, messageId: string, fn: (cur?: ReactionSummary[]) => ReactionSummary[] | undefined) =>
    setThreads((prev) =>
      prev.map((t) =>
        t.id !== threadId
          ? t
          : messageId === 'opening'
            ? { ...t, opening_reactions: fn(t.opening_reactions) }
            : { ...t, replies: t.replies.map((r) => (r.id === messageId ? { ...r, reactions: fn(r.reactions) } : r)) }
      )
    )

  /** Optimistic toggle; the server's counts replace it, a failure puts it back. */
  const react = async (threadId: string, messageId: string, emoji: ReactionEmoji) => {
    if (blockedThreads[threadId] || messageId.startsWith('local-')) return
    const thread = threads.find((t) => t.id === threadId)
    const before =
      messageId === 'opening' ? thread?.opening_reactions : thread?.replies.find((r) => r.id === messageId)?.reactions
    setReactions(threadId, messageId, (cur) => toggleLocal(cur, emoji))
    try {
      const next = await postReaction(threadId, messageId, emoji)
      setReactions(threadId, messageId, () => next)
    } catch (e: any) {
      setReactions(threadId, messageId, () => before)
      if (e?.code === 'blocked' || e?.code === 'you_blocked') {
        setBlockedThreads((prev) => ({ ...prev, [threadId]: e.code }))
      } else {
        setError(tx('messages.reaction_failed'))
      }
    }
  }

  const selectedBlock = selected ? blockedThreads[selected.id] : undefined

  return (
    <>
      {/* The count line only once there is something to count; empty, no
          explainer (owner, 2026-11-18: "avoid too many explanations"). */}
      <SectionHeader
        className="mb-6"
        title={tx('actions.messages')}
        description={
          threads.length === 0
            ? undefined
            : waitingCount > 0
              ? tx('messages.subtitle_waiting', { count: waitingCount, total: threads.length })
              : tx('messages.subtitle_total', { total: threads.length })
        }
      />

      {threads.length === 0 ? (
        <OrgEmptyState variant="quiet" icon={MessageSquare} title={tx('messages.no_messages_yet')} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Thread list */}
          <ul className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === selectedId
              const last = thread.replies[thread.replies.length - 1]
              const previewText = last ? last.body : thread.message
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(thread.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full rounded px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      active
                        ? 'bg-surface-raised ring-1 ring-inset ring-brand-500/60'
                        : 'bg-surface-low hover:bg-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {thread.unread && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                          aria-hidden
                        />
                      )}
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {thread.sender_name}
                      </p>
                      <span className="shrink-0 text-eyebrow text-fg-subtle">
                        {formatWhen(thread.last_activity_at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">
                      {last?.author_role === 'organizer' ? `${tx('messages.you')}: ` : ''}
                      {previewText}
                    </p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-eyebrow text-fg-faint">
                      {thread.needs_reply ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] text-warning-soft/90">
                          <span className="h-1.5 w-1.5 rounded-full bg-warning-soft/90" aria-hidden />
                          {tx('messages.needs_reply')}
                        </span>
                      ) : (
                        <span>{tx('messages.answered')}</span>
                      )}
                      <span aria-hidden>·</span>
                      <span className="truncate">{topicLabel(thread.topic)}</span>
                      {thread.unread && <span className="sr-only"> · {tx('messages.unread')}</span>}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Conversation */}
          {selected && (
            <div className="rounded p-5 sm:p-6 bg-surface">
              <div className="flex items-start justify-between gap-4 pb-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{selected.sender_name}</p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {topicLabel(selected.topic)} · {formatWhen(selected.created_at)}
                  </p>
                </div>
                {selected.needs_reply && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-[0.08em] text-warning-soft/90">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning-soft/90" aria-hidden />
                    {tx('messages.needs_reply')}
                  </span>
                )}
              </div>

              <ol className="space-y-3 py-4" aria-label={tx('messages.conversation')}>
                <Bubble
                  mine={false}
                  body={selected.message}
                  meta={`${selected.sender_name} · ${formatWhen(selected.created_at)}`}
                  reactions={selected.opening_reactions}
                  onReact={selectedBlock ? undefined : (emoji) => react(selected.id, 'opening', emoji)}
                  quoteAuthor={(role) => (role === 'organizer' ? tx('messages.you') : selected.sender_name)}
                  tx={tx}
                />
                {selected.replies.map((r) => (
                  <Bubble
                    key={r.id}
                    mine={r.author_role === 'organizer'}
                    body={r.body}
                    meta={`${r.author_role === 'organizer' ? tx('messages.you') : selected.sender_name} · ${formatWhen(r.created_at)}`}
                    reactions={r.reactions}
                    quote={r.reply_to}
                    onReact={selectedBlock || r.id.startsWith('local-') ? undefined : (emoji) => react(selected.id, r.id, emoji)}
                    quoteAuthor={(role) => (role === 'organizer' ? tx('messages.you') : selected.sender_name)}
                    tx={tx}
                  />
                ))}
              </ol>

              {selectedBlock ? (
                <p className="pt-4 text-meta text-fg-subtle">
                  {selectedBlock === 'you_blocked' ? tx('messages.you_blocked') : tx('messages.blocked')}
                </p>
              ) : (
              <div className="pt-4">
                <label htmlFor="organizer-reply" className="sr-only">
                  {tx('messages.your_reply')}
                </label>
                <textarea
                  id="organizer-reply"
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value.slice(0, maxReplyLength))}
                  maxLength={maxReplyLength}
                  disabled={sending}
                  placeholder={tx('messages.reply_placeholder', { name: selected.sender_name })}
                  className="w-full resize-y rounded px-4 py-3 text-base sm:text-sm text-fg placeholder-fg-faint focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-surface"
                />
                <div className="mt-3 flex items-center justify-between gap-4">
                  <p className="text-eyebrow text-fg-faint">
                    {tx('messages.reply_privacy_note')}
                  </p>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-eyebrow tabular-nums text-fg-faint">
                      {reply.length}/{maxReplyLength}
                    </span>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={sending || reply.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded bg-inverse px-4 py-2.5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? tx('messages.sending') : tx('messages.send')}
                    </button>
                  </div>
                </div>
                {error && <p className="mt-3 text-sm text-danger">{error}</p>}
              </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

/**
 * One message. The attendee's sit left on a quiet fill; yours sit right,
 * brighter. A quote of an earlier message sits on top, reactions underneath,
 * and a quiet react control appears beside it on hover or focus.
 */
function Bubble({
  mine,
  body,
  meta,
  reactions,
  quote,
  onReact,
  quoteAuthor,
  tx,
}: {
  mine: boolean
  body: string
  meta: string
  reactions?: ReactionSummary[]
  quote?: ReplyTo
  /** Omitted: read-only (a blocked thread, a message still sending). */
  onReact?: (emoji: ReactionEmoji) => void
  quoteAuthor: (role: 'attendee' | 'organizer') => string
  tx: (key: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`group flex max-w-prose items-start gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
        <div className={`min-w-0 rounded px-4 py-3 ${mine ? 'bg-surface-high text-fg' : 'bg-scrim-light text-fg-soft'}`}>
          {quote ? <QuoteBlock quote={quote} author={quoteAuthor(quote.author_role)} /> : null}
          <p className="whitespace-pre-line text-sm">{body}</p>
          <p className="mt-1.5 text-eyebrow text-fg-subtle">{meta}</p>
        </div>
        {onReact ? (
          <ReactPicker
            mine={reactions?.find((r) => r.mine)?.emoji ?? null}
            onPick={onReact}
            label={tx('messages.react')}
            labelFor={(emoji) => tx('messages.react_with', { emoji })}
            alignEnd={mine}
          />
        ) : null}
      </div>
      <ReactionRow
        reactions={reactions}
        alignEnd={mine}
        onToggle={onReact}
        labelFor={(r) => tx('messages.reaction_count', { emoji: r.emoji, count: r.count })}
      />
    </li>
  )
}
