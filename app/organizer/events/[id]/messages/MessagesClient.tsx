'use client'

import { useTranslation } from 'react-i18next'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { OrgEmptyState } from '@/components/organizer/ui'
import type { OrganizerMessageThread } from '@/lib/organizer-messages'

interface MessagesClientProps {
  eventTitle: string
  threads: OrganizerMessageThread[]
  /** Server-owned cap, passed down so there is one source of truth for it. */
  maxReplyLength: number
}

const TOPIC_LABEL: Record<string, string> = {
  event: 'the event',
  ticket: 'their ticket',
  other: 'something else',
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

export default function MessagesClient({
  eventTitle,
  threads: initialThreads,
  maxReplyLength,
}: MessagesClientProps) {
  const { t: tx } = useTranslation('organizer')

  const [threads, setThreads] = useState(initialThreads)
  const [selectedId, setSelectedId] = useState<string | null>(initialThreads[0]?.id ?? null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Threads already acknowledged this session, so opening one twice is one write. */
  const acknowledged = useRef<Set<string>>(new Set())

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  )

  const unreadCount = threads.filter((t) => t.unread).length

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
  // on arrival — its question is fully visible above the composer.
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
      if (!res.ok) throw new Error(data?.error || 'Could not send your reply.')

      // The reply is already stored server-side; if the echo is missing for any
      // reason, show what was typed rather than pushing an undefined bubble.
      const saved = data?.reply ?? {
        id: `local-${Date.now()}`,
        body,
        author_role: 'organizer' as const,
        author_name: 'You',
        created_at: new Date().toISOString(),
      }

      const threadId = selected.id
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                status: 'replied',
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
      setError(e?.message || 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">{tx('actions.messages')}</h1>
        <p className="mt-0.5 text-sm text-white/50">
          {threads.length === 0
            ? 'Questions attendees send about this event land here'
            : unreadCount > 0
              ? `${unreadCount} unanswered of ${threads.length} conversation${threads.length !== 1 ? 's' : ''}`
              : `${threads.length} conversation${threads.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {threads.length === 0 ? (
        <OrgEmptyState
          icon={MessageSquare}
          title={tx('messages.no_messages_yet')}
          description={
            eventTitle
              ? `When someone asks a question about ${eventTitle} before buying, you can answer it here. A fast reply is often what turns a browser into a buyer.`
              : 'When someone asks a question before buying, you can answer it here. A fast reply is often what turns a browser into a buyer.'
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Thread list */}
          <ul className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === selectedId
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(thread.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      active
                        ? 'border-brand-600/60 bg-white/[0.04]'
                        : 'border-white/10 hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {thread.unread && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                          aria-hidden
                        />
                      )}
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                        {thread.sender_name}
                      </p>
                      <span className="shrink-0 text-[11px] text-white/40">
                        {formatWhen(thread.last_activity_at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-white/50">{thread.message}</p>
                    <p className="mt-1.5 text-[11px] text-white/35">
                      About {TOPIC_LABEL[thread.topic] ?? 'something else'}
                      {thread.reply_count > 0 && ' · answered'}
                      {thread.unread && <span className="sr-only"> · unread</span>}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Conversation */}
          {selected && (
            <div className="rounded-2xl p-5 sm:p-6 bg-white/[0.055]">
              <div className="border-b border-white/10 pb-4">
                <p className="text-sm font-medium text-white">{selected.sender_name}</p>
                <p className="mt-0.5 text-xs text-white/45">
                  Asked about {TOPIC_LABEL[selected.topic] ?? 'something else'} ·{' '}
                  {formatWhen(selected.created_at)}
                </p>
              </div>

              <div className="space-y-4 py-5">
                <div className="max-w-prose rounded-2xl rounded-tl-sm bg-white/[0.05] px-4 py-3">
                  <p className="whitespace-pre-line text-sm text-white/85">{selected.message}</p>
                </div>

                {selected.replies.map((r) => (
                  <div key={r.id} className="flex justify-end">
                    <div className="max-w-prose rounded-2xl rounded-tr-sm bg-white/[0.12] px-4 py-3">
                      <p className="whitespace-pre-line text-sm text-white/90">{r.body}</p>
                      <p className="mt-1.5 text-[11px] text-white/40">
                        You · {formatWhen(r.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/10 pt-5">
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
                  placeholder={`Reply to ${selected.sender_name}…`}
                  className="w-full resize-y rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
                />
                <div className="mt-3 flex items-center justify-between gap-4">
                  <p className="text-[11px] text-white/35">
                    {tx('messages.reply_privacy_note')}
                  </p>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[11px] tabular-nums text-white/35">
                      {reply.length}/{maxReplyLength}
                    </span>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={sending || reply.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? 'Sending…' : 'Send reply'}
                    </button>
                  </div>
                </div>
                {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
