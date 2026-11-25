'use client'

/**
 * At the door: the add-ons a scanned ticket's order bought (a bottle package,
 * parking, a T-shirt in M…), with a "picked up" toggle per line. A bar over
 * the scan result, like the pay-at-the-door bar (components/scan/DoorCollectBar).
 * Reads and writes through /api/staff/events/[id]/add-ons/pickup: tickets are
 * never written from a client.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

export interface DoorAddOnItem {
  index: number
  name: string
  option: string | null
  quantity: number
  pickedUp: boolean
}

export default function AddOnsHandover({
  eventId,
  ticketId,
  onClose,
}: {
  eventId: string
  ticketId: string
  onClose?: () => void
}) {
  const { t } = useTranslation('events')
  const [items, setItems] = useState<DoorAddOnItem[] | null>(null)
  const [carrierId, setCarrierId] = useState<string>(ticketId)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/staff/events/${encodeURIComponent(eventId)}/add-ons/pickup?ticketId=${encodeURIComponent(ticketId)}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'failed')
      setItems(data?.addOns?.items || [])
      if (data?.addOns?.ticketId) setCarrierId(String(data.addOns.ticketId))
    } catch {
      setItems([])
      setError(t('addOns.door.loadFailed', { defaultValue: "Couldn't load this order's add-ons." }))
    }
  }, [eventId, ticketId, t])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (item: DoorAddOnItem) => {
    setBusy(item.index)
    setError(null)
    try {
      const res = await fetch(`/api/staff/events/${encodeURIComponent(eventId)}/add-ons/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: carrierId, index: item.index, pickedUp: !item.pickedUp }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'failed')
      setItems(data?.addOns?.items || [])
    } catch {
      setError(t('addOns.door.saveFailed', { defaultValue: "Couldn't save. Try again." }))
    } finally {
      setBusy(null)
    }
  }

  if (items === null) return null
  if (items.length === 0 && !error) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] bg-surface-raised-solid px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 text-fg">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between gap-3">
          <div className="text-eyebrow font-bold uppercase tracking-[0.12em] text-fg-muted">
            {t('addOns.door.title', { defaultValue: 'Add-ons to hand over' })}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('addOns.door.close', { defaultValue: 'Close' })}
              className="-mr-2 flex h-10 w-10 items-center justify-center rounded text-fg-muted hover:bg-surface-high"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <ul className="mt-1">
          {items.map((item) => (
            <li key={item.index} className="flex min-h-12 items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-body text-fg">
                  <span className="font-semibold tabular-nums">{item.quantity}×</span> {item.name}
                  {item.option ? <span className="text-fg-muted"> ({item.option})</span> : null}
                </span>
                <span
                  className={`mt-0.5 inline-flex items-center gap-1.5 text-caption ${item.pickedUp ? 'text-success' : 'text-fg-subtle'}`}
                >
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${item.pickedUp ? 'bg-success' : 'bg-warning'}`} />
                  {item.pickedUp
                    ? t('addOns.door.pickedUp', { defaultValue: 'Picked up' })
                    : t('addOns.door.toHandOver', { defaultValue: 'To hand over' })}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={busy === item.index}
                aria-pressed={item.pickedUp}
                className={`h-10 shrink-0 rounded px-4 text-sm font-semibold transition-colors disabled:opacity-60 ${
                  item.pickedUp
                    ? 'bg-surface-high text-fg hover:bg-surface'
                    : 'bg-inverse text-on-inverse hover:bg-inverse-hover'
                }`}
              >
                {item.pickedUp
                  ? t('addOns.door.undo', { defaultValue: 'Undo' })
                  : t('addOns.door.markPickedUp', { defaultValue: 'Hand over' })}
              </button>
            </li>
          ))}
        </ul>
        {error && <div className="mt-1 text-caption text-danger-soft">{error}</div>}
      </div>
    </div>
  )
}
