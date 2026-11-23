'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Loader2, MessageCircle, Send } from 'lucide-react'
import { EmptyState } from '@/components/ui/kit'
import type { AttendeeThreadSummary, ConversationView, OrganizerMessageReply } from '@/lib/organizer-messages'
import type { ReactionEmoji } from '@/lib/messages/threadExtras'
import { QuoteBlock, ReactPicker, ReactionRow, postReaction, toggleLocal } from '@/components/messages/MessageExtras'
import { FIELD, GHOST_BTN, Panel, PanelRows, ProfileSection, WHITE_BTN } from './ui'

/** Mirrors MAX_FOLLOWUP_LENGTH in lib/organizer-messages.ts; the server rejects more. */
const MAX_FOLLOWUP_LENGTH = 1000

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** ?thread= on /profile (the reply email, push and bell link) picks the thread. */
function threadFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('thread')
}

function Poster({ url, className }: { url: string | null; className: string }) {
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded bg-surface-raised ${className}`}>
      {url ? <Image src={url} alt="" fill sizes="64px" unoptimized className="object-cover" /> : null}
    </span>
  )
}

/**
 * "Messages" on /profile (#messages): the attendee's own conversations with
 * organizers, the web twin of the mobile Messages screen. A list of threads
 * (poster, event, last message, unread dot) that opens a conversation in place:
 * the opening question, the organizer's replies and the attendee's follow-ups
 * in order, with a box to write back into the same thread.
 *
 * Everything goes through /api/messages; the replies subcollection is
 * server-only by design, so there is no Firestore listener here.
 */
export function MessagesCard() {
  const { t } = useTranslation('profile')
  const [threads, setThreads] = useState<AttendeeThreadSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [openId, setOpenId] = useState<string | null>(null)
  const [thread, setThread] = useState<ConversationView | null>(null)
  const [threadStatus, setThreadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLLIElement>(null)

  const loadList = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/messages', { cache: 'no-store' })
      if (!res.ok) throw new Error(`messages ${res.status}`)
      const data = await res.json()
      setThreads(Array.isArray(data?.threads) ? data.threads : [])
      setStatus('ready')
    } catch (err) {
      console.error('Failed to load messages:', err)
      setStatus('error')
    }
  }, [])

  const openThread = useCallback(async (id: string) => {
    setOpenId(id)
    setThread(null)
    setThreadStatus('loading')
    setDraft('')
    setError(null)
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`thread ${res.status}`)
      const data = await res.json()
      setThread(data.thread)
      setThreadStatus('ready')
      setThreads((prev) => prev.map((th) => (th.id === id ? { ...th, unread: false } : th)))
      // Best-effort: a failed acknowledgement only means the dot returns next load.
      fetch(`/api/messages/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => {})
    } catch (err) {
      console.error('Failed to load conversation:', err)
      setThreadStatus('error')
    }
  }, [])

  useEffect(() => {
    loadList()
    const fromUrl = threadFromUrl()
    if (fromUrl) void openThread(fromUrl)
  }, [loadList, openThread])

  useEffect(() => {
    if (thread) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [thread])

  const closeThread = () => {
    setOpenId(null)
    setThread(null)
    setThreadStatus('idle')
    // Drop ?thread= so a reload shows the list, keeping the #messages panel.
    if (threadFromUrl()) {
      window.history.replaceState(null, '', `${window.location.pathname}#messages`)
    }
  }

  const send = async () => {
    const body = draft.trim()
    if (!thread || !body || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(thread.id)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = data?.code
        if (code === 'blocked' || code === 'you_blocked') {
          setThread((th) => (th ? { ...th, blocked: true, blocked_by_viewer: code === 'you_blocked' } : th))
          return
        }
        if (code === 'awaiting_reply') setThread((th) => (th ? { ...th, awaiting_organizer: true } : th))
        if (code === 'thread_reply_limit') setThread((th) => (th ? { ...th, closed: true } : th))
        throw new Error(
          code === 'awaiting_reply'
            ? t('dashboard.messages.error_awaiting')
            : code === 'thread_reply_limit'
              ? t('dashboard.messages.error_limit')
              : code === 'message_too_long'
                ? t('dashboard.messages.error_too_long')
                : t('dashboard.messages.error_generic')
        )
      }
      const saved: OrganizerMessageReply = data?.reply ?? {
        id: `local-${Date.now()}`,
        body,
        author_role: 'attendee',
        author_name: '',
        created_at: new Date().toISOString(),
      }
      setThread((th) =>
        th ? { ...th, needs_reply: true, reply_count: th.reply_count + 1, messages: [...th.messages, saved] } : th
      )
      setThreads((prev) =>
        prev.map((th) =>
          th.id === thread.id
            ? { ...th, last_message_preview: body, last_message_role: 'attendee', last_activity_at: saved.created_at }
            : th
        )
      )
      setDraft('')
    } catch (e: any) {
      setError(e?.message || t('dashboard.messages.error_generic'))
    } finally {
      setSending(false)
    }
  }

  /** Optimistic toggle; the server's counts replace it, a failure puts it back. */
  const react = async (messageId: string, emoji: ReactionEmoji) => {
    if (!thread || thread.blocked || messageId.startsWith('local-')) return
    const threadId = thread.id
    const before = thread.messages.find((m) => m.id === messageId)?.reactions
    const setReactions = (fn: (m: OrganizerMessageReply) => OrganizerMessageReply['reactions']) =>
      setThread((th) =>
        th && th.id === threadId
          ? { ...th, messages: th.messages.map((m) => (m.id === messageId ? { ...m, reactions: fn(m) } : m)) }
          : th
      )
    setReactions((m) => toggleLocal(m.reactions, emoji))
    try {
      const next = await postReaction(threadId, messageId, emoji)
      setReactions(() => next)
    } catch (e: any) {
      setReactions(() => before)
      if (e?.code === 'blocked' || e?.code === 'you_blocked') {
        setThread((th) => (th ? { ...th, blocked: true, blocked_by_viewer: e.code === 'you_blocked' } : th))
      } else {
        setError(t('dashboard.messages.reaction_failed'))
      }
    }
  }

  // ── One conversation ──────────────────────────────────────────────────────
  if (openId) {
    const organizerLabel = thread?.organizer_name || t('dashboard.messages.organizer')
    const blocked = thread ? thread.closed || thread.awaiting_organizer || !!thread.blocked : true
    const canReact = !!thread && !thread.blocked
    const quoteAuthor = (role: 'attendee' | 'organizer') =>
      role === 'attendee' ? t('dashboard.messages.you') : organizerLabel
    return (
      <ProfileSection
        title={t('dashboard.messages.title')}
        actions={
          <button type="button" onClick={closeThread} className={GHOST_BTN}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('dashboard.messages.all')}
          </button>
        }
      >
        {threadStatus === 'loading' ? (
          <Panel className="p-5">
            <div className="skeleton h-5 w-48 rounded" />
            <div className="skeleton mt-6 h-16 w-3/4 rounded" />
            <div className="skeleton ml-auto mt-3 h-12 w-2/3 rounded" />
          </Panel>
        ) : threadStatus === 'error' || !thread ? (
          <EmptyState
            title={t('dashboard.messages.thread_error')}
            className="!p-8"
            action={
              <button type="button" onClick={() => openThread(openId)} className={GHOST_BTN}>
                {t('dashboard.messages.retry')}
              </button>
            }
          />
        ) : (
          <Panel>
            <Link
              href={`/events/${encodeURIComponent(thread.event_id)}`}
              className="flex items-center gap-3.5 bg-surface-low px-4 py-3.5 transition-colors hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-5"
            >
              <Poster url={thread.event_poster} className="h-14 w-11" />
              <span className="min-w-0">
                <span className="block truncate font-display italic !text-lead !leading-snug text-fg">
                  {thread.event_title}
                </span>
                <span className="mt-0.5 block truncate text-meta text-fg-subtle">{organizerLabel}</span>
              </span>
            </Link>

            <ol className="space-y-3 px-4 py-5 sm:px-5" aria-label={t('dashboard.messages.conversation')}>
              {thread.messages.map((m, i) => {
                const mine = m.author_role === 'attendee'
                const local = m.id.startsWith('local-')
                return (
                  <li
                    key={m.id}
                    ref={i === thread.messages.length - 1 ? endRef : undefined}
                    className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                  >
                    <div className={`group flex max-w-[85%] items-start gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
                      <div
                        className={`min-w-0 rounded px-4 py-3 ${
                          mine ? 'bg-surface-high text-fg' : 'bg-surface text-fg-soft'
                        }`}
                      >
                        {m.reply_to ? <QuoteBlock quote={m.reply_to} author={quoteAuthor(m.reply_to.author_role)} /> : null}
                        <p className="whitespace-pre-line text-body leading-relaxed">{m.body}</p>
                        <p className="mt-1.5 text-eyebrow text-fg-subtle">
                          {mine ? t('dashboard.messages.you') : m.author_name || organizerLabel} · {formatWhen(m.created_at)}
                        </p>
                      </div>
                      {canReact && !local ? (
                        <ReactPicker
                          mine={m.reactions?.find((r) => r.mine)?.emoji ?? null}
                          onPick={(emoji) => react(m.id, emoji)}
                          label={t('dashboard.messages.react')}
                          labelFor={(emoji) => t('dashboard.messages.react_with', { emoji })}
                          alignEnd={mine}
                        />
                      ) : null}
                    </div>
                    <ReactionRow
                      reactions={m.reactions}
                      alignEnd={mine}
                      onToggle={canReact && !local ? (emoji) => react(m.id, emoji) : undefined}
                      labelFor={(r) => t('dashboard.messages.reaction_count', { emoji: r.emoji, count: r.count })}
                    />
                  </li>
                )
              })}
            </ol>

            <div className="bg-surface-low px-4 py-4 sm:px-5">
              {thread.blocked ? (
                <p className="text-meta text-fg-subtle">
                  {thread.blocked_by_viewer ? t('dashboard.messages.you_blocked') : t('dashboard.messages.blocked')}
                </p>
              ) : thread.closed ? (
                <p className="text-meta text-fg-subtle">{t('dashboard.messages.closed')}</p>
              ) : thread.awaiting_organizer ? (
                <p className="text-meta text-fg-subtle">{t('dashboard.messages.awaiting')}</p>
              ) : null}
              {!blocked && (
                <>
                  <label htmlFor="attendee-followup" className="sr-only">
                    {t('dashboard.messages.reply_label')}
                  </label>
                  <textarea
                    id="attendee-followup"
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, MAX_FOLLOWUP_LENGTH))}
                    maxLength={MAX_FOLLOWUP_LENGTH}
                    disabled={sending}
                    placeholder={t('dashboard.messages.reply_placeholder', { name: organizerLabel })}
                    className={`${FIELD} resize-y`}
                  />
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <p className="text-caption text-fg-subtle">{t('dashboard.messages.privacy')}</p>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-eyebrow tabular-nums text-fg-faint">
                        {draft.length}/{MAX_FOLLOWUP_LENGTH}
                      </span>
                      <button
                        type="button"
                        onClick={send}
                        disabled={sending || draft.trim().length === 0}
                        className={WHITE_BTN}
                      >
                        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                        {sending ? t('dashboard.messages.sending') : t('dashboard.messages.send')}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {error && <p className="mt-3 text-meta text-danger">{error}</p>}
            </div>
          </Panel>
        )}
      </ProfileSection>
    )
  }

  // ── The list ──────────────────────────────────────────────────────────────
  return (
    <ProfileSection title={t('dashboard.messages.title')} description={t('dashboard.messages.subtitle')}>
      {status === 'loading' ? (
        <Panel>
          <PanelRows>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                <div className="skeleton h-14 w-11 shrink-0 rounded" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-40 rounded" />
                  <div className="skeleton h-3 w-56 rounded" />
                </div>
              </div>
            ))}
          </PanelRows>
        </Panel>
      ) : status === 'error' ? (
        <EmptyState
          title={t('dashboard.messages.load_error')}
          className="!p-8"
          action={
            <button type="button" onClick={loadList} className={GHOST_BTN}>
              {t('dashboard.messages.retry')}
            </button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title={t('dashboard.messages.empty_title')}
          description={t('dashboard.messages.empty_body')}
          className="!p-8"
        />
      ) : (
        <Panel>
          <PanelRows>
            {threads.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => openThread(th.id)}
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-5"
              >
                <Poster url={th.event_poster} className="h-14 w-11" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span
                      className={`truncate font-display italic !text-lead !leading-snug ${th.unread ? 'text-fg' : 'text-fg-soft'}`}
                    >
                      {th.event_title}
                    </span>
                    <span className="shrink-0 text-eyebrow text-fg-subtle">{formatWhen(th.last_activity_at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={`line-clamp-1 text-meta ${th.unread ? 'text-fg-soft' : 'text-fg-subtle'}`}>
                      {th.last_message_role === 'attendee'
                        ? `${t('dashboard.messages.you')}: `
                        : th.organizer_name
                          ? `${th.organizer_name}: `
                          : ''}
                      {th.last_message_preview}
                    </span>
                    {th.unread ? (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                        <span className="sr-only">{t('dashboard.messages.unread')}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
          </PanelRows>
        </Panel>
      )}
    </ProfileSection>
  )
}
