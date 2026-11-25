'use client'

import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import {
  ConsoleButton,
  ConsoleInput,
  ConsolePanel,
  ConsoleSection,
  ConsoleState,
  type ConsoleTone,
} from '@/components/admin/console'
import { validateDoorTeamConfig, type DoorTeamConfig } from '@/lib/doorTeam/config'

/**
 * The admin face of config/door_team and of the door team queue.
 *
 * Pricing is validated here with the SAME function the API uses, so the form
 * refuses exactly what the server would. In the queue, a request is quoted at
 * the standard price or a negotiated one (note required), declined with a
 * reason the organizer sees, staffed with Tikèm crew accounts (by email),
 * confirmed, and closed.
 */

interface AdminRequest {
  id: string
  eventId: string
  eventTitle: string
  eventStartAt: string | null
  status: string
  staffCount: number
  hours: number
  arrivalAt: string | null
  notes: string
  contactName: string
  contactPhone: string
  standardHtg: number
  priceHtg: number | null
  priceKind: string | null
  quoteNote: string
  declineReason: string
  fundsRail: string | null
  paymentStatus: string | null
  crew: Array<{ uid: string; firstName: string }>
  needsRefund: boolean
  refund: { rail?: string; amount?: number; currency?: string; status?: string } | null
  latePayments: Array<{ funds_rail: string; amount: number; currency: string; reference: string }>
  createdAt: string
}

const RAIL: Record<string, string> = { moncash: 'MonCash', stripe_platform: 'Card (platform)', balance_offset: 'Organizer balance' }

const LABEL: Record<string, string> = {
  requested: 'Needs a quote',
  quoted: 'Quoted, awaiting payment',
  paid: 'Paid, assign crew',
  confirmed: 'Confirmed',
  done: 'Done',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Quote expired',
}

function tone(status: string): ConsoleTone {
  if (status === 'requested' || status === 'paid') return 'warn'
  if (status === 'confirmed' || status === 'done') return 'good'
  if (status === 'declined') return 'bad'
  return 'neutral'
}

const nf = (n: number) => new Intl.NumberFormat('en-US').format(n)
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Port-au-Prince' }) : '—'

const NUMBER_FIELDS: Array<{ key: keyof DoorTeamConfig; label: string }> = [
  { key: 'ratePerStaffHtg', label: 'HTG per staff (included hours)' },
  { key: 'includedHours', label: 'Included hours' },
  { key: 'extraHourPerStaffHtg', label: 'HTG per staff per extra hour' },
  { key: 'volumeMinStaff', label: 'Volume price from (staff)' },
  { key: 'volumeRatePerStaffHtg', label: 'Volume HTG per staff' },
  { key: 'minStaff', label: 'Minimum crew' },
  { key: 'maxStaff', label: 'Maximum crew' },
  { key: 'maxHours', label: 'Longest shift (hours)' },
  { key: 'minLeadHours', label: 'Notice before the event (hours)' },
  { key: 'refundCutoffHours', label: 'Refund if cancelled (hours before)' },
]

type Draft = Record<string, string> & { enabled: string }

function toDraft(c: DoorTeamConfig): Draft {
  const d: Record<string, string> = { enabled: c.enabled ? '1' : '' }
  for (const f of NUMBER_FIELDS) d[f.key] = String(c[f.key] ?? '')
  return d as Draft
}

function fromDraft(d: Draft) {
  const out: Record<string, unknown> = { enabled: d.enabled === '1' }
  for (const f of NUMBER_FIELDS) out[f.key] = Number(d[f.key])
  return out
}

