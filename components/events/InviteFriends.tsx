'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Link2, Search, UserPlus } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'
import { useToast } from '@/components/ui/Toast'

type PickerState = 'available' | 'invited' | 'going' | 'unavailable'
interface PickerFriend {
  uid: string
  displayName: string
  photoURL?: string
  state: PickerState
}

interface InviteFriendsProps {
  eventId: string
  eventTitle: string
  /** config/auth.invites, read on the server. Off: renders nothing. */
  enabled: boolean
  currentUserId: string | null
  className?: string
}

/**
 * "Invite friends" on the event page (lib/invites): a picker of the viewer's
 * ACCEPTED connections, plus the viewer's personal invite link for people not
 * on Tikèm yet. Signed-in only; the server enforces every rule again.
 */
export default function InviteFriends({ eventId, eventTitle, enabled, currentUserId, className = '' }: InviteFriendsProps) {
  const { t } = useTranslation('common')
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<PickerFriend[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (friends || []).filter((f) => !q || f.displayName.toLowerCase().includes(q))
  }, [friends, query])

  if (!enabled || !currentUserId) return null

  const load = async () => {
    setLoadFailed(false)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/invite`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(json?.friends)) throw new Error('load')
      setFriends(json.friends)
    } catch {
      setLoadFailed(true)
      setFriends([])
    }
  }

  const openPicker = () => {
    setOpen(true)
    setSelected(new Set())
    setQuery('')
    setFriends(null)
    load()
  }

  const toggle = (uid: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else if (next.size < 20) next.add(uid)
      return next
    })

  const send = async () => {
    if (selected.size === 0 || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendIds: Array.from(selected) }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 429) {
        showToast({ type: 'error', title: t('invites.limit') })
        return
      }
      if (!res.ok) throw new Error(json?.error || 'send')
      const sent = new Set<string>(json?.sent || [])
      setFriends((prev) => (prev || []).map((f) => (sent.has(f.uid) ? { ...f, state: 'invited' } : f)))
      setSelected(new Set())
      showToast({ type: 'success', title: t('invites.sentToast') })
      setOpen(false)
    } catch {
      showToast({ type: 'error', title: t('invites.error') })
    } finally {
      setSending(false)
    }
  }

  const shareLink = async () => {
    try {
      const res = await fetch(`/api/invites/link?eventId=${encodeURIComponent(eventId)}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || typeof json?.url !== 'string') throw new Error('link')
      const text = t('invites.messageEvent', { event: eventTitle, link: json.url })
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title: eventTitle, text })
          return
        } catch (err) {
          if ((err as Error).name === 'AbortError') return
        }
      }
      await navigator.clipboard.writeText(text)
      showToast({ type: 'success', title: t('invites.linkCopied') })
    } catch {
      showToast({ type: 'error', title: t('invites.error') })
    }
  }

  const stateLabel = (s: PickerState) =>
    s === 'invited' ? t('invites.stateInvited') : s === 'going' ? t('invites.stateGoing') : t('invites.stateUnavailable')

  return (
    <div className={`px-4 md:px-0 ${className}`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={openPicker}
          className="flex min-h-[48px] items-center gap-3 rounded-2xl bg-white/[0.055] px-4 py-3 text-left text-[15px] font-bold text-white transition-colors hover:bg-white/[0.09]"
        >
          <UserPlus className="h-5 w-5 text-white/70" />
          {t('invites.inviteFriends')}
        </button>
        <button
          type="button"
          onClick={shareLink}
          title={t('invites.shareLinkHint')}
          className="flex min-h-[48px] items-center gap-3 rounded-2xl bg-white/[0.055] px-4 py-3 text-left text-[15px] font-bold text-white transition-colors hover:bg-white/[0.09]"
        >
          <Link2 className="h-5 w-5 text-white/70" />
          {t('invites.shareLink')}
        </button>
      </div>

      <BottomSheet isOpen={open} onClose={() => setOpen(false)} title={t('invites.pickerTitle')}>
        <p className="text-[13px] text-white/55">{t('invites.pickerSubtitle')}</p>
        <label className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.07] px-3 py-2.5">
          <Search className="h-4 w-4 text-white/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('invites.search')}
            className="w-full bg-transparent text-base text-white placeholder:text-white/40 focus:outline-none"
          />
        </label>

        <div className="mt-3 min-h-[120px]">
          {friends === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.05]" />
              ))}
            </div>
          ) : loadFailed ? (
            <p className="py-6 text-center text-sm text-white/60">{t('invites.loadError')}</p>
          ) : friends.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/60">{t('invites.empty')}</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/60">{t('invites.noMatch')}</p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-xl bg-white/[0.04]">
              {filtered.map((f) => {
                const selectable = f.state === 'available'
                const isOn = selected.has(f.uid)
                return (
                  <li key={f.uid}>
                    <button
                      type="button"
                      disabled={!selectable}
                      onClick={() => toggle(f.uid)}
                      aria-pressed={isOn}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.12] text-sm font-semibold text-white">
                        {f.photoURL ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={f.photoURL} alt="" className="h-full w-full object-cover" />
                        ) : (
                          (f.displayName || 'U').charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[15px] ${selectable ? 'text-white' : 'text-white/45'}`}>
                        {f.displayName}
                      </span>
                      {selectable ? (
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-full ${isOn ? 'bg-white text-black' : 'bg-white/[0.1]'}`}
                        >
                          {isOn && <Check className="h-4 w-4" />}
                        </span>
                      ) : (
                        // Dot + label, not a filled pill.
                        <span className="flex items-center gap-1.5 text-[12px] text-white/50">
                          <span className={`h-1.5 w-1.5 rounded-full ${f.state === 'going' ? 'bg-brand-400' : 'bg-white/40'}`} />
                          {stateLabel(f.state)}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={send}
          disabled={selected.size === 0 || sending}
          className="mt-4 w-full rounded-full bg-white py-3 text-[15px] font-bold text-black transition-opacity disabled:opacity-40"
        >
          {sending ? t('invites.sending') : t('invites.sendCount', { count: selected.size })}
        </button>
      </BottomSheet>
    </div>
  )
}
