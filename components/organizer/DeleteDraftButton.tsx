'use client'

/**
 * "Delete draft" on the organizer event page: removes a draft that never sold
 * (lib/events/draftDelete), after a confirm. The page passes the server's
 * verdict: `blocked` null shows the quiet action; a code shows it disabled
 * with the reason (the draft has tickets, a printed batch, an order…). The
 * route (app/api/events/[id]/delete-draft) has the last word; its refusal is
 * shown as is.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useToast } from '@/components/ui/Toast'
import type { DraftDeleteBlock } from '@/lib/events/draftDelete'

export default function DeleteDraftButton({
  eventId,
  title,
  blocked,
}: {
  eventId: string
  title?: string
  blocked: DraftDeleteBlock | null
}) {
  const { t } = useTranslation('events')
  const confirm = useConfirm()
  const { showToast } = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const label = t('draftDelete.action', { defaultValue: 'Delete draft' })

  const run = async () => {
    if (busy || blocked) return
    const ok = await confirm({
      title: t('draftDelete.confirmTitle', { defaultValue: 'Delete this draft?' }),
      description: t('draftDelete.confirmBody', {
        name: title || '',
        defaultValue: '“{{name}}” and its ticket types will be removed for good. This can’t be undone.',
      }),
      confirmLabel: t('draftDelete.confirm', { defaultValue: 'Delete draft' }),
      cancelLabel: t('draftDelete.keep', { defaultValue: 'Keep it' }),
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/delete-draft`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = data?.code ? t(`draftDelete.reasons.${data.code}`, { defaultValue: '' }) : ''
        throw new Error(reason || data?.error || t('draftDelete.failed', { defaultValue: 'Could not delete this draft.' }))
      }
      showToast({ type: 'success', title: t('draftDelete.done', { defaultValue: 'Draft deleted' }), duration: 3000 })
      router.push('/organizer/events')
      router.refresh()
    } catch (err: any) {
      showToast({
        type: 'error',
        title: t('draftDelete.failed', { defaultValue: 'Could not delete this draft.' }),
        message: err?.message,
        duration: 5000,
      })
      setBusy(false)
    }
  }

  const reason = blocked ? t(`draftDelete.reasons.${blocked}`, { defaultValue: '' }) : ''

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy || !!blocked}
        aria-describedby={reason ? `delete-draft-reason-${eventId}` : undefined}
        className="flex h-10 w-full items-center justify-center gap-2 rounded text-sm font-medium text-danger-soft transition-colors hover:bg-danger-strong/10 disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {label}
      </button>
      {reason ? (
        <p id={`delete-draft-reason-${eventId}`} className="mt-1 text-center text-xs text-fg-subtle">
          {reason}
        </p>
      ) : null}
    </div>
  )
}