export function DoorTeamAdmin() {
  const [config, setConfig] = useState<DoorTeamConfig | null>(null)
  const [defaults, setDefaults] = useState<DoorTeamConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: ConsoleTone; text: string } | null>(null)
  const [requests, setRequests] = useState<AdminRequest[] | null>(null)
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const loadAll = useCallback(async () => {
    const [c, q] = await Promise.all([
      fetch('/api/admin/door-team/config', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/door-team/requests', { cache: 'no-store' }).then((r) => r.json()),
    ])
    if (c?.config) {
      setConfig(c.config)
      setDefaults(c.defaults)
      setDraft(toDraft(c.config))
    }
    setRequests(Array.isArray(q?.requests) ? q.requests : [])
  }, [])

  useEffect(() => {
    void loadAll().catch(() => setMessage({ tone: 'bad', text: 'Could not load the door team.' }))
  }, [loadAll])

  const check = draft ? validateDoorTeamConfig(fromDraft(draft)) : null
  const dirty = draft && config ? JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(config))) : false

  const save = async () => {
    if (!draft || !check?.ok) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/door-team/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fromDraft(draft)),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Save failed')
      setConfig(data.config)
      setDraft(toDraft(data.config))
      setMessage({ tone: 'good', text: 'Saved. New requests are quoted with these prices.' })
    } catch (e: any) {
      setMessage({ tone: 'bad', text: String(e?.message || 'Save failed') })
    } finally {
      setSaving(false)
    }
  }

  const shown = (requests || []).filter(
    (r) => filter === 'all' || ['requested', 'quoted', 'paid', 'confirmed'].includes(r.status) || r.needsRefund
  )

  return (
    <div>
      {message && (
        <div className="mb-4">
          <ConsoleState tone={message.tone}>{message.text}</ConsoleState>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <ConsoleSection>Requests</ConsoleSection>
        <div className="flex gap-2">
          {(['open', 'all'] as const).map((f) => (
            <ConsoleButton key={f} variant={filter === f ? 'primary' : 'quiet'} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {f === 'open' ? 'Open' : 'All'}
            </ConsoleButton>
          ))}
        </div>
      </div>
      {requests === null ? (
        <p className="text-meta text-console-mut">Loading…</p>
      ) : shown.length === 0 ? (
        <ConsolePanel className="p-5">
          <p className="text-meta text-console-mut">{filter === 'open' ? 'Nothing waiting.' : 'No requests yet.'}</p>
        </ConsolePanel>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <RequestRow key={r.id} r={r} onDone={async (text) => { setMessage(text ? { tone: 'good', text } : null); await loadAll() }} onError={(text) => setMessage({ tone: 'bad', text })} />
          ))}
        </div>
      )}

      <div className="mt-7">
        <ConsoleSection>Pricing</ConsoleSection>
      </div>
      <ConsolePanel className="p-5">
        {!draft ? (
          <p className="text-meta text-console-mut">Loading…</p>
        ) : (
          <div className="space-y-5">
            <label className="flex items-center gap-3 text-meta text-console-text">
              <input
                type="checkbox"
                checked={draft.enabled === '1'}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked ? '1' : '' })}
                className="h-4 w-4 accent-console-green"
              />
              Organizers can request a door team
            </label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {NUMBER_FIELDS.map((f) => (
                <label key={f.key} className="block text-meta text-console-mut">
                  {f.label}
                  <ConsoleInput
                    type="number"
                    min={0}
                    step={1}
                    value={draft[f.key]}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    className="mt-1"
                  />
                </label>
              ))}
            </div>
            {check && !check.ok && <ConsoleState tone="bad">{check.error}</ConsoleState>}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <ConsoleButton variant="primary" disabled={!dirty || saving || !check?.ok} onClick={save}>
                {saving ? 'Saving…' : 'Save prices'}
              </ConsoleButton>
              {defaults && (
                <ConsoleButton className="inline-flex items-center justify-center gap-2" onClick={() => setDraft(toDraft(defaults))}>
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
    </div>
  )
}

