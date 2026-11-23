'use client'

import { useEffect, useRef, useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { ALLOWED_REACTIONS, type ReactionEmoji, type ReactionSummary, type ReplyTo } from '@/lib/messages/threadExtras'

/**
 * Reactions and quoted replies on the website's conversation views (the
 * attendee's /profile Messages panel and the organizer's event inbox). The app
 * has the full gesture set; the site shows the same data and lets you react
 * with one small control per message. Writes go through
 * POST /api/messages/[id]/react (lib/messages/threadExtras for the rules).
 */

/** The quoted message at the top of a bubble: who wrote it and its first line. */
export function QuoteBlock({ quote, author }: { quote: ReplyTo; author: string }) {
  return (
    <div className="mb-2 rounded bg-scrim-light px-3 py-2">
      <p className="truncate text-caption font-semibold text-fg-muted">{author}</p>
      <p className="line-clamp-2 text-meta text-fg-subtle">{quote.excerpt}</p>
    </div>
  )
}

/** The reactions under a bubble. Toggleable when `onToggle` is given. */
export function ReactionRow({
  reactions,
  alignEnd,
  onToggle,
  labelFor,
}: {
  reactions: ReactionSummary[] | undefined
  alignEnd: boolean
  onToggle?: (emoji: ReactionEmoji) => void
  labelFor: (r: ReactionSummary) => string
}) {
  if (!reactions?.length) return null
  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${alignEnd ? 'justify-end' : 'justify-start'}`}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!onToggle}
          onClick={onToggle ? () => onToggle(r.emoji) : undefined}
          aria-pressed={r.mine}
          aria-label={labelFor(r)}
          className={`inline-flex h-6 items-center gap-1 rounded px-1.5 text-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default ${
            r.mine ? 'bg-brand-500/15 text-brand-400' : 'bg-surface-raised text-fg-muted enabled:hover:bg-surface-high'
          }`}
        >
          <span aria-hidden>{r.emoji}</span>
          {r.count > 1 ? <span className="text-caption font-semibold tabular-nums">{r.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** One quiet control beside a bubble that opens the six reactions. */
export function ReactPicker({
  mine,
  onPick,
  label,
  labelFor,
  alignEnd,
}: {
  mine: ReactionEmoji | null
  onPick: (emoji: ReactionEmoji) => void
  label: string
  labelFor: (emoji: ReactionEmoji) => string
  alignEnd: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={ref} className="relative self-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-fg-faint opacity-0 transition-opacity hover:bg-surface-raised hover:text-fg-muted focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <SmilePlus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute bottom-full z-10 mb-1 flex gap-0.5 rounded bg-surface-raised-solid p-1 shadow-2xl shadow-black/60 ${
            alignEnd ? 'right-0' : 'left-0'
          }`}
        >
          {ALLOWED_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitemradio"
              aria-checked={mine === emoji}
              aria-label={labelFor(emoji)}
              onClick={() => {
                setOpen(false)
                onPick(emoji)
              }}
              className={`inline-flex h-9 w-9 items-center justify-center rounded text-lead transition-colors hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                mine === emoji ? 'bg-surface-raised' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Optimistic toggle, the server's rule: the same emoji again removes it. */
export function toggleLocal(current: ReactionSummary[] | undefined, emoji: ReactionEmoji): ReactionSummary[] {
  const list = (current || []).map((r) => ({ ...r }))
  const prevMine = list.find((r) => r.mine)
  if (prevMine) {
    prevMine.count -= 1
    prevMine.mine = false
  }
  if (prevMine?.emoji !== emoji) {
    const target = list.find((r) => r.emoji === emoji)
    if (target) {
      target.count += 1
      target.mine = true
    } else {
      list.push({ emoji, count: 1, mine: true })
    }
  }
  return ALLOWED_REACTIONS.map((e) => list.find((r) => r.emoji === e && r.count > 0)).filter(
    (r): r is ReactionSummary => !!r
  )
}

/** POST the toggle; resolves to the server's counts, or throws with its `code`. */
export async function postReaction(threadId: string, messageId: string, emoji: ReactionEmoji): Promise<ReactionSummary[]> {
  const res = await fetch(`/api/messages/${encodeURIComponent(threadId)}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: messageId, emoji }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(String(data?.error || 'reaction failed')) as Error & { code?: string }
    err.code = data?.code
    throw err
  }
  return Array.isArray(data?.reactions) ? data.reactions : []
}
