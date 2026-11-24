'use client'

/**
 * Community queue (Control Room kit, components/admin/console). Two queues,
 * oldest first:
 *  - Shares: open one to see the flyer and what the member said, edit the
 *    fields, then Publish (credited, claimable, sells nothing), Reject, or
 *    Merge into an existing event id when it is a duplicate.
 *  - Claims: the proof (handle and whether it matches the credited handle, a
 *    link, or a 10-minute signed link to the private uploaded file), then
 *    Approve (the event moves to the claimant's org) or Reject.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ConsoleAge,
  ConsoleButton,
  ConsoleInput,
  ConsolePage,
  ConsolePanel,
  ConsoleRow,
  ConsoleSection,
  ConsoleState,
  useConsoleNow,
} from '@/components/admin/console'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { CATEGORIES } from '@/lib/filters/config'
import { parseSourceUrl } from '@/lib/community/submissions'

interface Submission {
  id: string
  image_url: string
  source_url: string | null
  organizer_name: string
  organizer_handle: string
  note: string
  details: Record<string, any>
  submitted_by: string
  created_at: string
  draft: Record<string, any>
}

interface Claim {
  id: string
  event_id: string
  event_title: string
  source_name: string
  source_handle: string
  org_id: string
  org_name: string
  requested_by: string
  method: string
  instagram_handle: string | null
  handle_matches: boolean
  proof_url: string | null
  proof_view_url: string | null
  has_proof_file: boolean
  message: string
  created_at: string
}

const FIELD_ROWS: Array<Array<{ key: string; label: string; type?: string }>> = [
  [{ key: 'title', label: 'Title' }],
  [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'start_time', label: 'Start', type: 'time' },
    { key: 'end_time', label: 'End', type: 'time' },
  ],
  [
    { key: 'venue_name', label: 'Venue' },
    { key: 'address', label: 'Address' },
  ],
  [
    { key: 'city', label: 'City' },
    { key: 'organizer_name', label: 'Organizer (credit)' },
    { key: 'organizer_handle', label: 'Handle' },
  ],
  [
    { key: 'source_url', label: 'Source link' },
    { key: 'ticket_url', label: 'Ticket link (https)' },
  ],
]

function Label({ children }: { children: React.ReactNode }) {
  return <span className="label-mono mb-1 block text-eyebrow uppercase tracking-[0.14em] text-console-faint">{children}</span>
}

function SubmissionEditor({ sub, onDone }: { sub: Submission; onDone: (msg: string) => void }) {
  const confirm = useConfirm()
  const [f, setF] = useState<Record<string, any>>(() => ({ ...sub.draft }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeId, setMergeId] = useState('')
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }))
  const source = parseSourceUrl(sub.source_url)

  async function act(body: Record<string, any>, done: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/community/submissions/${encodeURIComponent(sub.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error || 'Failed')
        return
      }
      onDone(done)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsolePanel className="mt-2 p-4">
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sub.image_url} alt="Shared flyer" className="w-full rounded bg-console-ground object-contain" />
          <a href={sub.image_url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs text-console-mut underline">
            Open full size
          </a>
          <div className="mt-4 space-y-1 text-xs text-console-mut">
            <p>Shared by {sub.submitted_by || 'deleted account'}</p>
            {source && (
              <p>
                Source:{' '}
                <a href={source} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                  {new URL(source).hostname}
                </a>
              </p>
            )}
            {sub.note && <p className="whitespace-pre-wrap text-console-text">“{sub.note}”</p>}
          </div>
        </div>

        <div className="space-y-3">
          {FIELD_ROWS.map((row, i) => (
            <div key={i} className={`grid gap-2 ${row.length === 3 ? 'sm:grid-cols-3' : row.length === 2 ? 'sm:grid-cols-2' : ''}`}>
              {row.map((c) => (
                <label key={c.key} className="block">
                  <Label>{c.label}</Label>
                  <ConsoleInput type={c.type || 'text'} value={f[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} />
                </label>
              ))}
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <Label>Country</Label>
              <select className="w-full rounded bg-console-ground px-3 py-2 text-meta text-console-text" value={f.country} onChange={(e) => set('country', e.target.value)}>
                {['HT', 'US', 'CA', 'FR'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label>Category</Label>
              <select className="w-full rounded bg-console-ground px-3 py-2 text-meta text-console-text" value={f.category} onChange={(e) => set('category', e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label>Price (info only)</Label>
              <div className="flex gap-2">
                <select
                  className="rounded bg-console-ground px-2 py-2 text-meta text-console-text"
                  value={f.free === true ? 'free' : f.free === false ? 'paid' : ''}
                  onChange={(e) => set('free', e.target.value === 'free' ? true : e.target.value === 'paid' ? false : null)}
                >
                  <option value="">Not said</option>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
                {f.free === false && (
                  <ConsoleInput inputMode="decimal" placeholder={f.currency} value={f.price ?? ''} onChange={(e) => set('price', e.target.value)} />
                )}
              </div>
            </label>
          </div>
          <label className="block">
            <Label>Description</Label>
            <textarea
              rows={4}
              className="w-full rounded bg-console-ground px-3 py-2 text-meta text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut"
              value={f.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>

          {error && <p className="text-xs text-console-red">{error}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ConsoleButton variant="primary" disabled={busy} onClick={() => act({ action: 'approve', fields: f }, 'Published')}>
              Publish as community event
            </ConsoleButton>
            <ConsoleButton
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (await confirm({ title: 'Reject this share?', variant: 'danger' })) act({ action: 'reject' }, 'Rejected')
              }}
            >
              Reject
            </ConsoleButton>
            <div className="ml-auto flex items-center gap-2">
              <ConsoleInput className="w-44" placeholder="Duplicate of event id" value={mergeId} onChange={(e) => setMergeId(e.target.value)} />
              <ConsoleButton disabled={busy || !mergeId.trim()} onClick={() => act({ action: 'merge', event_id: mergeId.trim() }, 'Merged')}>
                Merge
              </ConsoleButton>
            </div>
          </div>
        </div>
      </div>
    </ConsolePanel>
  )
}

function ClaimRow({ claim, now, onDone }: { claim: Claim; now: Date | null; onDone: (msg: string) => void }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proofLink = parseSourceUrl(claim.proof_url)

  async function act(action: 'approve' | 'reject') {
    if (action === 'approve' && !(await confirm({ title: `Move "${claim.event_title}" to ${claim.org_name || claim.org_id}?` }))) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/community/claims/${encodeURIComponent(claim.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error || 'Failed')
        return
      }
      onDone(action === 'approve' ? 'Claim approved' : 'Claim rejected')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsoleRow ageAt={claim.created_at} now={now} className="flex-wrap">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-meta font-semibold text-console-text">
          <a href={`/events/${claim.event_id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {claim.event_title || claim.event_id}
          </a>
          <span className="font-normal text-console-mut"> · credited to {claim.source_name || 'unknown'}</span>
        </p>
        <p className="text-xs text-console-mut">
          By {claim.org_name || claim.org_id} · {claim.method}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {claim.instagram_handle && (
            <ConsoleState tone={claim.handle_matches ? 'good' : 'warn'}>
              @{claim.instagram_handle} {claim.handle_matches ? 'matches the credit' : claim.source_handle ? `credit is @${claim.source_handle}` : 'no handle on the credit'}
            </ConsoleState>
          )}
          {proofLink && (
            <a href={proofLink} target="_blank" rel="noopener noreferrer nofollow" className="text-console-mut underline">
              Proof link
            </a>
          )}
          {claim.proof_view_url ? (
            <a href={claim.proof_view_url} target="_blank" rel="noopener noreferrer" className="text-console-mut underline">
              View uploaded proof (10 min link)
            </a>
          ) : claim.has_proof_file ? (
            <span className="text-console-red">Proof file could not be signed</span>
          ) : null}
        </div>
        {claim.message && <p className="whitespace-pre-wrap text-xs text-console-text">“{claim.message}”</p>}
        {error && <p className="text-xs text-console-red">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ConsoleButton variant="primary" disabled={busy} onClick={() => act('approve')}>
          Approve
        </ConsoleButton>
        <ConsoleButton variant="danger" disabled={busy} onClick={() => act('reject')}>
          Reject
        </ConsoleButton>
        <ConsoleAge ageAt={claim.created_at} now={now} />
      </div>
    </ConsoleRow>
  )
}

export default function CommunityReview() {
  const now = useConsoleNow()
  const [data, setData] = useState<{ submissions: Submission[]; claims: Claim[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/community', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
    } catch {
      setError('The community queue could not be read.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const done = (msg: string) => {
    setFlash(msg)
    setOpen(null)
    void load()
  }

  const subs = data?.submissions || []
  const claims = data?.claims || []

  return (
    <ConsolePage title="Community" sub={data ? `${subs.length} shares · ${claims.length} claims` : undefined}>
      {flash && (
        <p className="mb-3">
          <ConsoleState tone="good">{flash}</ConsoleState>
        </p>
      )}
      {error && (
        <p className="mb-3">
          <ConsoleState tone="bad">{error}</ConsoleState>
        </p>
      )}

      <ConsoleSection>Shared events</ConsoleSection>
      {!data ? (
        <p className="text-meta text-console-faint">Loading…</p>
      ) : subs.length === 0 ? (
        <p className="text-meta text-console-mut">No shares waiting.</p>
      ) : (
        <div className="space-y-1.5">
          {subs.map((s) => (
            <div key={s.id}>
              <ConsoleRow ageAt={s.created_at} now={now} onClick={() => setOpen(open === s.id ? null : s.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.image_url} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-meta font-semibold text-console-text">{s.draft?.title || 'Untitled flyer'}</p>
                  <p className="truncate text-xs text-console-mut">
                    {[s.draft?.date, s.draft?.city, s.organizer_name && `from ${s.organizer_name}`].filter(Boolean).join(' · ') || 'No details given'}
                  </p>
                </div>
                <ConsoleAge ageAt={s.created_at} now={now} />
              </ConsoleRow>
              {open === s.id && <SubmissionEditor sub={s} onDone={done} />}
            </div>
          ))}
        </div>
      )}

      <ConsoleSection>Claims</ConsoleSection>
      {!data ? null : claims.length === 0 ? (
        <p className="text-meta text-console-mut">No claims waiting.</p>
      ) : (
        <div className="space-y-1.5">
          {claims.map((c) => (
            <ClaimRow key={c.id} claim={c} now={now} onDone={done} />
          ))}
        </div>
      )}
    </ConsolePage>
  )
}
