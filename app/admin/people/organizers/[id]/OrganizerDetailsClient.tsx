'use client'

import { useState } from 'react'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'
import { ConsoleButton } from '@/components/admin/console'
import OrganizerPayoutReleaseCard from './OrganizerPayoutReleaseCard'
import OrganizerEventsList, { type OrganizerEventRow } from './OrganizerEventsList'
import OrganizerStatsStrip from './OrganizerStatsStrip'
import { AdminReportsPanel } from '@/components/admin/events/AdminReportsPanel'
import OrganizerAccountCard from './OrganizerAccountCard'
import OrganizerPayoutSummaryCard from './OrganizerPayoutSummaryCard'
import OrganizerProfileCard from './OrganizerProfileCard'
import {
  OrganizerVerificationDocsCard,
  OrganizerVerificationRequestCard,
} from './OrganizerVerificationCards'

type OrganizerDetailsProps = {
  organizerDetails: {
    id: string
    user: any
    organizer: any
    payoutConfig: any
    payoutDestinations?: any[]
    verificationRequest: any
    verificationDocs: any[]
    events?: OrganizerEventRow[]
    eventsTruncated?: boolean
    stats: {
      totalEvents: number
      publishedEvents: number
      ticketsSold: number
    }
  }
}

/**
 * One organizer, everything an admin can see or do about them.
 *
 * This file used to be the whole screen — header, actions, and seven read-only
 * cards, 739 lines of it. The cards are now their own files: none of them share
 * state with anything, they only render a slice of the fetched document, and
 * having them inline meant the four buttons that actually change something were
 * buried in the middle of a wall of markup. What is left here is exactly the
 * part with behaviour: the confirm-gated actions and the state they carry.
 */