function RequestRow({ r, onDone, onError }: { r: AdminRequest; onDone: (message?: string) => Promise<void>; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [email, setEmail] = useState('')
  const [reference, setReference] = useState('')

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/door-team/requests/${r.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed')
      setEmail('')
      await onDone(success)
    } catch (e: any) {
      onError(String(e?.message || 'Failed'))
    } finally {
      setBusy(false)
    }
  }

  const negotiated = price.trim() !== '' && Number(price) !== r.standardHtg

  return (
    <ConsolePanel className="px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-meta font-semibold text-console-text sm:truncate">
            {r.eventTitle || r.eventId} · {r.staffCount} staff × {r.hours}h
          </p>
          <p className="label-mono text-xs tabular-nums text-console-faint">
            Arrive {when(r.arrivalAt)} · event {when(r.eventStartAt)} · standard {nf(r.standardHtg)} HTG
            {r.priceHtg != null ? ` · price ${nf(r.priceHtg)} HTG${r.priceKind === 'negotiated' ? ' (negotiated)' : ''}` : ''}
            {r.fundsRail ? ` · ${RAIL[r.fundsRail] || r.fundsRail}` : ''}
          </p>
          <p className="mt-1 break-words text-xs text-console-mut">
            On site: {r.contactName} {r.contactPhone}
            {r.notes ? ` · ${r.notes}` : ''}
          </p>
          {r.quoteNote && <p className="mt-1 break-words text-xs text-console-mut">Quote note: {r.quoteNote}</p>}
          {r.declineReason && <p className="mt-1 break-words text-xs text-console-mut">Declined: {r.declineReason}</p>}
        </div>
        <div className="shrink-0">
          <ConsoleState tone={tone(r.status)}>{LABEL[r.status] || r.status}</ConsoleState>
        </div>
      </div>

      {r.needsRefund && (
        <div className="mt-3 space-y-2">
          <ConsoleState tone="bad">
            Refund due:{' '}
            {r.latePayments.length
              ? r.latePayments.map((p) => `${nf(p.amount)} ${p.currency} by ${RAIL[p.funds_rail] || p.funds_rail} (${p.reference})`).join('; ')
              : `${r.refund?.amount != null ? nf(Number(r.refund.amount)) : ''} ${r.refund?.currency || ''} by ${RAIL[String(r.refund?.rail)] || r.refund?.rail || 'original method'}`}
          </ConsoleState>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ConsoleInput placeholder="Refund reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            <ConsoleButton variant="primary" className="shrink-0" disabled={busy} onClick={() => act({ action: 'mark_refunded', reference }, 'Marked refunded.')}>
              Mark refunded
            </ConsoleButton>
          </div>
        </div>
      )}

      {r.status === 'requested' && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
            <ConsoleInput type="number" min={1} step={1} placeholder={`${nf(r.standardHtg)} HTG`} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Negotiated price in HTG" />
            <ConsoleInput placeholder={negotiated ? 'Note for the organizer (required)' : 'Note for the organizer (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <ConsoleButton
              variant="primary"
              disabled={busy || (negotiated && note.trim().length < 3)}
              onClick={() => act(negotiated ? { action: 'quote', priceHtg: Number(price), note } : { action: 'quote', note }, 'Quote sent.')}
            >
              {negotiated ? `Send ${nf(Number(price) || 0)} HTG quote` : `Accept at ${nf(r.standardHtg)} HTG`}
            </ConsoleButton>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ConsoleInput placeholder="Reason, if declining" value={reason} onChange={(e) => setReason(e.target.value)} />
            <ConsoleButton variant="danger" className="shrink-0" disabled={busy || reason.trim().length < 3} onClick={() => act({ action: 'decline', reason }, 'Declined.')}>
              Decline
            </ConsoleButton>
          </div>
        </div>
      )}

      {r.status === 'quoted' && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <ConsoleInput placeholder="Reason, to withdraw the quote" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ConsoleButton variant="danger" className="shrink-0" disabled={busy || reason.trim().length < 3} onClick={() => act({ action: 'decline', reason }, 'Quote withdrawn.')}>
            Withdraw
          </ConsoleButton>
        </div>
      )}

      {(r.status === 'paid' || r.status === 'confirmed') && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs text-console-faint">
              Crew {r.crew.length}/{r.staffCount} · door check-in only, no attendee list, access from a day before arrival to 6h after
            </p>
            {r.crew.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {r.crew.map((c) => (
                  <li key={c.uid} className="inline-flex items-center gap-1 rounded bg-console-raise py-1 pl-3 pr-1 text-meta text-console-text">
                    {c.firstName}
                    <button
                      type="button"
                      aria-label={`Remove ${c.firstName}`}
                      disabled={busy}
                      onClick={() => act({ action: 'remove_crew', uid: c.uid }, 'Crew member removed.')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-console-mut hover:text-console-text focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {r.crew.length < r.staffCount && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <ConsoleInput type="email" placeholder="Crew member's Tikèm email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <ConsoleButton className="shrink-0" disabled={busy || !email.includes('@')} onClick={() => act({ action: 'assign_crew', email }, 'Crew member added.')}>
                Add to door
              </ConsoleButton>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {r.status === 'paid' && (
              <ConsoleButton variant="primary" disabled={busy || r.crew.length === 0} onClick={() => act({ action: 'confirm' }, 'Confirmed. The organizer has the crew names.')}>
                Confirm crew
              </ConsoleButton>
            )}
            {r.status === 'confirmed' && (
              <ConsoleButton disabled={busy} onClick={() => act({ action: 'done' }, 'Closed. Crew access removed.')}>
                Mark done
              </ConsoleButton>
            )}
          </div>
        </div>
      )}
    </ConsolePanel>
  )
}
