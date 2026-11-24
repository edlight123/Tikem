'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  ConsoleButton,
  ConsoleInput,
  ConsolePanel,
  ConsoleSection,
  ConsoleState,
  type ConsoleTone,
} from '@/components/admin/console'
import { validatePhysicalConfig, type PhysicalTicketsConfig } from '@/lib/physical/config'

/**
 * The admin face of config/physical_tickets and of the print room.
 *
 * Pricing: one row per volume tier (from-quantity, HTG per ticket), the minimum
 * and maximum batch, and the on/off switch. Validated here with the SAME
 * function the API uses, so the form refuses exactly what the server would.
 */

interface AdminBatch {
  id: string
  eventId: string
  eventTitle: string
  tierName: string
  quantity: number
  totalHtg: number
  status: string
  paymentMethod: string
  fundsRail: string
  reprintCount: number
  createdAt: string
  paidAt: string | null
}

const NEXT: Record<string, { to: string; label: string } | undefined> = {
  paid: { to: 'printing', label: 'Mark printing' },
  printing: { to: 'ready', label: 'Mark ready' },
  ready: { to: 'active', label: 'Mark selling' },
}

const RAIL: Record<string, string> = { moncash: 'MonCash', stripe_platform: 'Card (platform)' }

const LABEL: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid, to print',
  printing: 'Printing',
  ready: 'Ready',
  active: 'Selling',
  cancelled: 'Cancelled',
}

function tone(status: string): ConsoleTone {
  if (status === 'paid' || status === 'printing') return 'warn'
  if (status === 'ready' || status === 'active') return 'good'
  if (status === 'cancelled') return 'bad'
  return 'neutral'
}

const nf = (n: number) => new Intl.NumberFormat('en-US').format(n)

type Draft = { enabled: boolean; minBatch: string; maxBatch: string; tiers: Array<{ minQty: string; price: string }> }

function toDraft(c: PhysicalTicketsConfig): Draft {
  return {
    enabled: c.enabled,
    minBatch: String(c.minBatch),
    maxBatch: String(c.maxBatch),
    tiers: c.tiers.map((t) => ({ minQty: String(t.minQty), price: String(t.priceHtgPerTicket) })),
  }
}

function fromDraft(d: Draft) {
  return {
    enabled: d.enabled,
    minBatch: Number(d.minBatch),
    maxBatch: Number(d.maxBatch),
    tiers: d.tiers.map((t) => ({ minQty: Number(t.minQty), priceHtgPerTicket: Number(t.price) })),
  }
}