export default function OrganizerDetailsClient({ organizerDetails }: OrganizerDetailsProps) {
  const confirmDialog = useConfirm()
  const [isUpdating, setIsUpdating] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const {
    id,
    user,
    organizer,
    payoutConfig,
    payoutDestinations,
    verificationRequest,
    verificationDocs,
    events,
    eventsTruncated,
    stats,
  } = organizerDetails

  const handleToggleStatus = async (action: 'ban' | 'unban' | 'disable_posting' | 'enable_posting') => {
    const actionLabel = action.replace('_', ' ')
    const isDestructive = action === 'ban' || action === 'disable_posting'
    const descriptions: Record<typeof action, string> = {
      ban: `${user.full_name || user.email || 'This organizer'} will lose access and their events will be hidden.`,
      unban: `${user.full_name || user.email || 'This organizer'} will regain access to their account.`,
      disable_posting: `${user.full_name || user.email || 'This organizer'} will no longer be able to create or publish events.`,
      enable_posting: `${user.full_name || user.email || 'This organizer'} will be able to create and publish events again.`,
    }
    const ok = await confirmDialog({
      title: `${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} this organizer?`,
      description: descriptions[action],
      confirmLabel: actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1),
      variant: isDestructive ? 'danger' : 'default',
    })
    if (!ok) {
      return
    }

    setIsUpdating(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/organizer-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerId: id, action }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update organizer')
      }

      setMessage({ type: 'success', text: data.message })
      // Refresh page to show updated data
      window.location.reload()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleVerify = async (verify: boolean) => {
    const name = user.full_name || user.email || 'This organizer'
    const ok = await confirmDialog({
      title: verify ? 'Verify this organizer?' : 'Remove verification?',
      description: verify
        ? `${name} will be marked as a verified organizer (verified badge shown across the platform).`
        : `${name} will no longer be marked as verified.`,
      confirmLabel: verify ? 'Verify' : 'Remove verification',
      variant: verify ? 'default' : 'danger',
    })
    if (!ok) {
      return
    }

    setIsUpdating(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/verify-organizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerId: id, isVerified: verify }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update verification')
      }

      setMessage({ type: 'success', text: data.message || (verify ? 'Organizer verified' : 'Verification removed') })
      // Refresh page to show updated data
      window.location.reload()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsUpdating(false)
    }
  }

  const isBanned = user.status === 'banned'
  const canPost = user.can_create_events !== false
  const isVerified = user.is_verified === true || user.verification_status === 'approved'
  const displayName = user.full_name || user.email || 'Organizer'

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6">
      {/*
        A detail page sits BELOW the hub, not beside it, so it carries no tab
        strip — breadcrumbs are the way back up, and they name the Organizers
        list rather than just People because that is the list you came from.
      */}
      <AdminBreadcrumbs
        items={[
          { label: 'People', href: '/admin/people' },
          { label: 'Organizers', href: '/admin/people/organizers' },
          { label: displayName },
        ]}
      />

      {/* Message */}
      {message && (
        <div className={`mb-5 text-sm ${message.type === 'success' ? 'text-console-green' : 'text-console-red'}`}>
          {message.text}
        </div>
      )}

      {/* Header — mono caps, the console's own voice; state badges beneath. */}
      <div className="mb-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="label-mono text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">
            {user.full_name || 'No name'}
          </h1>
          <p className="mt-1 text-sm text-console-mut">{user.email}</p>
        </div>
        <div className="flex flex-col gap-2 sm:min-w-[200px]">
          {isVerified ? (
            <ConsoleButton variant="quiet" onClick={() => handleVerify(false)} disabled={isUpdating}>
              Remove Verification
            </ConsoleButton>
          ) : (
            <ConsoleButton variant="primary" onClick={() => handleVerify(true)} disabled={isUpdating}>
              Verify Organizer
            </ConsoleButton>
          )}

          {isBanned ? (
            <ConsoleButton variant="quiet" onClick={() => handleToggleStatus('unban')} disabled={isUpdating}>
              Unban Organizer
            </ConsoleButton>
          ) : (
            <ConsoleButton variant="danger" onClick={() => handleToggleStatus('ban')} disabled={isUpdating}>
              Ban Organizer
            </ConsoleButton>
          )}

          {canPost ? (
            <ConsoleButton variant="quiet" onClick={() => handleToggleStatus('disable_posting')} disabled={isUpdating}>
              Disable Event Posting
            </ConsoleButton>
          ) : (
            <ConsoleButton variant="quiet" onClick={() => handleToggleStatus('enable_posting')} disabled={isUpdating}>
              Enable Event Posting
            </ConsoleButton>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
        <span className="label-mono uppercase text-console-mut">{user.role}</span>
        {user.verification_status === 'approved' && (
          <span className="label-mono uppercase text-console-green">Verified</span>
        )}
        {isBanned && <span className="label-mono uppercase text-console-red">Banned</span>}
        {!canPost && <span className="label-mono uppercase text-console-amber">Posting Disabled</span>}
      </div>

      {/* Open user reports against this organizer (renders nothing when none). */}
      <div className="mb-5">
        <AdminReportsPanel kind="organizer" targetId={id} onResolved={() => window.location.reload()} />
      </div>

      <OrganizerStatsStrip stats={stats} />

      {/* Events — full width; the stats above only count them, this shows them */}
      <div className="mb-6">
        <OrganizerEventsList
          events={events ?? []}
          totalEvents={stats.totalEvents}
          truncated={eventsTruncated === true}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrganizerAccountCard id={id} user={user} isBanned={isBanned} canPost={canPost} />

        <OrganizerPayoutSummaryCard payoutConfig={payoutConfig} payoutDestinations={payoutDestinations} />

        {/* Payout Release — per-organizer overrides on the platform thresholds */}
        <OrganizerPayoutReleaseCard organizerId={id} />

        {verificationRequest && <OrganizerVerificationRequestCard verificationRequest={verificationRequest} />}

        {verificationDocs.length > 0 && <OrganizerVerificationDocsCard verificationDocs={verificationDocs} />}

        {organizer && <OrganizerProfileCard organizer={organizer} />}
      </div>
    </div>
  )
}
