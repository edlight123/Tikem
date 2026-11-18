'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'

type AdminUserDetailsClientProps = {
  details: {
    id: string
    user: any
    attendeeStats: {
      ticketsConfirmed: number
      ticketsCheckedIn: number
      eventsAttended: number
    }
    organizerStats?: {
      totalEvents: number
      publishedEvents: number
      ticketsSold: number
    } | null
    isOrganizer: boolean
  }
  showPromoteToOrganizer: boolean
  promoteToOrganizer: (formData: FormData) => void
}

export default function AdminUserDetailsClient({
  details,
  showPromoteToOrganizer,
  promoteToOrganizer,
}: AdminUserDetailsClientProps) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const confirmDialog = useConfirm()
  const [isUpdating, setIsUpdating] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { id, user, attendeeStats, organizerStats, isOrganizer } = details

  const isBanned = user.status === 'banned'
  const displayName = user.full_name || user.name || user.email || 'This user'

  const handleToggleBan = async (action: 'ban' | 'unban') => {
    const ok = await confirmDialog({
      title: action === 'ban' ? 'Suspend this user?' : 'Restore this user?',
      description:
        action === 'ban'
          ? `${displayName} will lose access to their account and their events will be hidden.`
          : `${displayName} will regain access to their account.`,
      confirmLabel: action === 'ban' ? 'Suspend' : 'Restore',
      variant: action === 'ban' ? 'danger' : 'default',
    })
    if (!ok) return

    setIsUpdating(true)
    setMessage(null)

    try {
      // Reuses the shared admin action endpoint (operates on any user doc).
      const res = await fetch('/api/admin/organizer-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerId: id, action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update user')
      }
      setMessage({
        type: 'success',
        text: data?.message || (action === 'ban' ? 'User suspended' : 'User restored'),
      })
      router.refresh()
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to update user' })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6">
      {/*
        A detail page sits BELOW the hub, not beside it, so it carries no tab
        strip — breadcrumbs are the way back up, the same trail the other
        console detail routes use.
      */}
      <AdminBreadcrumbs
        items={[{ label: 'People', href: '/admin/people' }, { label: displayName }]}
      />

      {/* Message */}
      {message && (
        <div className={`mb-5 text-sm ${message.type === 'success' ? 'text-console-green' : 'text-console-red'}`}>
          {message.text}
        </div>
      )}

      {/* Header — mono caps, the console's own voice; badges and id beneath. */}
      <div className="mb-3 min-w-0">
        <h1 className="label-mono truncate text-body font-bold uppercase tracking-[0.14em] text-console-text">
          {user.full_name || user.name || 'No name'}
        </h1>
        {user.email && <p className="mt-1 truncate text-sm text-console-mut">{user.email}</p>}
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
            <span className="label-mono uppercase text-console-mut">{user.role || 'attendee'}</span>
            {user.is_verified && (
              <span className="label-mono uppercase text-console-green">{t('users.verified')}</span>
            )}
            {isBanned && (
              <span className="label-mono uppercase text-console-red">Suspended</span>
            )}
            {isOrganizer && (
              <Link
                href={`/admin/people/organizers/${id}`}
                className="text-console-mut hover:text-console-text"
              >
                {t('users.open_organizer_admin')}
              </Link>
            )}
          </div>
          <div className="mt-3 text-xs text-console-mut font-mono break-all">
            {t('users.user_id')}: {id}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:min-w-[200px]">
          {showPromoteToOrganizer && (
            <form action={promoteToOrganizer}>
              <input type="hidden" name="userId" value={id} />
              <button
                type="submit"
                className="w-full rounded-lg bg-console-text px-4 py-2.5 text-sm font-bold text-console-ground hover:opacity-90"
              >
                {t('users.promote_to_organizer')}
              </button>
            </form>
          )}

          {isBanned ? (
            <button
              onClick={() => handleToggleBan('unban')}
              disabled={isUpdating}
              className="rounded-lg bg-console-panel px-4 py-2.5 text-sm font-semibold text-console-mut hover:bg-console-raise hover:text-console-text disabled:opacity-50"
            >
              Restore Access
            </button>
          ) : (
            <button
              onClick={() => handleToggleBan('ban')}
              disabled={isUpdating}
              className="rounded-lg bg-transparent px-4 py-2.5 text-sm font-semibold text-console-red hover:bg-console-raise disabled:opacity-50"
            >
              Suspend User
            </button>
          )}
        </div>
      </div>

      {/* Attendee stats strip */}
      <div className="mb-6 grid grid-cols-3 divide-x divide-console-raise overflow-hidden rounded-lg bg-console-panel">
        <div className="p-4">
          <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{t('users.events_attended')}</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{attendeeStats.eventsAttended}</div>
        </div>
        <div className="p-4">
          <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{t('users.tickets_confirmed')}</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{attendeeStats.ticketsConfirmed}</div>
        </div>
        <div className="p-4">
          <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{t('users.tickets_checked_in')}</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{attendeeStats.ticketsCheckedIn}</div>
        </div>
      </div>

      {/* Organizer section */}
      {isOrganizer && organizerStats && (
        <div className="rounded-lg bg-console-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">{t('users.organizer_section')}</h2>
            <Link
              href={`/admin/people/organizers/${id}`}
              className="text-sm font-medium text-console-mut hover:text-console-text"
            >
              {t('users.open_organizer_admin')}
            </Link>
          </div>

          <div className="grid grid-cols-3 divide-x divide-console-raise overflow-hidden rounded-lg bg-console-panel">
            <div className="p-4">
              <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{t('users.organizer_total_events')}</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{organizerStats.totalEvents}</div>
            </div>
            <div className="p-4">
              <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{t('users.organizer_published_events')}</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{organizerStats.publishedEvents}</div>
            </div>
            <div className="p-4">
              <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{t('users.organizer_tickets_sold')}</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{organizerStats.ticketsSold}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
