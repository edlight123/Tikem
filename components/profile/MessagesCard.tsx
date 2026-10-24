'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Loader2, MessageCircle, Send } from 'lucide-react'
import { EmptyState } from '@/components/ui/kit'
import type { AttendeeThreadSummary, ConversationView, OrganizerMessageReply } from '@/lib/organizer-messages'
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
    <span className={`relative block shrink-0 overflow-hidden rounded bg-white/[0.07] ${className}`}>
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

  // ── One conversation ──────────────────────────────────────────────────────
  if (openId) {
    const organizerLabel = thread?.organizer_name || t('dashboard.messages.organizer')
    const blocked = thread ? thread.closed || thread.awaiting_organizer : true
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
              className="flex items-center gap-3.5 bg-white/[0.03] px-4 py-3.5 transition-colors hover:bg-white/[0.055] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-5"
            >
              <Poster url={thread.event_poster} className="h-14 w-11" />
              <span className="min-w-0">
                <span className="block truncate font-display !text-[18px] !leading-snug text-white">
                  {thread.event_title}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-white/50">{organizerLabel}</span>
              </span>
            </Link>

            <ol className="space-y-3 px-4 py-5 sm:px-5" aria-label={t('dashboard.messages.conversation')}>
              {thread.messages.map((m, i) => {
                const mine = m.author_role === 'attendee'
                return (
                  <li
                    key={m.id}
                    ref={i === thread.messages.length - 1 ? endRef : undefined}
                    className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded px-4 py-3 ${
                        mine ? 'bg-white/[0.14] text-white/90' : 'bg-white/[0.055] text-white/85'
                      }`}
                    >
                      <p className="whitespace-pre-line text-[15px] leading-relaxed">{m.body}</p>
                      <p className="mt-1.5 text-[11px] text-white/40">
                        {mine ? t('dashboard.messages.you') : m.author_name || organizerLabel} · {formatWhen(m.created_at)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>

            <div className="bg-white/[0.02] px-4 py-4 sm:px-5">
              {thread.closed ? (
                <p className="text-[13px] text-white/50">{t('dashboard.messages.closed')}</p>
              ) : thread.awaiting_organizer ? (
                <p className="text-[13px] text-white/50">{t('dashboard.messages.awaiting')}</p>
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
                    <p className="text-[12px] text-white/40">{t('dashboard.messages.privacy')}</p>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[11px] tabular-nums text-white/35">
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
              {error && <p className="mt-3 text-[13px] text-red-400">{error}</p>}
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
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.055] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-5"
              >
                <Poster url={th.event_poster} className="h-14 w-11" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span
                      className={`truncate font-display !text-[18px] !leading-snug ${th.unread ? 'text-white' : 'text-white/80'}`}
                    >
                      {th.event_title}
                    </span>
                    <span className="shrink-0 text-[11px] text-white/40">{formatWhen(th.last_activity_at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={`line-clamp-1 text-[13px] ${th.unread ? 'text-white/80' : 'text-white/50'}`}>
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
