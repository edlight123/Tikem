'use client'

/**
 * Open user reports on one event or organizer, with the three resolutions an
 * admin needs to act within Apple's 24-hour expectation (guideline 1.2):
 * dismiss, unpublish the event, or ban the organizer. Backed by
 * /api/admin/reports (lib/moderation/reports.ts).
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { ConsoleButton } from '@/components/admin/console'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useToast } from '@/components/ui/Toast'

type Report = { id: string; reason: string; details: string; reporter_uid: string; created_at: string }

const REASON_LABEL: Record<string, string> = {
  spam: 'Spam',
  scam_or_fraud: 'Scam or fraud',
  offensive: 'Hateful or offensive',
  violence: 'Violence or threats',
  sexual: 'Sexual content',
  illegal: 'Illegal activity',
  misleading: 'Misleading or fake',
  other: 'Other',
}

function when(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : format(d, 'MMM d, h:mm a')
}

export function AdminReportsPanel({
  kind,
  targetId,
  hiddenPendingReview,
  onResolved,
}: {
  kind: 'event' | 'organizer'
  targetId: string
  hiddenPendingReview?: boolean
  onResolved?: () => void
}) {
  const confirmDialog = useConfirm()
  const { showToast } = useToast()
  const [reports, setReports] = useState<Report[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/reports?kind=${kind}&targetId=${encodeURIComponent(targetId)}`)
      const data = await res.json().catch(() => ({}))
      setReports(res.ok ? (data.reports as Report[]) || [] : [])
    } catch {
      setReports([])
    }
  }, [kind, targetId])

  useEffect(() => {
    void load()
  }, [load])

  const resolve = async (action: 'dismiss' | 'unpublish' | 'ban_organizer') => {
    const copy = {
      dismiss: {
        title: 'Dismiss these reports?',
        description:
          kind === 'event'
            ? 'The reports are closed with no action. The event leaves the Reported tab and, if it was auto-hidden, returns to Explore.'
            : 'The reports are closed with no action.',
        confirmLabel: 'Dismiss reports',
        variant: 'default' as const,
      },
      unpublish: {
        title: 'Unpublish this event?',
        description: 'The event is taken down and the reports are closed as actioned.',
        confirmLabel: 'Unpublish',
        variant: 'danger' as const,
      },
      ban_organizer: {
        title: 'Ban this organizer?',
        description:
          'The organizer loses posting rights, every published event of theirs is unpublished, and these reports are closed as actioned.',
        confirmLabel: 'Ban organizer',
        variant: 'danger' as const,
      },
    }[action]
    const ok = await confirmDialog(copy)
    if (!ok) return

    setBusy(true)
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, targetId, action, note: note.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      showToast({ type: 'success', title: 'Reports resolved', message: `${data.resolved ?? 0} report(s) closed.` })
      setNote('')
      await load()
      onResolved?.()
    } catch (e: any) {
      showToast({ type: 'error', title: 'Action failed', message: e?.message || 'Unknown error' })
    } finally {
      setBusy(false)
    }
  }

  // Nothing while loading or when there is nothing open: on the organizer page
  // this panel is present for every organizer and must not add a flash of chrome.
  if (!reports || reports.length === 0) return null

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-console-amber" />
        <h4 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-amber">
          Open reports ({reports.length})
        </h4>
      </div>
      {hiddenPendingReview && (
        <p className="mb-3 flex items-center gap-2 text-xs text-console-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-console-amber" />
          Hidden from Explore pending review (auto, after repeated reports)
        </p>
      )}
      <div className="space-y-2">
        {reports.map((r) => (
          <div key={r.id} className="rounded-md bg-console-ground p-3">
            <div className="text-sm font-medium text-console-text">{REASON_LABEL[r.reason] || r.reason}</div>
            {r.details && <p className="mt-1 whitespace-pre-wrap text-sm text-console-mut">{r.details}</p>}
            <div className="mt-1 text-xs text-console-faint">
              <a href={`/admin/people/${r.reporter_uid}`} className="hover:text-console-text">
                Reporter {r.reporter_uid.slice(0, 8)}
              </a>
              {r.created_at ? ` • ${when(r.created_at)}` : ''}
            </div>
          </div>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note (optional)"
        rows={2}
        className="mt-3 w-full resize-none rounded bg-console-ground px-3 py-2 text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <ConsoleButton onClick={() => resolve('dismiss')} disabled={busy}>
          Dismiss
        </ConsoleButton>
        {kind === 'event' && (
          <ConsoleButton variant="danger" onClick={() => resolve('unpublish')} disabled={busy}>
            Unpublish event
          </ConsoleButton>
        )}
        <ConsoleButton variant="danger" onClick={() => resolve('ban_organizer')} disabled={busy}>
          Ban organizer
        </ConsoleButton>
      </div>
    </div>
  )
}