export function PrintedTicketsAdmin() {
  const [config, setConfig] = useState<PhysicalTicketsConfig | null>(null)
  const [defaults, setDefaults] = useState<PhysicalTicketsConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: ConsoleTone; text: string } | null>(null)
  const [batches, setBatches] = useState<AdminBatch[] | null>(null)
  const [busyBatch, setBusyBatch] = useState<string | null>(null)
  const [paper, setPaper] = useState<'letter' | 'a4'>('letter')

  const loadAll = useCallback(async () => {
    const [c, b] = await Promise.all([
      fetch('/api/admin/physical-tickets/config', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/physical-tickets/batches', { cache: 'no-store' }).then((r) => r.json()),
    ])
    if (c?.config) {
      setConfig(c.config)
      setDefaults(c.defaults)
      setDraft(toDraft(c.config))
    }
    setBatches(Array.isArray(b?.batches) ? b.batches : [])
  }, [])

  useEffect(() => {
    void loadAll().catch(() => setMessage({ tone: 'bad', text: 'Could not load printed tickets.' }))
  }, [loadAll])

  const check = draft ? validatePhysicalConfig(fromDraft(draft)) : null

  const save = async () => {
    if (!draft || !check?.ok) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/physical-tickets/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fromDraft(draft)),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Save failed')
      setConfig(data.config)
      setDraft(toDraft(data.config))
      setMessage({ tone: 'good', text: 'Saved. New orders use these prices.' })
    } catch (e: any) {
      setMessage({ tone: 'bad', text: String(e?.message || 'Save failed') })
    } finally {
      setSaving(false)
    }
  }

  const batchAction = async (id: string, body: Record<string, unknown>) => {
    setBusyBatch(id)
    try {
      const res = await fetch(`/api/admin/physical-tickets/batches/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed')
      if (body.action === 'reprint') setMessage({ tone: 'good', text: `${nf(data.reissued || 0)} tickets got new codes. Download the new PDF.` })
      await loadAll()
    } catch (e: any) {
      setMessage({ tone: 'bad', text: String(e?.message || 'Failed') })
    } finally {
      setBusyBatch(null)
    }
  }

  const dirty = draft && config ? JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(config))) : false

  return (
    <div>
      {message && (
        <div className="mb-4">
          <ConsoleState tone={message.tone}>{message.text}</ConsoleState>
        </div>
      )}

      <ConsoleSection>Pricing</ConsoleSection>
      <ConsolePanel className="p-5">
        {!draft ? (
          <p className="text-meta text-console-mut">Loading…</p>
        ) : (
          <div className="space-y-5">
            <label className="flex items-center gap-3 text-meta text-console-text">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="h-4 w-4 accent-console-green"
              />
              Organizers can order printed tickets
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-meta text-console-mut">
                Minimum batch (tickets)
                <ConsoleInput type="number" min={1} value={draft.minBatch} onChange={(e) => setDraft({ ...draft, minBatch: e.target.value })} className="mt-1" />
              </label>
              <label className="block text-meta text-console-mut">
                Maximum batch (tickets)
                <ConsoleInput type="number" min={1} value={draft.maxBatch} onChange={(e) => setDraft({ ...draft, maxBatch: e.target.value })} className="mt-1" />
              </label>
            </div>

            <div>
              <p className="mb-2 text-meta text-console-mut">Volume tiers: price per ticket, paid upfront</p>
              <div className="space-y-2">
                {draft.tiers.map((row, i) => (
                  <div key={i} className="flex items-end gap-3">
                    <label className="block flex-1 text-xs text-console-faint">
                      From (tickets)
                      <ConsoleInput
                        type="number"
                        min={1}
                        value={row.minQty}
                        onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((r, j) => (j === i ? { ...r, minQty: e.target.value } : r)) })}
                        className="mt-1"
                      />
                    </label>
                    <label className="block flex-1 text-xs text-console-faint">
                      HTG per ticket
                      <ConsoleInput
                        type="number"
                        min={0}
                        step="0.5"
                        value={row.price}
                        onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)) })}
                        className="mt-1"
                      />
                    </label>
                    <ConsoleButton
                      variant="danger"
                      aria-label="Remove tier"
                      disabled={draft.tiers.length <= 1}
                      onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </ConsoleButton>
                  </div>
                ))}
              </div>
              <ConsoleButton
                className="mt-3 inline-flex items-center gap-2"
                onClick={() => {
                  const last = draft.tiers[draft.tiers.length - 1]
                  setDraft({ ...draft, tiers: [...draft.tiers, { minQty: String((Number(last?.minQty) || 0) + 500), price: last?.price || '' }] })
                }}
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} /> Add tier
              </ConsoleButton>
            </div>

            {check && !check.ok && <ConsoleState tone="bad">{check.error}</ConsoleState>}

            <div className="flex flex-wrap items-center gap-3">
              <ConsoleButton variant="primary" disabled={!dirty || saving || !check?.ok} onClick={save}>
                {saving ? 'Saving…' : 'Save prices'}
              </ConsoleButton>
              {defaults && (
                <ConsoleButton className="inline-flex items-center gap-2" onClick={() => setDraft(toDraft(defaults))}>
                  <RotateCcw className="h-4 w-4" strokeWidth={1.75} /> Reset to defaults
                </ConsoleButton>
              )}
              {config?.updated_at && (
                <span className="label-mono text-xs text-console-faint">
                  Last changed {new Date(config.updated_at).toLocaleString('en-US')} by {config.updated_by_email || config.updated_by}
                </span>
              )}
            </div>
          </div>
        )}
      </ConsolePanel>

      <div className="mt-7 flex flex-wrap items-baseline justify-between gap-3">
        <ConsoleSection>Print room</ConsoleSection>
        <label className="flex items-center gap-2 text-xs text-console-mut">
          Paper
          <select
            value={paper}
            onChange={(e) => setPaper(e.target.value === 'a4' ? 'a4' : 'letter')}
            className="rounded bg-console-raise px-2 py-1 text-xs text-console-text focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
          >
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
      </div>
      {batches === null ? (
        <p className="text-meta text-console-mut">Loading…</p>
      ) : batches.length === 0 ? (
        <ConsolePanel className="p-5">
          <p className="text-meta text-console-mut">No batches ordered yet.</p>
        </ConsolePanel>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => {
            const next = NEXT[b.status]
            const printable = !['awaiting_payment', 'cancelled'].includes(b.status)
            return (
              <ConsolePanel key={b.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-meta font-semibold text-console-text">
                    {b.eventTitle || b.eventId} · {nf(b.quantity)} × {b.tierName}
                  </p>
                  <p className="label-mono text-xs tabular-nums text-console-faint">
                    {nf(b.totalHtg)} HTG · {RAIL[b.fundsRail] || b.paymentMethod || 'not paid'} · {b.createdAt.slice(0, 10)}
                    {b.reprintCount ? ` · reprinted ${b.reprintCount}×` : ''}
                  </p>
                </div>
                <ConsoleState tone={tone(b.status)}>{LABEL[b.status] || b.status}</ConsoleState>
                <div className="flex flex-wrap gap-2">
                  {printable && (
                    <a
                      href={`/api/admin/physical-tickets/batches/${b.id}/pdf?paper=${paper}`}
                      className="inline-flex items-center gap-2 rounded bg-console-raise px-4 py-2 text-meta font-semibold text-console-mut transition-colors hover:text-console-text focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
                    >
                      <Download className="h-4 w-4" strokeWidth={1.75} /> PDF
                    </a>
                  )}
                  {printable && (
                    <ConsoleButton
                      disabled={busyBatch === b.id}
                      onClick={() => {
                        if (window.confirm('Reprint? Every unsold ticket gets a new code and the old sheets stop scanning.')) {
                          void batchAction(b.id, { action: 'reprint' })
                        }
                      }}
                    >
                      Reprint
                    </ConsoleButton>
                  )}
                  {next && (
                    <ConsoleButton variant="primary" disabled={busyBatch === b.id} onClick={() => batchAction(b.id, { action: 'move', to: next.to })}>
                      {next.label}
                    </ConsoleButton>
                  )}
                </div>
              </ConsolePanel>
            )
          })}
        </div>
      )}
    </div>
  )
}
