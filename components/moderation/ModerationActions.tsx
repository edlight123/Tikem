'use client'

/**
 * Quiet report / block controls for the public event and organizer pages
 * (App Store guideline 1.2). Deliberately low-key text actions: they must be
 * findable by anyone who needs them without competing with Buy or Follow.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Flag, Ban } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'
import { useToast } from '@/components/ui/Toast'
import ReportSheet from './ReportSheet'

function useLoginRedirect() {
  const router = useRouter()
  return () => {
    const redirectTo = `${window.location.pathname}${window.location.search || ''}`
    router.push(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`)
  }
}

const QUIET =
  'inline-flex items-center gap-1.5 text-[13px] text-white/45 transition-colors hover:text-white/80 disabled:opacity-50'

export function ReportButton({
  kind,
  targetId,
  userId,
  className = '',
}: {
  kind: 'event' | 'organizer'
  targetId: string
  userId: string | null | undefined
  className?: string
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const toLogin = useLoginRedirect()
  return (
    <>
      <button
        type="button"
        className={`${QUIET} ${className}`}
        onClick={() => (userId ? setOpen(true) : toLogin())}
      >
        <Flag className="h-3.5 w-3.5" aria-hidden />
        {kind === 'event' ? t('moderation.report_event') : t('moderation.report_organizer')}
      </button>
      <ReportSheet isOpen={open} onClose={() => setOpen(false)} kind={kind} targetId={targetId} />
    </>
  )
}

export function BlockOrganizerButton({
  organizerId,
  organizerName,
  userId,
  initialBlocked,
  className = '',
}: {
  organizerId: string
  organizerName: string
  userId: string | null | undefined
  initialBlocked: boolean
  className?: string
}) {
  const { t } = useTranslation('common')
  const { showToast } = useToast()
  const router = useRouter()
  const toLogin = useLoginRedirect()
  const [blocked, setBlocked] = useState(initialBlocked)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = async () => {
    const next = !blocked
    setBusy(true)
    // Optimistic: the page reflects the block at once; rolled back on failure.
    setBlocked(next)
    setConfirming(false)
    try {
      const res = await fetch(`/api/users/me/blocks/${encodeURIComponent(organizerId)}`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error(String(res.status))
      showToast({
        type: 'success',
        title: next ? t('moderation.blocked_toast') : t('moderation.unblocked_toast'),
        message: next ? t('moderation.blocked_toast_body') : '',
        duration: 3500,
      })
      // Feeds, follow state and counts are server-rendered: refresh them.
      router.refresh()
    } catch {
      setBlocked(!next)
      showToast({ type: 'error', title: t('moderation.errors.generic'), message: '', duration: 4000 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${QUIET} ${className}`}
        disabled={busy}
        onClick={() => (userId ? setConfirming(true) : toLogin())}
      >
        <Ban className="h-3.5 w-3.5" aria-hidden />
        {blocked ? t('moderation.unblock') : t('moderation.block')}
      </button>
      <BottomSheet
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        title={
          blocked
            ? t('moderation.unblock_confirm_title', { name: organizerName })
            : t('moderation.block_confirm_title', { name: organizerName })
        }
      >
        <p className="text-[15px] leading-relaxed text-white/70">
          {blocked ? t('moderation.unblock_confirm_body') : t('moderation.block_confirm_body')}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-12 flex-1 rounded-xl bg-white/[0.08] text-[15px] font-semibold text-white hover:bg-white/[0.12]"
          >
            {t('moderation.cancel')}
          </button>
          <button
            type="button"
            onClick={apply}
            className={`h-12 flex-1 rounded-xl text-[15px] font-semibold ${blocked ? 'bg-white text-black' : 'bg-red-500 text-white'} hover:opacity-90`}
          >
            {blocked ? t('moderation.unblock') : t('moderation.block')}
          </button>
        </div>
      </BottomSheet>
    </>
  )
}
