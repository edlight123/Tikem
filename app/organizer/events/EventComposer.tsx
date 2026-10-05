'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
// DELIBERATE LAZY FIREBASE — DO NOT MAKE THESE IMPORTS STATIC AGAIN.
//
// The Firebase client SDK is ~444KB of the ~988KB shared bundle. This file is
// the composer behind /create and /organizer/events/[id]/edit, and it only
// touches Firestore inside the save handlers — nothing during render. Every
// Firebase reference below is therefore behind `await import()`, so a reader
// who opens the create form pays for the SDK when they press Save, not when
// the page paints.
//
// The rule that matters: a route only gets lighter when its LAST static
// importer of the SDK is deferred. Re-adding a static `firebase/*` or
// `@/lib/firebase*` import here silently puts the whole 444KB back on
// /create's first load, and a partial deferral measured ~31KB WORSE per route
// than no deferral at all (async-chunk plumbing with none of the payoff).
//
// `firebaseDb` is the shim that handles top-level collections. The raw SDK is
// here too because the shim can't reach subcollections, and the hashed access
// code is written straight to events/{id}/private/access via setDoc.
let _shim: typeof import('@/lib/firebase-db/client') | null = null
const getShim = async () => (_shim ??= await import('@/lib/firebase-db/client')).firebaseDb

let _fs: Promise<
  [typeof import('firebase/firestore'), typeof import('@/lib/firebase/client')]
> | null = null
/** Cached as a PROMISE, so two concurrent saves share one in-flight import. */
const getFirestore = async () => {
  const [fs, client] = await (_fs ??= Promise.all([
    import('firebase/firestore'),
    import('@/lib/firebase/client'),
  ]))
  return { ...fs, db: client.db }
}
import { isDemoMode } from '@/lib/demo'
import {
  planTierSync,
  matchSiblingTierIds,
  resolveOrphan,
  isQuantityBelowSold,
  type ExistingTier,
} from '@/lib/tickets/tier-reconcile'
import { useToast } from '@/components/ui/Toast'
import ImageUpload from '@/components/ImageUpload'
import SpotifySongPicker from '@/components/organizer/SpotifySongPicker'
import { usePosterAccent, POSTER_ACCENT_FALLBACK } from '@/components/ui/usePosterAccent'
import GuestEditorSheet from '@/components/organizer/GuestEditorSheet'
import {
  GUEST_ROLES,
  emptyLineupEntry,
  lineupEntryFromRecord,
  lineupEntryToRecord,
  type LineupEntry,
} from '@/lib/lineup'
import {
  guestlistVisibilityFrom,
  showGuestlistFor,
  GUESTLIST_VISIBILITIES,
  type GuestlistVisibility,
} from '@/lib/guestlistVisibility'
import GuestlistVisibilityPicker from '@/components/organizer/GuestlistVisibility'
import { DatePicker, TimePicker } from '@/components/ui/DateTimePickers'
import { normalizeEventCurrencyForCountry, getAllowedEventCurrencies, type EventCurrency } from '@/lib/currency-policy'
import { withStoredMoneyFields } from '@/lib/events/stored-money-fields'
import { incidenceForEvent, priceOrder } from '@/lib/checkout/buyer-pricing'
import { fromCents } from '@/lib/ticketPricing'
import { nationalDayForEventDate, nationalDayName } from '@/lib/nationalDays'
// The sanctioned editorial section heading (font-display, lowercase, italic).
// Hand-rolled bold sans headings read as off-brand — see EditorialRails.
import { SectionHeader } from '@/components/ui/EditorialRails'
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Link2,
  Globe,
  Image as ImageIcon,
  Info,
  Lock,
  MapPin,
  MoreVertical,
  Palette,
  Pencil,
  Plus,
  Repeat,
  Settings,
  SlidersHorizontal,
  Tag,
  Ticket,
  Trash2,
  Type,
  Users,
  X,
  Youtube,
} from 'lucide-react'

const CATEGORIES = [
  'Concert',
  'Party',
  'Festival',
  'Conference',
  'Workshop',
  'Sports',
  'Theater',
  'Other',
]


// Recurring-event cadence options for the "Repeats" selector (create-only).
type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'
const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]
/** Hard cap on how many occurrences a single recurring series may generate. */
const MAX_RECURRENCE_COUNT = 52

/**
 * Shift a base datetime by `i` steps of the given cadence, preserving the
 * time-of-day. Monthly steps clamp the day-of-month to the target month's
 * length (e.g. Jan 31 + 1 month → Feb 28/29) so no occurrence rolls into the
 * following month. Mirrors mobile/lib/api/events.ts:shiftDateByRecurrence.
 */
function shiftDateByRecurrence(base: Date, cadence: 'daily' | 'weekly' | 'monthly', i: number): Date {
  const d = new Date(base.getTime())
  if (cadence === 'daily') {
    d.setDate(d.getDate() + i)
  } else if (cadence === 'weekly') {
    d.setDate(d.getDate() + i * 7)
  } else {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + i)
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDayOfMonth))
  }
  return d
}

/**
 * SHA-256 hex of a string, computed client-side via the Web Crypto API. Used to
 * hash the trimmed access code before it is written to the private/access
 * subdoc. The plaintext code is NEVER stored or logged.
 */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface EventComposerProps {
  userId: string
  isVerified?: boolean
  verificationStatus?: string
  /** When provided, the composer runs in EDIT mode (prefilled + updates this event). */
  event?: any
  /** Existing ticket tiers for the event being edited. */
  initialTiers?: TicketTier[]
  /**
   * GUEST mode (/create): anyone can compose the whole event signed out. The
   * form autosaves to localStorage; the save button routes through sign-up
   * (or the become-organizer step when `authed`), and /organizer/events/new
   * restores the draft afterwards — nothing typed is lost to the login wall.
   */
  guest?: boolean
  /** Guest mode only: the visitor IS signed in, just not an organizer yet. */
  authed?: boolean
}

/** Where a signed-out composition survives the trip through sign-up. */
const DRAFT_KEY = 'tikem:event-draft'

/**
 * Stored `total_quantity` for a tier the organizer declared UNLIMITED. Every
 * reader (selector, the three payment routes) answers "is there stock left?"
 * with `total_quantity - sold_quantity > 0`, so an unlimited tier needs a
 * quantity large enough to never run out rather than a special case in each
 * reader. 1,000,000 is mobile's sentinel — see
 * mobile/screens/organizer/CreateEventFlowRefactored.tsx:UNLIMITED_SENTINEL.
 * The explicit `unlimited: true` flag rides along so the UI can say "Unlimited"
 * instead of "1000000".
 */
const UNLIMITED_QTY = 1000000

interface TicketTier {
  /** Local row key (React key, open/menu state). NOT the Firestore doc id. */
  id: string
  /**
   * The `ticket_tiers` doc this row was loaded from. Absent for a row added in
   * this session (or a duplicate). Saving UPDATES this doc in place, so its
   * sold count and every ticket's `tier_id` stay valid.
   */
  docId?: string
  /** Already sold against `docId` — the floor for the quantity field. */
  soldQuantity?: number
  name: string
  price: string
  qty: string
  /** Optional per-tier SALE window, stored as ISO 8601 strings ('' = no bound). */
  salesStart?: string
  salesEnd?: string
  /**
   * Optional per-tier ENTRY (validity) window — when this ticket admits the
   * holder, distinct from when it can be bought. ISO 8601 strings ('' = admits
   * anytime). Matches mobile's valid_from / valid_until contract.
   */
  validFrom?: string
  validUntil?: string
  /** Per-tier blurb shown next to the ticket at checkout (mobile parity). */
  description?: string
  /**
   * The organizer said "this one is free" OUT LOUD. Kept as its own flag rather
   * than inferred from `price === '0'`, because a blank price must stay an
   * error (a giveaway you never asked for) instead of quietly meaning free.
   */
  free?: boolean
  /** No cap on how many of this tier exist (stored as the sentinel above). */
  unlimited?: boolean
  /** Max of THIS tier one order may contain ('' = no per-tier cap). */
  maxPerOrder?: string
  /** Hidden from the public selector — persisted as `is_active: false`. */
  hidden?: boolean
  /** Per-tier waitlist (VIP can sell out while GA hasn't). */
  waitlist?: boolean
}

const pad2 = (n: number) => String(n).padStart(2, '0')
/** Split an ISO datetime into local 'yyyy-MM-dd' + 'HH:mm' strings for the pickers. */
function splitISO(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  }
}

/** ISO string → value for a `<input type="datetime-local">` (local time), or ''. */
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** `datetime-local` value → ISO string, or null when empty/invalid. */
function localInputToISO(local?: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const makeId = () => Math.random().toString(36).slice(2, 9)

/**
 * Three steps, and how far along the form is.
 *
 * Not a wizard: the form stays one page, because an organizer editing a live
 * event should not have to walk a flow to change a price. This is a read-out
 * of what is still missing, so "why can't I publish yet" is answerable at a
 * glance instead of by scrolling.
 */
function FormProgress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation('common')
  return (
    /**
     * Four quarters, no words, pinned under the navbar.
     *
     * It began as three labelled steps (BASICS / TICKETS / POSTER) with a "2/3"
     * counter, buried at the top of the form's own column. The owner asked for
     * the labels gone and the bar moved to the top of the PAGE: "instead of
     * each item they should represent percent completion... the last one only
     * lights up after 100%". So it is a progress meter now, not a stepper —
     * the segments do not name anything, they just fill.
     *
     * The offset is `var(--chrome-h)`, not a literal: the public Navbar is
     * h-14 / sm:h-16 but /organizer swaps in OrganizerTopNav at a flat h-14,
     * and a hard-coded top-16 left an 8px stripe of page showing between the
     * two there. globals.css owns the value. Page colour rather
     * than a lifted surface, and no bottom hairline, because a sticky bar in
     * either of those sits a few pixels under the navbar's border and reads as
     * a seam across the page — a mistake this codebase has already made once.
     */
    <div className="sticky top-[var(--chrome-h)] z-30 bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div
        className="mx-auto flex max-w-5xl gap-1.5 px-4 py-3 sm:px-6 lg:px-8"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((done / total) * 100)}
        aria-label={t('composer.progressLabel', { defaultValue: 'Event setup progress' })}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            // The unlit segments were `bg-white/12`, which at 1px on a black
            // page is about #1f1f1f — invisible. The bar then read as one
            // short teal line rather than one quarter of four, which is the
            // entire thing it is meant to communicate. /20 keeps the track
            // quiet but present.
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < done ? 'bg-brand-400' : 'bg-white/20'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

/* ----------------------------- small UI atoms ----------------------------- */

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      // House rule: teal is a sparing ACCENT, never a fill. The on-state is a
      // white track with a dark knob (the reference composer's own treatment).
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${on ? 'border-white bg-white' : 'border-white/20 bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-all ${on ? 'left-[22px] bg-black' : 'left-0.5 bg-white'}`}
      />
    </button>
  )
}

/**
 * Selected/on chip: a white fill (never teal) — see the house rule above.
 *
 * The off state is a fill too, not a hairline ring: a row of outlined pills
 * inside an already-outlined box was the pattern that made this whole column
 * read as a wireframe. Fill-vs-fill still separates on from off unmistakably,
 * because on is white and off is barely there.
 */
const CHIP_ON = 'bg-white text-black'
const CHIP_OFF = 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
/**
 * Small, squarish, and tappable — in that order of difficulty.
 *
 * Two owner passes got us here. `min-h-11` met the 44px touch floor by making
 * every chip 44px TALL, which turned eight category chips into three fat rows
 * ("pills way to big"). Padding alone then left them at 34px and fully round,
 * and the answer to that was "make them smaller and maybe less round".
 *
 * So the INK is 30px and `rounded-[10px]`, and the TOUCH TARGET is separate: an
 * ::after pseudo-element stretched 7px past the top and bottom edges gives 44px
 * of tappable box without adding a pixel of visible height or shifting the
 * layout. `leading-[18px]` is explicit because an arbitrary `text-[13px]` sets
 * only font-size and would otherwise inherit whatever line-height the parent
 * had, making the height drift between the rows that use this.
 */
const chipCls = (on: boolean) =>
  [
    'relative inline-flex items-center rounded-[10px] px-2.5 py-1.5',
    'text-[13px] leading-[18px] font-medium transition-colors',
    // Verified emitted: `.after\\:-inset-y-\\[7px\\]:after{top:-7px;bottom:-7px}`
    // is in the built CSS. Worth checking rather than assuming — a hit area
    // that silently failed to compile is not visible in a screenshot.
    "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
    on ? CHIP_ON : CHIP_OFF,
  ].join(' ')

/**
 * A state read-out that is a DOT plus a label — never a filled status pill
 * (house rule). Used for a tier's "Free" / "Hidden" / "Unlimited" states.
 */
function DotLabel({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-white/60">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${tone === 'warn' ? 'bg-amber-300' : 'bg-brand-400'}`}
      />
      {children}
    </span>
  )
}

/**
 * The one accessible info popover the composer reuses everywhere a paragraph of
 * explanation used to sit permanently on screen. No library: a button that owns
 * `aria-expanded` + `aria-describedby`, closes on Escape (returning focus) and
 * on a click outside.
 */
function InfoPopover({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={label}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20 text-white/50 transition-colors hover:border-white/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-7 z-30 w-64 rounded-xl border border-white/15 bg-[#111] px-3 py-2.5 text-xs leading-relaxed text-white/75 shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  )
}

function SectionTitle({
  icon: Icon,
  children,
  right,
  info,
}: {
  icon: any
  children: string
  right?: React.ReactNode
  info?: string
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-[18px] w-[18px] shrink-0 text-white/45" />
        {/* The sanctioned editorial heading, scaled down for a form column and
            with its own bottom margin neutralised (the row owns the spacing). */}
        <span className="min-w-0 [&_h2]:!text-[clamp(20px,2.6vw,26px)] [&>div]:mb-0">
          <SectionHeader title={children} />
        </span>
        {info && <InfoPopover label={`${children}, more information`} text={info} />}
      </span>
      {right}
    </div>
  )
}

/**
 * Posh-style event composer: the page IS the event, edited inline on a single
 * screen (no wizard). Powers BOTH creating a new event and editing an existing
 * one — pass an `event` (and `initialTiers`) to run in edit mode, where Save
 * updates the event and the publish control toggles its live state.
 */
export default function EventComposer({
  userId,
  isVerified = false,
  event,
  initialTiers,
  guest = false,
  authed = false,
}: EventComposerProps) {
  const { t: tx } = useTranslation('organizer')
  const router = useRouter()
  const { showToast } = useToast()
  const { t, i18n } = useTranslation('common')

  const isEdit = !!event
  const start0 = splitISO(event?.start_datetime)
  const end0 = splitISO(event?.end_datetime)

  // Core
  const [sellMode, setSellMode] = useState<'tickets' | 'rsvp'>(
    isEdit && event?.ticket_name === 'RSVP' ? 'rsvp' : 'tickets'
  )
  const [title, setTitle] = useState(event?.title || '')
  const [summary, setSummary] = useState(event?.summary || '')
  const [showSummary, setShowSummary] = useState(!!event?.summary)
  const [bannerUrl, setBannerUrl] = useState(event?.banner_image_url || '')

  // Dates
  const [startDate, setStartDate] = useState(start0.date)
  const [startTime, setStartTime] = useState(start0.time)
  const [endDate, setEndDate] = useState(end0.date)
  const [endTime, setEndTime] = useState(end0.time)
  // Recurrence is create-only; editing never regenerates a series, so the
  // control is hidden in edit mode (mobile parity). A stored is_recurring on the
  // event doc is preserved on edit but not acted upon.
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [recurrenceCount, setRecurrenceCount] = useState(4)
  // How the series length is bounded: 'count' generates N occurrences; 'until'
  // steps by cadence until (and including) recurrenceEndDate (capped at 52).
  const [recurrenceMode, setRecurrenceMode] = useState<'count' | 'until'>('count')
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('')

  // Details
  const [showDescription, setShowDescription] = useState(!!event?.description)
  const [description, setDescription] = useState(event?.description || '')
  const [address, setAddress] = useState(event?.address || '')
  const [venueName, setVenueName] = useState(event?.venue_name || '')
  const [category, setCategory] = useState(event?.category || 'Concert')
  const [isOnline, setIsOnline] = useState(!!event?.is_online)
  const [city, setCity] = useState(event?.city || 'Port-au-Prince')

  // Currency — HT organizers may price in HTG or USD. Attendee views default to
  // HTG, so new events default to HTG here (edit mode keeps the stored choice).
  const allowedCurrencies = getAllowedEventCurrencies('HT')
  const [currency, setCurrency] = useState<EventCurrency>(
    isEdit ? normalizeEventCurrencyForCountry('HT', event?.currency || 'HTG') : 'HTG'
  )

  // Tickets — multiple tiers.
  // The event-level `enable_waitlist` is the LEGACY granularity: it is the
  // fallback each tier's own waitlist flag hydrates from, so an existing event
  // that had the event-wide waitlist on keeps it on, per tier, and re-saving
  // writes the event flag back (see buildEventData).
  const [tiers, setTiers] = useState<TicketTier[]>(
    initialTiers && initialTiers.length > 0
      ? initialTiers.map((t) => {
          const unlimited =
            !!(t as any).unlimited || Number((t as any).qty ?? 0) >= UNLIMITED_QTY
          return {
            ...t,
            docId: (t as any).docId || undefined,
            soldQuantity: Math.max(0, Number((t as any).soldQuantity ?? (t as any).sold_quantity ?? 0) || 0),
            salesStart: isoToLocalInput((t as any).salesStart ?? (t as any).sales_start),
            salesEnd: isoToLocalInput((t as any).salesEnd ?? (t as any).sales_end),
            validFrom: isoToLocalInput((t as any).validFrom ?? (t as any).valid_from),
            validUntil: isoToLocalInput((t as any).validUntil ?? (t as any).valid_until),
            description: String((t as any).description ?? '') || '',
            free: Number(t.price ?? 0) === 0,
            unlimited,
            qty: unlimited ? '' : String(t.qty ?? ''),
            maxPerOrder:
              Number((t as any).maxPerOrder ?? (t as any).max_per_order ?? 0) > 0
                ? String((t as any).maxPerOrder ?? (t as any).max_per_order)
                : '',
            hidden: ((t as any).hidden ?? (t as any).is_active === false) === true,
            waitlist:
              (t as any).waitlist ?? (t as any).enable_waitlist ?? !!event?.enable_waitlist,
          }
        })
      : [{ id: makeId(), name: 'General Admission', price: '10', qty: '100', free: false }]
  )

  /** Which tier's detail panel is expanded (null = all collapsed, the default). */
  const [openTierId, setOpenTierId] = useState<string | null>(null)
  /** Which tier's overflow (⋮) menu is open. */
  const [menuTierId, setMenuTierId] = useState<string | null>(null)

  const addTier = () => {
    const id = makeId()
    setTiers((prev) => [...prev, { id, name: '', price: '', qty: '100', free: false }])
    setOpenTierId(id)
  }
  const updateTier = (id: string, patch: Partial<TicketTier>) =>
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const removeTier = (id: string) =>
    setTiers((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev))
  /**
   * Duplicate a tier — the most-wanted action while building GA → VIP → Table.
   * Everything but the identity is copied; the copy lands directly after its
   * source and opens, so the only thing left to do is rename and reprice it.
   */
  const duplicateTier = (id: string) => {
    setTiers((prev) => {
      const i = prev.findIndex((t) => t.id === id)
      if (i < 0) return prev
      const copyId = makeId()
      const copy: TicketTier = {
        ...prev[i],
        id: copyId,
        // A copy is a NEW tier: it must not inherit the source's doc or sales.
        docId: undefined,
        soldQuantity: 0,
        name: `${prev[i].name || ''}`.trim(),
      }
      setOpenTierId(copyId)
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)]
    })
    setMenuTierId(null)
  }
  /**
   * Free is stated, not inferred: flipping it on sets the price to 0, flipping
   * it off clears the field so the organizer must type a real price (a blank
   * price stays a validation error, never a silent giveaway).
   */
  const toggleFreeTier = (id: string, free: boolean) =>
    updateTier(id, { free, price: free ? '0' : '' })
  /** Unlimited clears the quantity field; turning it off restores a real cap. */
  const toggleUnlimitedTier = (id: string, unlimited: boolean) =>
    updateTier(id, { unlimited, qty: unlimited ? '' : '100' })

  /**
   * ADVANCED SETTINGS — collapsed by default (mobile parity: `advancedOpen`).
   * Title, dates, location and tickets are always open; everything else — the
   * repeat plan, features, media, poster theme, page settings and the password
   * gate — waits behind one control instead of shouting on first load.
   */
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // The open ⋮ tier menu dismisses on Escape and on any click outside it.
  useEffect(() => {
    if (!menuTierId) return
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el && el.closest('[data-tier-menu]')) return
      setMenuTierId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuTierId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuTierId])

  // Guestlist — artists / hosts / performers joining the event (the lineup)
  const [guests, setGuests] = useState<LineupEntry[]>(
    Array.isArray(event?.guestlist) ? event.guestlist.map(lineupEntryFromRecord) : []
  )

  // The entry currently open in the editor sheet — a fresh one when adding, a
  // copy of an existing one when editing. Editing works on a COPY so Cancel
  // genuinely discards: mutating the row in place would leave half-typed edits
  // behind on dismiss.
  const [guestDraft, setGuestDraft] = useState<LineupEntry | null>(null)
  const [guestDraftIsNew, setGuestDraftIsNew] = useState(true)

  const openNewGuest = () => {
    setGuestDraft(emptyLineupEntry())
    setGuestDraftIsNew(true)
  }
  const openEditGuest = (g: LineupEntry) => {
    setGuestDraft({ ...g })
    setGuestDraftIsNew(false)
  }
  const patchGuestDraft = (patch: Partial<LineupEntry>) =>
    setGuestDraft((prev) => (prev ? { ...prev, ...patch } : prev))

  const saveGuestDraft = () => {
    setGuests((prev) => {
      if (!guestDraft) return prev
      const entry = { ...guestDraft, name: guestDraft.name.trim() }
      if (!entry.name) return prev
      return guestDraftIsNew
        ? [...prev, entry]
        : prev.map((g) => (g.id === entry.id ? entry : g))
    })
    setGuestDraft(null)
  }
  const removeGuest = (id: string) => setGuests((prev) => prev.filter((g) => g.id !== id))

  // Reorder: a lineup is a running order, so the order the organizer types in
  // is meaningful and must be adjustable without deleting and re-adding.
  const moveGuest = (id: string, dir: -1 | 1) =>
    setGuests((prev) => {
      const i = prev.findIndex((g) => g.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  // Visibility extras
  // Three states, not a boolean — see lib/guestlistVisibility. Legacy events
  // carry only `show_guestlist`, which the resolver folds in.
  const [guestlistVisibility, setGuestlistVisibility] = useState<GuestlistVisibility>(() =>
    guestlistVisibilityFrom((event ?? {}) as any)
  )
  const [showOnExplore, setShowOnExplore] = useState(event?.show_on_explore ?? true)
  // Password gate — public flag on the doc; the secret lives hashed in the
  // private/access subdoc, never on the event doc. The code input stays blank in
  // edit mode (the hash is write-only), so a blank code on save keeps it.
  const [passwordProtected, setPasswordProtected] = useState(!!event?.is_password_protected)
  const [accessCode, setAccessCode] = useState('')
  // "Part of Vertières?": offered only while the start date sits in or near a
  // national day's window (lib/nationalDays). Saved as `national_day`, the
  // day's eventTag, which the Home banners and rails read.
  const [nationalDayOn, setNationalDayOn] = useState(!!event?.national_day)

  // WHO PAYS THE SERVICE FEE for this event. The default follows the country
  // (Haiti absorbs it into the organizer's proceeds, US/CA/FR adds it on top),
  // and this toggle overrides that default for this event alone — so a Haitian
  // organizer selling to the diaspora can pass it on, and a US organizer running
  // a community night can absorb it.
  const [passFeesToBuyer, setPassFeesToBuyer] = useState(
    incidenceForEvent({ country: 'HT', fee_incidence: event?.fee_incidence }) === 'buyer'
  )

  // Style
  const [spotifyUrl, setSpotifyUrl] = useState(event?.spotify_url || '')
  // Optional promo video link (default '').
  const [videoUrl, setVideoUrl] = useState(event?.video_url || '')
  // Poster-theme override ('' = Auto), no longer editable here — the swatch row
  // was removed (see below). It is still READ and written back so a theme the
  // organizer chose in the mobile composer, where the picker works, survives an
  // unrelated edit made on the web. Dropping it from the payload would erase it,
  // which is the exact failure this file has already shipped twice.
  const [themeKey, setThemeKey] = useState<string>(event?.theme_key || '')
  const [titleFont, setTitleFont] = useState<'Default' | 'Serif' | 'Sans'>(event?.title_font || 'Default')
  const [accentColor, setAccentColor] = useState(event?.accent_color || '#14B8A6')

  /* ------------------------------------------------------------------------
   * The accent follows the poster.
   *
   * usePosterAccent extracts the flyer's dominant colour client-side (same
   * hook the poster cards already use for their glow) and returns an "r,g,b"
   * triple. Converted to hex here because `accent_color` has always been
   * stored as hex, and anything already reading that field keeps working.
   * ---------------------------------------------------------------------- */
  const posterAccentRgb = usePosterAccent(bannerUrl || undefined)
  useEffect(() => {
    if (!bannerUrl) return
    if (posterAccentRgb === POSTER_ACCENT_FALLBACK) return
    const hex =
      '#' +
      posterAccentRgb
        .split(',')
        .map((n) => Math.max(0, Math.min(255, parseInt(n.trim(), 10) || 0)).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    if (hex.length === 7) setAccentColor(hex)
  }, [posterAccentRgb, bannerUrl])

  // Edit-only: published state (toggled via the publish control)
  const [isPublished, setIsPublished] = useState(!!event?.is_published)
  const [publishing, setPublishing] = useState(false)

  // A restored draft gets a visible escape hatch (see the Start fresh button).
  const [draftRestored, setDraftRestored] = useState(false)

  // ── Guest draft: restore ──────────────────────────────────────────────
  // Create mode only. Runs in an effect (not initializers) so SSR and the
  // first client render agree, then the draft lands in one pass. The same
  // restore serves both /create (guest returning) and /organizer/events/new
  // (fresh organizer arriving from the sign-up trip).
  useEffect(() => {
    if (isEdit) return
    let d: any = null
    try {
      d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    } catch {
      /* unreadable draft — start clean */
    }
    if (!d || typeof d !== 'object' || (!d.title && !d.banner_image_url)) return
    // Stale drafts expire (shared devices, abandoned tabs) — matches the
    // guest-upload TTL, so a restored draft's poster is still alive.
    if (typeof d.saved_at === 'number' && Date.now() - d.saved_at > 7 * 24 * 3600 * 1000) {
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {}
      return
    }
    const s0 = splitISO(d.start_datetime)
    const e0 = splitISO(d.end_datetime)
    if (d.ticket_name === 'RSVP') setSellMode('rsvp')
    setTitle(d.title || '')
    if (d.summary) {
      setSummary(d.summary)
      setShowSummary(true)
    }
    if (d.banner_image_url) setBannerUrl(d.banner_image_url)
    if (s0.date) setStartDate(s0.date)
    if (s0.time) setStartTime(s0.time)
    if (e0.date) setEndDate(e0.date)
    if (e0.time) setEndTime(e0.time)
    if (d.description && d.description !== d.summary) {
      setDescription(d.description)
      setShowDescription(true)
    }
    if (d.address) setAddress(d.address)
    if (d.venue_name) setVenueName(d.venue_name)
    if (d.category) setCategory(d.category)
    if (d.is_online) setIsOnline(true)
    if (d.city) setCity(d.city)
    if (d.currency) setCurrency(normalizeEventCurrencyForCountry('HT', d.currency))
    if (Array.isArray(d.tiers) && d.tiers.length > 0) {
      setTiers(
        d.tiers.map((t: any) => {
          // The draft stores the SAVE shape (see snapshotDraft), so every new
          // per-tier field has to be read back here or it vanishes through
          // sign-up — the single easiest thing to lose in this file.
          const unlimited = !!t.unlimited || Number(t.quantity ?? 0) >= UNLIMITED_QTY
          return {
            id: makeId(),
            name: t.name || '',
            price: String(t.price ?? 0),
            qty: unlimited ? '' : String(t.quantity ?? 100),
            salesStart: isoToLocalInput(t.sales_start),
            salesEnd: isoToLocalInput(t.sales_end),
            validFrom: isoToLocalInput(t.valid_from),
            validUntil: isoToLocalInput(t.valid_until),
            description: String(t.description ?? '') || '',
            free: Number(t.price ?? 0) === 0,
            unlimited,
            maxPerOrder: Number(t.max_per_order ?? 0) > 0 ? String(t.max_per_order) : '',
            hidden: t.is_active === false,
            waitlist: t.enable_waitlist ?? !!d.enable_waitlist,
          }
        })
      )
    }
    if (Array.isArray(d.guestlist) && d.guestlist.length > 0) {
      // Reads the same shape `buildEventData` writes, via the same reader the
      // edit path uses — so a photo, link, bio or set time typed while signed
      // out survives sign-up instead of quietly vanishing at the door.
      setGuests(d.guestlist.map(lineupEntryFromRecord).filter((g: LineupEntry) => g.name))
    }
    if (d.guestlist_visibility || d.show_guestlist === false)
      setGuestlistVisibility(guestlistVisibilityFrom(d))
    if (d.show_on_explore === false) setShowOnExplore(false)
    // The access CODE is never persisted (secret) — restoring the flag makes
    // accessCodeInvalid demand a fresh code before create, instead of silently
    // creating a public event the guest believed was protected.
    if (d.is_password_protected) setPasswordProtected(true)
    if (d.national_day) setNationalDayOn(true)
    if (d.fee_incidence) setPassFeesToBuyer(d.fee_incidence === 'buyer')
    // `enable_waitlist` is now per tier; the event-level value in an older
    // draft is picked up as each tier's fallback in the tier mapping above.
    if (d.spotify_url) setSpotifyUrl(d.spotify_url)
    if (d.video_url) setVideoUrl(d.video_url)
    if (d.theme_key) setThemeKey(d.theme_key)
    if (d.title_font) setTitleFont(d.title_font)
    if (d.accent_color) setAccentColor(d.accent_color)
    // The recurrence plan survives the round trip too (create-only controls).
    if (d.recurrence && d.recurrence !== 'none') {
      setRecurrence(d.recurrence)
      if (d.recurrence_mode === 'until') setRecurrenceMode('until')
      if (Number(d.recurrence_count) >= 2) setRecurrenceCount(Number(d.recurrence_count))
      if (d.recurrence_end_date) setRecurrenceEndDate(d.recurrence_end_date)
    }
    setDraftRestored(true)
    if (!guest) {
      showToast({
        type: 'success',
        title: t('composer.toasts.welcomeTitle', { defaultValue: 'Welcome back' }),
        message: t('composer.toasts.welcomeMsg', {
          defaultValue: 'We kept your event draft. Review it and hit Create.',
        }),
        duration: 4500,
      })
    }
    // Restore is a one-time mount concern by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Region payout-profile nudge (tester feedback, 2026-08-12/29) ──
  // An event's country decides WHICH payout profile pays out: Haiti profile
  // (MonCash/bank, verified by Tikèm) vs the Stripe profile (US·CA·FR events).
  // Say so here, while the organizer is still composing, instead of only
  // erroring at publish. Advisory only — the publish route stays the gate.
  const [payoutProfileGap, setPayoutProfileGap] = useState<null | 'haiti' | 'stripe_connect'>(null)
  useEffect(() => {
    if (isDemoMode()) return
    if (guest) return // no organizer yet, nothing to nudge about
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/organizer/payout-config-summary')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data?.profiles) return
        const country = String(event?.country || 'HT').toUpperCase()
        const needsStripe = country === 'US' || country === 'CA' || country === 'FR'
        if (needsStripe && !data.profiles.stripeConnect?.configured) {
          setPayoutProfileGap('stripe_connect')
        } else if (!needsStripe && !data.profiles.haiti?.configured) {
          setPayoutProfileGap('haiti')
        }
      } catch {
        // Nudge only — no summary, no notice.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.country])

  // Edit-only: when this event belongs to a recurring series, the organizer can
  // opt to apply the shared field edits to every sibling (each keeps its own
  // start/end datetimes and series_id).
  const seriesId: string | undefined = isEdit ? event?.series_id : undefined
  const [applyToSeries, setApplyToSeries] = useState(false)

  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)

  const composeISO = (d: string, t: string) =>
    d ? new Date(`${d}T${t || '00:00'}`).toISOString() : null

  // Validation
  const startISOv = composeISO(startDate, startTime)
  const endISOv = composeISO(endDate, endTime)
  const endBeforeStart = !!(
    startISOv &&
    endISOv &&
    new Date(endISOv).getTime() <= new Date(startISOv).getTime()
  )
  const needsLocation = !isOnline && !venueName.trim() && !address.trim() && !city.trim()

  /**
   * The end is REQUIRED now (owner call, 2026-09-03).
   *
   * It was optional, and the result was that 25 of 27 events in production
   * carried no `end_datetime` at all — so the public event page had no end to
   * show, every reader was left guessing when the night finished, and the
   * "Date & time" section could only ever print half a fact.
   *
   * `endMissing` is deliberately separate from `endBeforeStart`: they are
   * different mistakes and deserve different sentences. Missing also covers a
   * date with no time, since a bare date would compose to midnight and quietly
   * mean "ends as it begins".
   */
  const endMissing = !endDate || !endTime
  const titleInvalid = attempted && title.trim().length < 3
  const startInvalid = attempted && !startDate
  const eligibleNationalDay = nationalDayForEventDate(startDate || null)
  const nationalDayLabel = eligibleNationalDay ? nationalDayName(eligibleNationalDay, (i18n.language || 'en').slice(0, 2)) : ''
  const endInvalid = attempted && (endMissing || endBeforeStart)
  const locationInvalid = attempted && needsLocation

  // Per-tier sale window: when BOTH bounds are set, end must be after start.
  const saleWindowInvalid = (t: TicketTier): boolean => {
    if (!t.salesStart || !t.salesEnd) return false
    const s = new Date(t.salesStart).getTime()
    const e = new Date(t.salesEnd).getTime()
    return Number.isFinite(s) && Number.isFinite(e) && e <= s
  }
  const anySaleWindowInvalid = sellMode === 'tickets' && tiers.some(saleWindowInvalid)

  // "Free" and "not filled in" must never be the same thing: `Number('') || 0`
  // is 0, so a blank price field would silently save the tier as a FREE tier and
  // give the ticket away. Require an explicit value (0 is allowed, and is how the
  // organizer says "free"); reject blank and negative.
  const tierPriceUnset = (t: TicketTier): boolean => {
    const raw = String(t.price ?? '').trim()
    if (raw === '') return true
    const n = Number(raw)
    return !Number.isFinite(n) || n < 0
  }
  const anyTierPriceUnset = sellMode === 'tickets' && tiers.some(tierPriceUnset)

  // Per-tier entry (validity) window: when BOTH bounds are set, valid_until
  // must be after valid_from.
  const validityWindowInvalid = (t: TicketTier): boolean => {
    if (!t.validFrom || !t.validUntil) return false
    const s = new Date(t.validFrom).getTime()
    const e = new Date(t.validUntil).getTime()
    return Number.isFinite(s) && Number.isFinite(e) && e <= s
  }
  const anyValidityWindowInvalid = sellMode === 'tickets' && tiers.some(validityWindowInvalid)

  // A tier can't hold fewer tickets than it has already sold — checkout reads
  // `total_quantity - sold_quantity`, so a lower cap would just mean "sold out"
  // with tickets out in the world beyond it.
  const qtyBelowSold = (t: TicketTier): boolean =>
    isQuantityBelowSold(Number(t.qty) || 0, t.soldQuantity || 0, !!t.unlimited)
  const anyQtyBelowSold = sellMode === 'tickets' && tiers.some(qtyBelowSold)

  // Access code: required (min 6) when enabling protection on CREATE; on edit a
  // blank code keeps the existing hash, but a typed code must still be >= 6.
  const trimmedCode = accessCode.trim()
  const accessCodeInvalid =
    passwordProtected &&
    ((!isEdit && trimmedCode.length < 6) || (trimmedCode.length > 0 && trimmedCode.length < 6))

  // The organizer's own UTC offset, shown beside the date fields so "8pm" is
  // unambiguous. Only the browser knows it — the server renders in its own zone
  // (UTC on Vercel) — so this is rendered AFTER mount and the server emits
  // nothing. suppressHydrationWarning would be the wrong tool here: it silences
  // the mismatch by keeping the SERVER's text, which left every organizer
  // outside UTC reading "GMT+0" beside their own local times. A wrong timezone
  // on a date field is worse than a console warning.
  const [tzReady, setTzReady] = useState(false)
  useEffect(() => setTzReady(true), [])
  const tzLabel = tzReady
    ? (() => {
        const off = -new Date().getTimezoneOffset() / 60
        return `GMT${off >= 0 ? '+' : ''}${off}`
      })()
    : ''

  const isPaid = sellMode === 'tickets' && tiers.some((t) => Number(t.price) > 0)

  // A worked example on the organizer's own cheapest paid ticket, so the toggle
  // is a number rather than a policy statement. Uses the same pricing function
  // the buyer's checkout does, capped fee included.
  const feeExample = (() => {
    const paidPrices = tiers.map((t) => Number(t.price) || 0).filter((p) => p > 0)
    if (!paidPrices.length) return ''
    const price = Math.min(...paidPrices)
    const pricing = priceOrder(
      price,
      { country: 'HT', currency, fee_incidence: passFeesToBuyer ? 'buyer' : 'organizer' },
      { quantity: 1, currency }
    )
    const money = (amount: number) => `${amount.toLocaleString()} ${currency}`
    return passFeesToBuyer
      ? t('composer.fee.example', {
          defaultValue: 'A {{price}} ticket: the buyer pays {{total}} and you receive {{net}}.',
          price: money(price),
          total: money(pricing.total),
          net: money(price),
        })
      : t('composer.fee.example', {
          defaultValue: 'A {{price}} ticket: the buyer pays {{total}} and you receive {{net}}.',
          price: money(price),
          total: money(price),
          net: money(fromCents(pricing.cents.organizerNet)),
        })
  })()
  const paidPublishingBlocked = isPaid && !isVerified

  // Build the shared event payload from the current form state.
  const buildEventData = () => {
    const isRsvp = sellMode === 'rsvp'
    const cleanTiers = tiers.map((t) => ({
      name: t.name.trim() || 'General Admission',
      price: Number(t.price) || 0,
      // An unlimited tier stores the sentinel quantity so every existing
      // "stock left?" reader keeps working untouched (see UNLIMITED_QTY).
      quantity: t.unlimited ? UNLIMITED_QTY : Number(t.qty) || 0,
      unlimited: !!t.unlimited,
      // Per-tier blurb (mobile collects it and the column has always existed —
      // web used to hard-write null here and throw the text away).
      description: t.description?.trim() || null,
      // Hidden tiers stay sellable by link/WhatsApp but never render in the
      // public selector: `is_active` is already honoured by the selector and by
      // all three payment-initiation routes.
      is_active: !t.hidden,
      /** Max of THIS tier a single order may contain (null = no per-tier cap). */
      max_per_order: Number(t.maxPerOrder) > 0 ? Math.floor(Number(t.maxPerOrder)) : null,
      /** Per-tier waitlist — VIP can sell out while GA hasn't. */
      enable_waitlist: !!t.waitlist,
      // Per-tier sale window as ISO strings (or null). Matches mobile's format so
      // the web purchase routes and selector enforce/display identical bounds.
      sales_start: localInputToISO(t.salesStart),
      sales_end: localInputToISO(t.salesEnd),
      // Per-tier ENTRY (validity) window as ISO strings (or null) — when the
      // ticket admits the holder. Empty = admits anytime. Mobile contract.
      valid_from: localInputToISO(t.validFrom),
      valid_until: localInputToISO(t.validUntil),
    }))
    const firstTier = cleanTiers[0] || { name: 'General Admission', price: 0, quantity: 0 }
    const totalQty = cleanTiers.reduce((sum, t) => sum + t.quantity, 0)
    // Persisted snake_case, matching every other field on the event doc. This
    // is also the shape the guest draft snapshots (snapshotDraft spreads
    // `data`), so anything dropped here is lost through the sign-up round trip
    // as well as on the next edit — `guestFromRecord` reads it back.
    const cleanGuests = guests.map(lineupEntryToRecord)
    const data: Record<string, any> = {
      organizer_id: userId,
      title: title.trim(),
      description: description.trim() || summary.trim(),
      summary: summary.trim(),
      category,
      venue_name: isOnline ? '' : venueName.trim(),
      country: 'HT',
      city: isOnline ? '' : city.trim() || 'Port-au-Prince',
      commune: '',
      address: isOnline ? '' : address.trim(),
      start_datetime: composeISO(startDate, startTime),
      end_datetime: composeISO(endDate, endTime),
      // `ticket_price` is a "from"/display figure only. It is 0 for any event
      // carrying a free tier, so it can NOT answer "is this event free" once free
      // and paid tiers coexist — `has_paid_tiers` is the authoritative signal for
      // every reader (see mobile/lib/ticketPricing.ts).
      ticket_price: isRsvp ? 0 : firstTier.price,
      has_paid_tiers: !isRsvp && cleanTiers.some((t) => Number(t.price || 0) > 0),
      total_tickets: isRsvp ? 0 : totalQty,
      ticket_name: isRsvp ? 'RSVP' : firstTier.name,
      guestlist: cleanGuests,
      currency: normalizeEventCurrencyForCountry('HT', currency),
      banner_image_url: bannerUrl || null,
      is_online: isOnline,
      // Recurrence is create-only: on edit preserve the stored flag; on create it
      // reflects the chosen cadence (per-occurrence metadata is stamped below).
      is_recurring: isEdit ? !!event?.is_recurring : recurrence !== 'none',
      // Waitlists are PER TIER now. The event-level flag is still written — as
      // "any tier has one" — so nothing that already reads it (mobile, older
      // events) is orphaned by the change in granularity.
      enable_waitlist: cleanTiers.some((t) => t.enable_waitlist),
      guestlist_visibility: guestlistVisibility,
      // Written alongside, deliberately: mobile and older readers still key off
      // the boolean, and a rollback then degrades to hidden-vs-shown rather
      // than to "everyone's faces are public".
      show_guestlist: showGuestlistFor(guestlistVisibility),
      show_on_explore: showOnExplore,
      is_password_protected: passwordProtected,
      // The national day it is tagged for, or null when the toggle is off or
      // the date moved out of every window.
      national_day: nationalDayOn && eligibleNationalDay ? eligibleNationalDay.eventTag : null,
      // Stamped on the event so checkout, the ticket record and the earnings
      // ledger all read the same answer. Free events carry it harmlessly.
      fee_incidence: passFeesToBuyer ? 'buyer' : 'organizer',
      video_url: videoUrl.trim(),
      theme_key: themeKey || '',
      spotify_url: spotifyUrl.trim() || null,
      title_font: titleFont,
      accent_color: accentColor,
    }
    return { data, cleanTiers, isRsvp }
  }

  // Everything the sign-up round trip must preserve: the event payload, the
  // tier set, the recurrence plan, and a timestamp so stale drafts (a shared
  // device, an abandoned tab) expire instead of ambushing the next person.
  const snapshotDraft = () => {
    const { data, cleanTiers } = buildEventData()
    return {
      ...data,
      tiers: cleanTiers,
      recurrence,
      recurrence_mode: recurrenceMode,
      recurrence_count: recurrenceCount,
      recurrence_end_date: recurrenceEndDate,
      saved_at: Date.now(),
    }
  }

  // ── Guest draft: autosave ─────────────────────────────────────────────
  // Debounced snapshot on every change while composing signed-out, so even a
  // closed tab keeps the work. A poster alone (no title yet) also counts —
  // otherwise that upload would be orphaned. (organizer_id in the snapshot is
  // '' and is ignored on restore.)
  useEffect(() => {
    if (!guest) return
    const id = setTimeout(() => {
      try {
        if (!title.trim() && !bannerUrl) return
        localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshotDraft()))
      } catch {
        /* storage unavailable — the save click still carries the draft */
      }
    }, 600)
    return () => clearTimeout(id)
  })

  /**
   * Bring an event's `ticket_tiers` docs in line with the editor, IN PLACE.
   *
   * This used to delete every tier and insert fresh ones with
   * `sold_quantity: 0`, which reset every sold count (checkout reads
   * `total_quantity - sold_quantity`, so an edited event could oversell) and
   * gave the tiers new ids (orphaning every ticket's `tier_id`). Now a row
   * loaded from a doc updates that doc's EDITABLE fields only; a new row is
   * inserted; a removed tier is deleted only if nothing was ever sold against
   * it, and otherwise deactivated. See lib/tickets/tier-reconcile.ts.
   *
   * `docIds` are the editor rows' doc ids, parallel to `cleanTiers`. For a
   * series sibling pass `source` (the edited event's tiers as they were before
   * this save): the rows are then matched onto the sibling's OWN tier docs by
   * name / sort_order, so each sibling keeps its own ids and sold counts.
   *
   * Returns this event's tier docs as they were before the write, and the doc
   * id each editor row now lives at (so a second save updates, not re-inserts).
   */
  const syncTiers = async (
    eventId: string,
    cleanTiers: Array<{
      name: string
      price: number
      quantity: number
      unlimited: boolean
      description: string | null
      is_active: boolean
      max_per_order: number | null
      enable_waitlist: boolean
      sales_start: string | null
      sales_end: string | null
      valid_from: string | null
      valid_until: string | null
    }>,
    isRsvp: boolean,
    opts: { docIds?: Array<string | undefined>; source?: ExistingTier[] } = {}
  ): Promise<{ before: ExistingTier[]; rowDocIds: Array<string | null> }> => {
    const { collection, query, where, getDocs, doc, updateDoc, deleteDoc, limit, db } =
      await getFirestore()
    const snap = await getDocs(query(collection(db, 'ticket_tiers'), where('event_id', '==', eventId)))
    const existing: ExistingTier[] = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }))

    // An RSVP event sells no tiers (the web composer has never written one).
    const rows = isRsvp
      ? []
      : cleanTiers.map((t, i) => ({
          id: (opts.docIds?.[i] || null) as string | null,
          name: t.name,
          quantity: t.quantity,
          fields: t,
        }))
    if (opts.source) {
      const siblingIds = matchSiblingTierIds(rows, opts.source, existing)
      rows.forEach((r, i) => (r.id = siblingIds[i]))
    }
    const plan = planTierSync(existing, rows)
    const now = new Date().toISOString()
    const rowDocIds: Array<string | null> = rows.map(() => null)
    // Every editable field, and ONLY those: sold_quantity, created_at and
    // event_id are never written on an update.
    const editable = (t: (typeof cleanTiers)[number]) => ({
      name: t.name,
      price: t.price,
      unlimited: t.unlimited,
      description: t.description,
      is_active: t.is_active,
      max_per_order: t.max_per_order,
      enable_waitlist: t.enable_waitlist,
      // Per-tier sale window (ISO 8601 strings, or null for no bound).
      sales_start: t.sales_start,
      sales_end: t.sales_end,
      // Per-tier entry (validity) window (ISO 8601 strings, or null).
      valid_from: t.valid_from,
      valid_until: t.valid_until,
    })

    for (const u of plan.updates) {
      await updateDoc(doc(db, 'ticket_tiers', u.id), {
        ...editable(u.fields),
        total_quantity: u.totalQuantity,
        sort_order: u.sortOrder,
        updated_at: now,
      })
      rowDocIds[u.sortOrder] = u.id
    }
    if (plan.inserts.length > 0) {
      const { data: inserted, error } = await (await getShim()).from('ticket_tiers').insert(
        plan.inserts.map((ins) => ({
          ...editable(ins.fields),
          event_id: eventId,
          total_quantity: ins.totalQuantity,
          sold_quantity: 0,
          sort_order: ins.sortOrder,
        }))
      )
      if (error) console.error('Error saving ticket tiers:', error)
      const insertedRows = Array.isArray(inserted) ? inserted : []
      plan.inserts.forEach((ins, k) => {
        const id = insertedRows[k]?.id
        if (id) rowDocIds[ins.sortOrder] = String(id)
      })
    }
    for (const o of plan.orphans) {
      let referencing = 0
      if (o.action === 'check_tickets') {
        // A counter of 0 is not proof: the old replace-on-save reset counters.
        // Any ticket carrying this tier_id keeps the doc alive. (Equality on
        // event_id lets the tickets read rule prove the organizer owns them.)
        try {
          const tix = await getDocs(
            query(
              collection(db, 'tickets'),
              where('event_id', '==', eventId),
              where('tier_id', '==', o.id),
              limit(1)
            )
          )
          referencing = tix.size
        } catch (e) {
          // Can't prove it has no tickets: keep it (deactivated) rather than delete.
          console.warn('Ticket lookup for removed tier failed; deactivating instead', e)
          referencing = 1
        }
      }
      if (resolveOrphan(o.soldQuantity, referencing) === 'delete') {
        await deleteDoc(doc(db, 'ticket_tiers', o.id))
      } else {
        // Stops selling (every purchase route refuses is_active === false).
        // `archived` keeps it out of the editor, so it isn't mistaken for a
        // hidden tier and brought back on the next save.
        await updateDoc(doc(db, 'ticket_tiers', o.id), { is_active: false, archived: true, updated_at: now })
      }
    }
    return { before: existing, rowDocIds }
  }

  const handleSave = async () => {
    setAttempted(true)
    if (title.trim().length < 3 || !startDate) {
      showToast({
        type: 'error',
        title: t('composer.toasts.almostTitle', { defaultValue: 'Almost there' }),
        message: t('composer.toasts.almostMsg', {
          defaultValue: 'Add an event name and a start date to continue.',
        }),
        duration: 4000,
      })
      return
    }
    if (endMissing) {
      showToast({
        type: 'error',
        title: t('composer.toasts.datesTitle', { defaultValue: 'Check your dates' }),
        message: t('composer.endRequired', {
          defaultValue: 'Add when your event ends, so attendees know how long it runs.',
        }),
        duration: 4000,
      })
      return
    }
    if (endBeforeStart) {
      showToast({
        type: 'error',
        title: t('composer.toasts.datesTitle', { defaultValue: 'Check your dates' }),
        message: t('composer.endError', { defaultValue: 'The end time must be after the start time.' }),
        duration: 4000,
      })
      return
    }
    if (needsLocation) {
      showToast({
        type: 'error',
        title: t('composer.toasts.locationTitle', { defaultValue: 'Add a location' }),
        message: t('composer.toasts.locationMsg', {
          defaultValue: 'In-person events need a venue, address, or city.',
        }),
        duration: 4000,
      })
      return
    }
    if (anyTierPriceUnset) {
      showToast({
        type: 'error',
        title: t('composer.toasts.priceTitle', { defaultValue: 'Set a price for every ticket type' }),
        message: t('composer.toasts.priceMsgToggle', {
          defaultValue:
            'Type a price, or turn on “Make this a free ticket”. A blank price is not the same as free.',
        }),
        duration: 5000,
      })
      return
    }
    if (anySaleWindowInvalid) {
      showToast({
        type: 'error',
        title: t('composer.toasts.saleWindowTitle', { defaultValue: 'Check ticket sale windows' }),
        message: t('composer.toasts.saleWindowMsg', {
          defaultValue: 'A ticket’s sales end must be after its sales start.',
        }),
        duration: 4000,
      })
      return
    }
    if (anyQtyBelowSold) {
      showToast({
        type: 'error',
        title: t('composer.toasts.qtyBelowSoldTitle', { defaultValue: 'Check ticket quantities' }),
        message: t('composer.toasts.qtyBelowSoldMsg', {
          defaultValue: 'A ticket type can’t have fewer tickets than it has already sold.',
        }),
        duration: 5000,
      })
      return
    }
    if (anyValidityWindowInvalid) {
      showToast({
        type: 'error',
        title: t('composer.toasts.validityTitle', { defaultValue: 'Check ticket validity windows' }),
        message: t('composer.toasts.validityMsg', {
          defaultValue: 'A ticket’s valid until must be after its valid from.',
        }),
        duration: 4000,
      })
      return
    }
    if (accessCodeInvalid) {
      showToast({
        type: 'error',
        title: t('composer.toasts.accessTitle', { defaultValue: 'Set an access code' }),
        message: isEdit
          ? t('composer.accessCodeError', { defaultValue: 'Access codes must be at least 6 characters.' })
          : t('composer.toasts.accessMsgNew', {
              defaultValue: 'Protected events need an access code of at least 6 characters.',
            }),
        duration: 4000,
      })
      return
    }

    // GUEST: the whole form is valid — park it and walk them through the door.
    // Sign-up (or the become-organizer step) redirects back to
    // /organizer/events/new, whose restore effect picks the draft right up.
    if (guest) {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshotDraft()))
      } catch {
        /* storage unavailable — they'll retype after sign-in, same as today */
      }
      const target = '/organizer/events/new'
      router.push(
        authed
          ? `/organizer?redirect=${encodeURIComponent(target)}`
          : `/auth/signup?redirect=${encodeURIComponent(target)}`
      )
      return
    }

    setSaving(true)
    try {
      const { data, cleanTiers, isRsvp } = buildEventData()

      // A poster uploaded while signed out lives under guest-uploads/ with a
      // 7-day expiry — move it to its permanent home before the event points
      // at it. If the move fails we keep the guest URL: the event still
      // renders, and the cleanup cron never deletes a referenced file.
      if (typeof data.banner_image_url === 'string' && data.banner_image_url.includes('guest-uploads%2F')) {
        try {
          const res = await fetch('/api/guest-upload/promote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: data.banner_image_url }),
          })
          const body = await res.json().catch(() => ({}))
          if (res.ok && body?.url) {
            data.banner_image_url = body.url
            setBannerUrl(body.url)
          }
        } catch {
          /* keep the guest URL — see above */
        }
      }

      // Hash + write the access code to events/{id}/private/access when the event
      // is protected AND a non-empty code was typed. A blank code (edit mode)
      // intentionally preserves any existing hash. Plaintext is never persisted.
      const writeAccessHash = async (eventId: string) => {
        if (!passwordProtected) return
        const code = accessCode.trim()
        if (!code) return
        const codeHash = await sha256Hex(code)
        const { doc, setDoc, serverTimestamp, db } = await getFirestore()
        await setDoc(doc(db, 'events', eventId, 'private', 'access'), {
          code_hash: codeHash,
          updated_at: serverTimestamp(),
        })
      }

      // ----- EDIT: update the existing event -----
      if (isEdit) {
        if (isDemoMode()) {
          await new Promise((r) => setTimeout(r, 500))
          showToast({
            type: 'success',
            title: t('composer.toasts.savedTitle', { defaultValue: 'Changes saved' }),
            message: t('composer.toasts.demoMode', { defaultValue: 'Demo mode.' }),
            duration: 3000,
          })
          return
        }
        // Never relabel an existing event's country (this composer only offers
        // Haiti, so it used to stamp 'HT' over US/CA events), and never change
        // the currency of an event that has sold: firestore.rules refuses both
        // once tickets_sold > 0, and payouts value each sale in the currency it
        // was sold in. A field missing on the stored doc stays missing.
        const editData = withStoredMoneyFields(data, event)
        const { error } = await (await getShim()).from('events').update(editData).eq('id', event.id)
        if (error) throw error
        const tierDocIds = tiers.map((tr) => tr.docId)
        const { before: sourceTiers, rowDocIds } = await syncTiers(event.id, cleanTiers, isRsvp, {
          docIds: tierDocIds,
        })
        // The composer stays mounted after an edit save: give freshly inserted
        // rows their new doc ids so saving again updates them in place.
        setTiers((prev) =>
          prev.map((tr, i) => (rowDocIds[i] ? { ...tr, docId: rowDocIds[i] as string } : tr))
        )
        await writeAccessHash(event.id)

        // Optionally fan the same edits out to every sibling in the series. Each
        // sibling keeps its OWN start/end datetimes (and series_id); only the
        // shared fields — and the tier set — are overwritten. Capped at 52.
        let seriesApplied = 0
        if (applyToSeries && seriesId) {
          const { data: siblings } = await (await getShim())
            .from('events')
            .select('*')
            .eq('series_id', seriesId)
          const list = Array.isArray(siblings) ? siblings : []
          // Drop each occurrence's own schedule so siblings keep their dates.
          const { start_datetime, end_datetime, ...sharedData } = data
          for (const sib of list) {
            if (!sib?.id || sib.id === event.id) continue
            if (seriesApplied >= MAX_RECURRENCE_COUNT) break
            // Each sibling keeps its own stored country, and its currency once it has sold.
            const sibData = withStoredMoneyFields(sharedData, sib)
            const { error: sibErr } = await (await getShim()).from('events').update(sibData).eq('id', sib.id)
            if (sibErr) throw sibErr
            await syncTiers(sib.id, cleanTiers, isRsvp, { docIds: tierDocIds, source: sourceTiers })
            await writeAccessHash(sib.id)
            seriesApplied++
          }
        }

        showToast({
          type: 'success',
          title: t('composer.toasts.savedTitle', { defaultValue: 'Changes saved' }),
          message:
            seriesApplied > 0
              ? seriesApplied === 1
                ? t('composer.toasts.seriesUpdatedOne', {
                    defaultValue: 'Your event and 1 other in the series were updated.',
                  })
                : t('composer.toasts.seriesUpdatedMany', {
                    defaultValue: 'Your event and {{n}} others in the series were updated.',
                    n: seriesApplied,
                  })
              : t('composer.toasts.updatedMsg', { defaultValue: 'Your event has been updated.' }),
          duration: 3000,
        })
        router.refresh()
        return
      }

      // ----- CREATE: insert a new draft -----
      // Seed the moderation fields the admin Events console filters on. Firestore
      // drops docs missing a filtered field, so without these a new draft would be
      // invisible in the admin "Pending" tab (is_published==false && rejected==false).
      const createData = { ...data, tags: [] as string[], is_published: false, rejected: false, reports_count: 0, status: 'draft' }
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 600))
        try {
          localStorage.removeItem(DRAFT_KEY)
        } catch {}
        showToast({
          type: 'success',
          title: t('composer.toasts.draftTitle', { defaultValue: 'Draft created' }),
          message: t('composer.toasts.draftDemoMsg', { defaultValue: 'Demo mode. Opening the editor.' }),
          duration: 3000,
        })
        router.push('/organizer/events')
        return
      }

      // Recurrence plan (CREATE-only — edit returns above and never regenerates).
      // A real cadence generates occurrences one cadence apart, all sharing a
      // series_id. The series length is bounded either by an explicit count OR,
      // when the "Until a date" mode is chosen, by stepping the cadence from the
      // base date until the chosen end date (inclusive). Both cap at 52.
      const cadence = recurrence !== 'none' ? recurrence : null
      const baseStart = data.start_datetime ? new Date(data.start_datetime) : null
      const baseEnd = data.end_datetime ? new Date(data.end_datetime) : null
      // Inclusive end-of-day bound so an occurrence landing on the chosen date
      // still counts. Only used when in "until" mode with a valid date.
      const untilBound =
        cadence && recurrenceMode === 'until' && recurrenceEndDate
          ? new Date(`${recurrenceEndDate}T23:59:59`)
          : null
      const useUntil = !!(untilBound && !Number.isNaN(untilBound.getTime()) && baseStart)
      let occurrenceCount: number
      if (cadence && useUntil && baseStart && untilBound) {
        let n = 0
        for (let i = 0; i < MAX_RECURRENCE_COUNT; i++) {
          if (shiftDateByRecurrence(baseStart, cadence, i).getTime() > untilBound.getTime()) break
          n = i + 1
        }
        occurrenceCount = Math.max(1, n)
      } else if (cadence) {
        occurrenceCount = Math.max(2, Math.min(MAX_RECURRENCE_COUNT, Math.round(recurrenceCount || 2)))
      } else {
        occurrenceCount = 1
      }
      const recurrenceEndISO = useUntil && untilBound ? untilBound.toISOString() : null

      if (cadence && occurrenceCount > 1) {
        const seriesId = `series_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        let firstId = ''
        for (let i = 0; i < occurrenceCount; i++) {
          const occData = {
            ...createData,
            start_datetime: baseStart ? shiftDateByRecurrence(baseStart, cadence, i).toISOString() : null,
            end_datetime: baseEnd ? shiftDateByRecurrence(baseEnd, cadence, i).toISOString() : null,
            is_recurring: true,
            recurrence: cadence,
            series_id: seriesId,
            // Only meaningful in "until" mode; null when the series is bounded by count.
            recurrence_end_date: recurrenceEndISO,
          }
          const { data: occ, error: occErr } = await (await getShim()).from('events').insert(occData).select().single()
          if (occErr) throw occErr
          if (occ?.id) {
            await syncTiers(occ.id, cleanTiers, isRsvp)
            await writeAccessHash(occ.id)
          }
          if (i === 0) firstId = occ?.id || ''
        }
        try {
          localStorage.removeItem(DRAFT_KEY)
        } catch {}
        showToast({
          type: 'success',
          title: t('composer.toasts.seriesTitle', { defaultValue: 'Series created' }),
          message: t('composer.toasts.seriesMsg', {
            defaultValue: '{{n}} events created. Review the first, then Publish below.',
            n: occurrenceCount,
          }),
          duration: 4000,
        })
        if (firstId) router.push(`/organizer/events/${firstId}/edit`)
        else router.push('/organizer/events')
        router.refresh()
        return
      }

      const { data: created, error } = await (await getShim()).from('events').insert(createData).select().single()
      if (error) throw error
      if (created?.id) {
        await syncTiers(created.id, cleanTiers, isRsvp)
        await writeAccessHash(created.id)
      }
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {}
      showToast({
        type: 'success',
        title: t('composer.toasts.draftTitle', { defaultValue: 'Draft created' }),
        message: t('composer.toasts.draftMsg', { defaultValue: 'Review the details, then Publish below.' }),
        duration: 4000,
      })
      router.push(`/organizer/events/${created.id}/edit`)
      router.refresh()
    } catch (err: any) {
      showToast({
        type: 'error',
        title: isEdit
          ? t('composer.toasts.errSaveTitle', { defaultValue: 'Could not save changes' })
          : t('composer.toasts.errCreateTitle', { defaultValue: 'Could not create event' }),
        message: err?.message || t('composer.toasts.tryAgain', { defaultValue: 'Please try again.' }),
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  // Edit-only: publish / unpublish (verification-gated for paid events).
  const handleTogglePublish = async () => {
    if (!isEdit || !event?.id) return
    const next = !isPublished
    if (next && paidPublishingBlocked) {
      showToast({
        type: 'error',
        title: t('composer.toasts.verifyTitle', { defaultValue: 'Verification required' }),
        message: t('composer.verifyToPublish', {
          defaultValue: 'Complete identity verification to publish paid events.',
        }),
        duration: 5000,
      })
      return
    }
    setPublishing(true)
    try {
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 400))
        setIsPublished(next)
      } else {
        // Publish through the server route so all gates are enforced:
        // identity verification, the country's payout profile, and (for US/CA)
        // completed Stripe Connect onboarding. Writing is_published directly from
        // the client would bypass those checks.
        const res = await fetch(`/api/events/${event.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_published: next }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(
            data?.error || t('composer.toasts.publishStatusErr', { defaultValue: 'Could not update publish status' })
          )
        }
        setIsPublished(next)
        router.refresh()

        // The publish route returns non-blocking advisories — today, an event
        // whose country differs from the connected Stripe account's country
        // (payout lands in the account's currency, after a conversion). Show it
        // long and loud enough to be read; it never stops the publish.
        const publishWarnings: Array<{ message?: string }> = Array.isArray(data?.warnings) ? data.warnings : []
        for (const warning of publishWarnings) {
          if (!warning?.message) continue
          showToast({
            type: 'warning',
            title: t('composer.toasts.payoutWarnTitle', { defaultValue: 'Heads up about your payout' }),
            message: warning.message,
            duration: 12000,
          })
        }
      }
      showToast({
        type: 'success',
        title: next
          ? t('composer.toasts.publishedTitle', { defaultValue: 'Event published' })
          : t('composer.toasts.unpublishedTitle', { defaultValue: 'Moved to draft' }),
        message: next
          ? t('composer.toasts.publishedMsg', { defaultValue: 'Your event is now live.' })
          : t('composer.toasts.unpublishedMsg', { defaultValue: 'Your event is hidden from attendees.' }),
        duration: 3500,
      })
    } catch (err: any) {
      showToast({
        type: 'error',
        title: t('composer.toasts.errUpdateTitle', { defaultValue: 'Could not update' }),
        message: err?.message || t('composer.toasts.tryAgain', { defaultValue: 'Please try again.' }),
        duration: 5000,
      })
    } finally {
      setPublishing(false)
    }
  }

  /* ------------------------------------------------------------------------
   * Surfaces, not outlines.
   *
   * Every row here used to be a 1px hollow rectangle on the same black ground,
   * so a dozen unrelated controls read as one wireframe and nothing looked
   * clickable, typeable or grouped. These four levels replace that: depth does
   * the work borders were doing, and the LEVEL says what a thing is.
   *
   *   panel  0.025  a group's ground; rows inside it divide with a hairline
   *   row    0.03   a static or toggle row — present, not inviting
   *   field  0.05   something you type in; brightens further on focus
   *   inset  0.06   a small field sitting ON a panel, so it still reads as one
   *
   * Outlines survive in exactly one place — the dashed "add another" buttons —
   * because there a dashed edge around empty space is the meaning.
   * ---------------------------------------------------------------------- */
  const rowCls =
    'flex min-h-11 w-full items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3.5 text-left text-[15px] text-white/70 transition-colors hover:bg-white/[0.06]'
  // min-w-0 is load-bearing but NOT sufficient on its own: `field` is used by
  // four `<input type="datetime-local">` (a tier's sales and validity
  // windows), and a native datetime widget carries an intrinsic minimum width
  // it will not shrink below. min-width:0 releases that in Chrome; iOS ignores
  // it and keeps its own control metrics, which is how these ended up hanging
  // ~27px over the card's right edge on a phone while looking correct on every
  // desktop browser. The `appearance: none` that actually settles it is in
  // app/globals.css, applied to all date/time inputs at once — see the long
  // note there before touching sizing on any of these.
  // 16px not 15px: iOS zooms the page on focus below that.
  const field =
    'min-h-11 w-full min-w-0 rounded-xl bg-white/[0.05] px-4 py-3 text-[16px] text-white [color-scheme:dark] placeholder:text-white/40 transition-colors focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50'
  const inset =
    'rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-sm text-white [color-scheme:dark] transition-colors focus:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-brand-400/50'

  /**
   * Readiness in quarters, in the order the owner asked for: poster first.
   *
   * Each quarter is 25%, all four are required to publish, and the fourth
   * lighting up IS 100%. Poster leads deliberately — it is the thing that
   * actually sells the night, and an event with no artwork is the worst
   * performing card on Discover; the flyer library exists so that no organizer
   * is stuck at 75% for want of a designer.
   */
  const quarters = [
    Boolean(bannerUrl),
    Boolean(title.trim()),
    // When AND where — the end counts now that it is required, so the meter
    // cannot read 100% on an event that will not save.
    Boolean(
      startDate && endDate && endTime && (isOnline || address.trim() || venueName.trim() || city.trim())
    ),
    sellMode === 'rsvp' || tiers.some((tr) => tr.name.trim() && String(tr.price).trim() !== ''),
  ]
  const quartersDone = quarters.filter(Boolean).length
  const readyToPublish = quartersDone === quarters.length

  return (
    <div>
      {/* Outside the padded wrapper so it can span the full width and pin
          directly under the navbar, which is what "at the very top of the
          page" means. Same on a phone — the owner asked for it there too. */}
      <FormProgress done={quartersDone} total={quarters.length} />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 md:py-10">
      {/* Explicit grid placement on desktop so mobile is free to reorder.
          On a phone the stack is: poster, then the form, then the actions.
          It used to be poster+actions first and the form last, which put
          "Continue and sign up to publish" ABOVE the form the organizer had
          not filled in yet. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,360px)] lg:grid-rows-[auto_1fr]">
        {/* ===================== LEFT — the event ===================== */}
        <div className="order-2 min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {/* Region payout-profile nudge — which profile this event pays through. */}
          {payoutProfileGap && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-300" />
              <p className="text-sm leading-relaxed text-white/80">
                {payoutProfileGap === 'stripe_connect'
                  ? t('composer.payoutGap.stripe', {
                      defaultValue:
                        'Events in the US, Canada or France pay out through your Stripe profile. It isn’t set up yet, so paid tickets can’t publish. ',
                    })
                  : t('composer.payoutGap.haiti', {
                      defaultValue:
                        'Events in Haiti pay out through your Haiti profile (MonCash or bank). It isn’t set up yet, so paid tickets can’t publish. ',
                    })}
                <a
                  href="/organizer/settings/payouts"
                  className="font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
                >
                  {t('composer.payoutGap.cta', { defaultValue: 'Set up payouts' })}
                </a>
              </p>
            </div>
          )}

          {/* Draft signposting — makes the two-step create→edit flow explicit */}
          {isEdit && !isPublished && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3">
              <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand-300" />
              <p className="text-sm text-white/80">
                <span className="font-semibold text-white">
                  {t('composer.draftBanner.saved', { defaultValue: 'Draft saved.' })}
                </span>{' '}
                {t('composer.draftBanner.mid', { defaultValue: 'Add the finishing touches, then' })}{' '}
                <span className="font-semibold text-white">
                  {t('composer.draftBanner.publish', { defaultValue: 'Publish' })}
                </span>{' '}
                {t('composer.draftBanner.end', { defaultValue: 'when you’re ready.' })}
              </p>
            </div>
          )}

          {/* Sell Tickets / RSVP */}
          <div className="mx-auto mb-8 grid max-w-md grid-cols-2 rounded-full bg-white/[0.05] p-1">
            {(['tickets', 'rsvp'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSellMode(m)}
                aria-pressed={sellMode === m}
                className={`rounded-full py-2.5 text-sm font-semibold transition-all ${
                  sellMode === m ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                }`}
              >
                {m === 'tickets'
                  ? t('composer.sellTickets', { defaultValue: 'Sell Tickets' })
                  : t('composer.rsvp', { defaultValue: 'RSVP' })}
              </button>
            ))}
          </div>

          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('composer.titlePlaceholder', { defaultValue: 'My event name' })}
            aria-label={tx('event_composer.event_name_required')}
            aria-required="true"
            className="w-full bg-transparent font-display text-[clamp(34px,6vw,52px)] leading-[1.04] tracking-tight text-white placeholder:text-white/25 focus:outline-none"
          />
          {titleInvalid && (
            <p className="mt-1 text-sm text-red-300">
              {t('composer.titleError', { defaultValue: 'Give your event a name (3+ characters).' })}
            </p>
          )}

          {/* Short summary */}
          <div className="mt-4">
            {showSummary || summary ? (
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder={t('composer.summaryPlaceholder', { defaultValue: 'Add a short summary…' })}
                aria-label={tx('event_composer.short_summary')}
                rows={2}
                autoFocus={showSummary}
                className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-white/70 placeholder:text-white/30 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowSummary(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.09] hover:text-white"
              >
                <Plus className="h-4 w-4" /> {t('composer.shortSummary', { defaultValue: 'Short Summary' })}
              </button>
            )}
          </div>

          {/* Dates */}
          <div className="mt-8 border-t border-white/10 pt-6">
            <SectionTitle icon={CalendarDays}>{t('composer.dates', { defaultValue: 'Dates' })}</SectionTitle>
            <div className="overflow-hidden rounded-xl bg-white/[0.025]">
              {/* Label ABOVE the controls on a phone, beside them from sm.
                  The label and the two triggers cannot share one line at
                  402px — the controls need ~300px of the ~338px available, so
                  a wrapping row split the date from the time. Stacking the
                  label is what buys the controls a full line of their own; the
                  inner group is `flex-nowrap` so the date and time can never
                  separate from each other whatever the locale does to their
                  widths. */}
              <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-3">
                <span className="text-[15px] font-medium text-white">
                  {t('composer.start', { defaultValue: 'Start' })} <span className="text-red-300" aria-hidden="true">*</span>
                </span>
                <div className="flex flex-nowrap items-center gap-2">
                  <span className="label-mono shrink-0 text-[10px] uppercase text-white/70">{tzLabel}</span>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    invalid={startInvalid}
                    placeholder={t('composer.pickDate', { defaultValue: 'Pick a date' })}
                  />
                  <TimePicker value={startTime} onChange={setStartTime} placeholder={t('composer.time', { defaultValue: 'Time' })} />
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-white/10 px-4 py-3.5 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-3">
                <span className="text-[15px] font-medium text-white">
                  {t('composer.end', { defaultValue: 'End' })} <span className="text-red-300" aria-hidden="true">*</span>
                </span>
                <div className="flex flex-nowrap items-center gap-2">
                  <span className="label-mono shrink-0 text-[10px] uppercase text-white/70">{tzLabel}</span>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    min={startDate || undefined}
                    invalid={endInvalid}
                    /* The single most useful control on an END field: 25 of
                       27 production events have no end set at all, and for
                       most of them the answer is "the same night". */
                    sameAs={startDate || undefined}
                    placeholder={t('composer.pickDate', { defaultValue: 'Pick a date' })}
                  />
                  <TimePicker value={endTime} onChange={setEndTime} placeholder={t('composer.time', { defaultValue: 'Time' })} />
                </div>
              </div>
            </div>
            {startInvalid && (
              <p className="mt-1.5 text-sm text-red-300">
                {t('composer.startError', { defaultValue: 'Pick when your event starts.' })}
              </p>
            )}
            {endInvalid && (
              <p className="mt-1.5 text-sm text-red-300">
                {endMissing
                  ? t('composer.endRequired', {
                      defaultValue: 'Add when your event ends, so attendees know how long it runs.',
                    })
                  : t('composer.endError', {
                      defaultValue: 'The end time must be after the start time.',
                    })}
              </p>
            )}

            {/* National day: one quiet toggle, only when the date is near one. */}
            {eligibleNationalDay && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3.5">
                <span className="min-w-0">
                  <span className="block text-[15px] text-white/80">
                    {t('composer.nationalDay.label', { day: nationalDayLabel, defaultValue: 'Part of {{day}}?' })}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-white/50">
                    {t('composer.nationalDay.hint', { day: nationalDayLabel, defaultValue: 'Feature it on the {{day}} banner.' })}
                  </span>
                </span>
                <Toggle
                  on={nationalDayOn}
                  onChange={setNationalDayOn}
                  label={t('composer.nationalDay.label', { day: nationalDayLabel, defaultValue: 'Part of {{day}}?' })}
                />
              </div>
            )}

            {/* Repeats — create-only. Generates a series of independent events. */}
            {!isEdit && (
              <div className="mt-3 rounded-xl bg-white/[0.03] px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[15px] text-white/80">
                    <Repeat className="h-4 w-4 text-white/50" /> {t('composer.repeats', { defaultValue: 'Repeats' })}
                  </span>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={tx('event_composer.repeats')}>
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRecurrence(opt.value)}
                        aria-pressed={recurrence === opt.value}
                        className={chipCls(recurrence === opt.value)}
                      >
                        {t(`composer.recurrence.${opt.value}`, { defaultValue: opt.label })}
                      </button>
                    ))}
                  </div>
                </div>
                {recurrence !== 'none' && (
                  <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                    {/* Bound the series either by a count or by an end date. */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-sm text-white/70">{t('composer.ends', { defaultValue: 'Ends' })}</span>
                      <div className="flex flex-wrap gap-2" role="group" aria-label={tx('event_composer.series_length')}>
                        {([
                          ['count', t('composer.forNDates', { defaultValue: 'For N dates' })],
                          ['until', t('composer.untilADate', { defaultValue: 'Until a date' })],
                        ] as const).map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setRecurrenceMode(val)}
                            aria-pressed={recurrenceMode === val}
                            className={chipCls(recurrenceMode === val)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {recurrenceMode === 'count' ? (
                      <label className="flex items-center justify-between gap-3">
                        <span className="text-sm text-white/70">
                          {t('composer.occurrences', { defaultValue: 'Number of occurrences (2 to 52)' })}
                        </span>
                        <input
                          type="number"
                          min={2}
                          max={MAX_RECURRENCE_COUNT}
                          value={recurrenceCount}
                          onChange={(e) => {
                            const n = Math.round(Number(e.target.value) || 2)
                            setRecurrenceCount(Math.max(2, Math.min(MAX_RECURRENCE_COUNT, n)))
                          }}
                          aria-label={t('composer.occurrencesAria', { defaultValue: 'Number of occurrences' })}
                          className={`w-20 text-right ${inset}`}
                        />
                      </label>
                    ) : (
                      <label className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm text-white/70">
                          {t('composer.repeatUntil', { defaultValue: 'Repeat until (max 52 events)' })}
                        </span>
                        <input
                          type="date"
                          min={startDate || undefined}
                          value={recurrenceEndDate}
                          onChange={(e) => setRecurrenceEndDate(e.target.value)}
                          aria-label={t('composer.repeatUntilAria', { defaultValue: 'Repeat until date' })}
                          className={inset}
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Event Details */}
          <div className="mt-8 border-t border-white/10 pt-6">
            <SectionTitle icon={Info}>{t('composer.details', { defaultValue: 'Event Details' })}</SectionTitle>
            <div className="space-y-3">
              {showDescription || description ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('composer.descPlaceholder', { defaultValue: 'Tell people what to expect…' })}
                  aria-label={tx('event_composer.event_description')}
                  rows={4}
                  autoFocus={showDescription}
                  className={field}
                />
              ) : (
                <button type="button" onClick={() => setShowDescription(true)} className={rowCls}>
                  <Pencil className="h-[18px] w-[18px] text-white/50" /> {t('composer.addDescription', { defaultValue: 'Add Description' })}
                </button>
              )}

              {/* Online toggle (kept compact) */}
              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3.5">
                <span className="flex items-center gap-2 text-[15px] text-white/80">
                  <Globe className="h-[18px] w-[18px] text-white/50" /> {t('composer.onlineEvent', { defaultValue: 'Online event' })}
                </span>
                <Toggle on={isOnline} onChange={setIsOnline} label={tx('event_composer.online_event')} />
              </div>

              {!isOnline && (
                <>
                  {/* Invalid keeps a ring — an error is the one moment a hard
                      edge is the right signal, and a red FILL would read as a
                      destructive control rather than a field needing input. */}
                  <div
                    className={`flex items-center gap-3 rounded-xl px-4 transition-colors ${
                      locationInvalid
                        ? 'bg-red-500/[0.07] ring-1 ring-red-400/60'
                        : 'bg-white/[0.05] focus-within:bg-white/[0.08] focus-within:ring-2 focus-within:ring-brand-400/50'
                    }`}
                  >
                    <MapPin className="h-[18px] w-[18px] shrink-0 text-white/50" />
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder={t('composer.locationPlaceholder', { defaultValue: 'Location / address' })}
                      aria-label={tx('event_composer.location_or_address')}
                      className="w-full bg-transparent py-3.5 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex items-center gap-3 rounded-xl bg-white/[0.05] px-4 transition-colors focus-within:bg-white/[0.08] focus-within:ring-2 focus-within:ring-brand-400/50">
                      <Globe className="h-[18px] w-[18px] shrink-0 text-white/50" />
                      <input
                        value={venueName}
                        onChange={(e) => setVenueName(e.target.value)}
                        placeholder={t('composer.venuePlaceholder', { defaultValue: 'Venue name' })}
                        aria-label={tx('event_composer.venue_name')}
                        className="w-full bg-transparent py-3.5 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
                      />
                    </div>
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder={t('composer.cityPlaceholder', { defaultValue: 'City' })}
                      aria-label="City"
                      className={field}
                    />
                  </div>
                  {locationInvalid && (
                    <p className="text-sm text-red-300">
                      {t('composer.locationError', {
                        defaultValue: 'Add a venue, address, or city for in-person events.',
                      })}
                    </p>
                  )}
                </>
              )}

              {/* Category as a Posh-style row of chips */}
              <div className="rounded-xl bg-white/[0.03] px-4 py-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-white/50">
                  {/* Tag, not Star: a star means featured/favourite everywhere
                      else in this app, so it read as "star this category". */}
                  <Tag className="h-4 w-4" /> {t('composer.category', { defaultValue: 'Category' })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={chipCls(category === cat)}
                    >
                      {t(`categories.${cat}`, { defaultValue: cat })}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Tickets */}
          {sellMode === 'tickets' && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <SectionTitle
                icon={Ticket}
                right={
                  <button
                    type="button"
                    onClick={addTier}
                    aria-label={t('composer.addTicketType', { defaultValue: 'Add ticket type' })}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/70 transition-colors hover:bg-white/[0.14] hover:text-white"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                }
              >
                {t('composer.tickets', { defaultValue: 'Tickets' })}
              </SectionTitle>

              {/* Currency — HTG or USD (attendees see HTG by default) */}
              <div className="mb-3 flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3">
                <span className="label-mono text-[11px] uppercase tracking-wide text-white/70">
                  {t('composer.currency', { defaultValue: 'Currency' })}
                </span>
                <div className="flex rounded-full bg-white/[0.06] p-0.5" role="group" aria-label={tx('event_composer.ticket_currency')}>
                  {allowedCurrencies.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCurrency(c)}
                      aria-pressed={currency === c}
                      className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
                        currency === c ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Each tier is ONE SUMMARY ROW — name · price · qty — with its
                  windows, description and options behind an expandable panel
                  that starts collapsed. Three tiers used to mean ~27 controls
                  on screen before anyone had typed a name. */}
              <div className="space-y-3">
                {tiers.map((tier, i) => {
                  const isOpen = openTierId === tier.id
                  const panelId = `tier-panel-${tier.id}`
                  const menuOpen = menuTierId === tier.id
                  const rowLabel = tier.name.trim() || `#${i + 1}`
                  return (
                    <div key={tier.id} className="rounded-xl bg-white/[0.03]">
                      {/* ── SUMMARY ROW ───────────────────────────────────
                          An explicit two-line layout, not a wrapping flex.
                          As `flex flex-wrap` the five controls needed ~408px
                          in the ~346px a phone gives, so the row wrapped and
                          the chevron and ⋮ landed wherever there was room —
                          which is why the ⋮ menu, anchored `right-0` to a
                          button that had drifted to the middle of the row,
                          opened off the left edge of the screen. Name on its
                          own line; price and quantity left, actions pinned
                          right, so `right-0` is always the card's right edge.
                          Each cell carries a caption: two right-aligned number
                          boxes side by side are indistinguishable otherwise
                          (owner ask). */}
                      <div className="p-3">
                        <label className="block">
                        <input
                          value={tier.name}
                          onChange={(e) => updateTier(tier.id, { name: e.target.value })}
                          placeholder={t('composer.tierPlaceholder', {
                            defaultValue: 'Ticket type {{n}} (e.g. General, VIP, Early Bird)',
                            n: i + 1,
                          })}
                          aria-label={t('composer.tierNameAria', {
                            defaultValue: 'Ticket type {{n}} name',
                            n: i + 1,
                          })}
                          className="w-full rounded-lg bg-white/[0.05] px-2 py-2 text-[15px] text-white placeholder:text-white/35 transition-colors hover:bg-white/[0.08] focus:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                        />
                          <span className="label-mono mt-1 block px-2 text-[10px] uppercase tracking-wider text-white/35">
                            {t('composer.tierNameLabel', { defaultValue: 'Name' })}
                          </span>
                        </label>

                        <div className="mt-2.5 flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">

                            {/* Price — a free tier reads as a dot + label, never an input of 0. */}
                            {tier.free ? (
                              <DotLabel>{t('composer.tier.free', { defaultValue: 'Free' })}</DotLabel>
                            ) : (
                              <label className="block shrink-0">
                                <input
                                  type="number"
                                  min="0"
                                  value={tier.price}
                                  onChange={(e) => updateTier(tier.id, { price: e.target.value })}
                                  placeholder={currency}
                                  aria-label={t('composer.tierPriceAria', {
                                    defaultValue: 'Price for {{tier}} ({{currency}})',
                                    tier: rowLabel,
                                    currency,
                                  })}
                                  className="w-[5.5rem] rounded-lg bg-white/[0.06] px-2 py-2 text-right text-[16px] text-white [color-scheme:dark] placeholder:text-white/30 transition-colors focus:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                                />
                                <span className="label-mono mt-1 block text-right text-[10px] uppercase tracking-wider text-white/35">
                                  {t('composer.tierPriceLabel', { defaultValue: 'Price' })}
                                </span>
                              </label>
                            )}

                            {/* Quantity — replaced outright by "Unlimited". */}
                            {tier.unlimited ? (
                              <DotLabel>{t('composer.tier.unlimited', { defaultValue: 'Unlimited' })}</DotLabel>
                            ) : (
                              <label className="block shrink-0">
                                <input
                                  type="number"
                                  min="0"
                                  value={tier.qty}
                                  onChange={(e) => updateTier(tier.id, { qty: e.target.value })}
                                  placeholder={t('composer.qtyShort', { defaultValue: 'Qty' })}
                                  aria-label={t('composer.tierQtyAria', {
                                    defaultValue: 'Quantity for {{tier}}',
                                    tier: rowLabel,
                                  })}
                                  className="w-[4.5rem] rounded-lg bg-white/[0.06] px-2 py-2 text-right text-[16px] text-white [color-scheme:dark] placeholder:text-white/30 transition-colors focus:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                                />
                                <span className="label-mono mt-1 block text-right text-[10px] uppercase tracking-wider text-white/35">
                                  {t('composer.tierQtyLabel', { defaultValue: 'Qty' })}
                                </span>
                              </label>
                            )}

                            {tier.hidden && (
                              <DotLabel tone="warn">
                                {t('composer.tier.hidden', { defaultValue: 'Hidden' })}
                              </DotLabel>
                            )}
                          </div>

                          {/* Actions, pinned right — so the ⋮ menu's `right-0`
                              is always the card's right edge. */}
                          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">

                        <button
                          type="button"
                          onClick={() => setOpenTierId(isOpen ? null : tier.id)}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          aria-label={t('composer.tierDetailsAria', {
                            defaultValue: 'Ticket options for {{tier}}',
                            tier: rowLabel,
                          })}
                          className="shrink-0 rounded-lg p-2 text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white"
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {/* Overflow ⋮ — details, duplicate, delete. */}
                        <div className="relative shrink-0" data-tier-menu>
                          <button
                            type="button"
                            onClick={() => setMenuTierId(menuOpen ? null : tier.id)}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label={t('composer.tierMenuAria', {
                              defaultValue: 'More actions for {{tier}}',
                              tier: rowLabel,
                            })}
                            className="rounded-lg p-2 text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuOpen && (
                            <div
                              role="menu"
                              /* max-w clamp as a belt: the anchor is now always the card's
                                 right edge, but a 224px menu must never be able to
                                 exceed a 402px screen minus its margins. */
                              className="absolute right-0 top-10 z-30 w-56 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-xl bg-[#141414] py-1 shadow-2xl ring-1 ring-white/10"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenTierId(tier.id)
                                  setMenuTierId(null)
                                }}
                                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                              >
                                <SlidersHorizontal className="h-4 w-4 shrink-0 text-white/45" />
                                {t('composer.tier.editDetails', { defaultValue: 'Ticket options' })}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => duplicateTier(tier.id)}
                                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                              >
                                <Copy className="h-4 w-4 shrink-0 text-white/45" />
                                {t('composer.tier.duplicate', { defaultValue: 'Duplicate tier' })}
                              </button>
                              {tiers.length > 1 && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    removeTier(tier.id)
                                    setMenuTierId(null)
                                    if (openTierId === tier.id) setOpenTierId(null)
                                  }}
                                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.06] hover:text-red-300"
                                >
                                  <Trash2 className="h-4 w-4 shrink-0 text-white/45" />
                                  {t('composer.removeTier', { defaultValue: 'Remove ticket type' })}
                                </button>
                              )}
                            </div>
                          )}
                          </div>
                          </div>
                        </div>
                        {qtyBelowSold(tier) && (
                          <p className="mt-2 text-sm text-red-300">
                            {t('composer.qtyBelowSold', {
                              defaultValue: '{{sold}} already sold. The quantity can’t go below that.',
                              sold: tier.soldQuantity || 0,
                            })}
                          </p>
                        )}
                      </div>

                      {/* ── DETAIL PANEL (collapsed by default) ───────── */}
                      {isOpen && (
                        <div id={panelId} className="space-y-3 border-t border-white/10 p-4">
                          {/* Free ticket — the toggle removes the "type 0" hazard at its source. */}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="flex items-center gap-2 text-[15px] text-white/80">
                              {t('composer.tier.makeFree', { defaultValue: 'Make this a free ticket' })}
                              <InfoPopover
                                label={t('composer.tier.makeFree', { defaultValue: 'Make this a free ticket' })}
                                text={t('composer.tier.makeFreeHint', {
                                  defaultValue: 'This ticket is free. Buyers are never charged for it.',
                                })}
                              />
                            </span>
                            <Toggle
                              on={!!tier.free}
                              onChange={(v) => toggleFreeTier(tier.id, v)}
                              label={t('composer.tier.makeFree', { defaultValue: 'Make this a free ticket' })}
                            />
                          </div>

                          {/* Unlimited quantity */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                            <span className="flex items-center gap-2 text-[15px] text-white/80">
                              {t('composer.tier.unlimitedQty', { defaultValue: 'Unlimited quantity' })}
                              <InfoPopover
                                label={t('composer.tier.unlimitedQty', { defaultValue: 'Unlimited quantity' })}
                                text={t('composer.tier.unlimitedHint', {
                                  defaultValue: 'No cap on how many of this ticket you can sell.',
                                })}
                              />
                            </span>
                            <Toggle
                              on={!!tier.unlimited}
                              onChange={(v) => toggleUnlimitedTier(tier.id, v)}
                              label={t('composer.tier.unlimitedQty', { defaultValue: 'Unlimited quantity' })}
                            />
                          </div>

                          {/* Per-tier description (the column always existed; web used to null it) */}
                          <div className="border-t border-white/10 pt-3">
                            <label className="block">
                              <span className="label-mono mb-1.5 block text-[10px] uppercase text-white/70">
                                {t('composer.tier.description', { defaultValue: 'Ticket description' })}
                              </span>
                              <textarea
                                value={tier.description || ''}
                                onChange={(e) => updateTier(tier.id, { description: e.target.value })}
                                rows={2}
                                placeholder={t('composer.tier.descriptionPlaceholder', {
                                  defaultValue: 'What does this ticket include?',
                                })}
                                aria-label={t('composer.tierDescAria', {
                                  defaultValue: 'Description for {{tier}}',
                                  tier: rowLabel,
                                })}
                                className={`${field} resize-none`}
                              />
                            </label>
                          </div>

                          {/* Limit purchase quantity — how many of THIS tier one order may hold. */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                            <span className="flex items-center gap-2 text-[15px] text-white/80">
                              {t('composer.tier.limitQty', { defaultValue: 'Limit purchase quantity' })}
                              <InfoPopover
                                label={t('composer.tier.limitQty', { defaultValue: 'Limit purchase quantity' })}
                                text={t('composer.tier.limitQtyHint', {
                                  defaultValue:
                                    'The most of this ticket one order can contain. Leave it off for no limit.',
                                })}
                              />
                            </span>
                            <span className="flex items-center gap-3">
                              {!!tier.maxPerOrder && (
                                <input
                                  type="number"
                                  min="1"
                                  value={tier.maxPerOrder}
                                  onChange={(e) => updateTier(tier.id, { maxPerOrder: e.target.value })}
                                  aria-label={t('composer.tierLimitAria', {
                                    defaultValue: 'Maximum per order for {{tier}}',
                                    tier: rowLabel,
                                  })}
                                  className={`w-20 text-right ${inset}`}
                                />
                              )}
                              <Toggle
                                on={!!tier.maxPerOrder}
                                onChange={(v) => updateTier(tier.id, { maxPerOrder: v ? '4' : '' })}
                                label={t('composer.tier.limitQty', { defaultValue: 'Limit purchase quantity' })}
                              />
                            </span>
                          </div>

                          {/* Hide the tier — is_active:false. Already honoured by the
                              selector and all three payment-initiation routes. */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                            <span className="flex items-center gap-2 text-[15px] text-white/80">
                              {t('composer.tier.hide', { defaultValue: 'Hide this ticket' })}
                              <InfoPopover
                                label={t('composer.tier.hide', { defaultValue: 'Hide this ticket' })}
                                text={t('composer.tier.hideHint', {
                                  defaultValue:
                                    'Hidden tickets never show on the event page and cannot be bought online. Useful for a tier you sell yourself.',
                                })}
                              />
                            </span>
                            <Toggle
                              on={!!tier.hidden}
                              onChange={(v) => updateTier(tier.id, { hidden: v })}
                              label={t('composer.tier.hide', { defaultValue: 'Hide this ticket' })}
                            />
                          </div>

                          {/* Per-tier waitlist */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                            <span className="flex items-center gap-2 text-[15px] text-white/80">
                              {t('composer.tier.waitlist', { defaultValue: 'Waitlist when sold out' })}
                              <InfoPopover
                                label={t('composer.tier.waitlist', { defaultValue: 'Waitlist when sold out' })}
                                text={t('composer.tier.waitlistHint', {
                                  defaultValue:
                                    'Collect names for this ticket once it sells out. Each ticket type has its own list.',
                                })}
                              />
                            </span>
                            <Toggle
                              on={!!tier.waitlist}
                              onChange={(v) => updateTier(tier.id, { waitlist: v })}
                              label={t('composer.tier.waitlist', { defaultValue: 'Waitlist when sold out' })}
                            />
                          </div>

                          {/* Optional per-tier sale window. Leave blank for no bound. */}
                          <div className="grid grid-cols-1 gap-3 border-t border-white/10 pt-3 sm:grid-cols-2">
                            <label className="block">
                              <span className="label-mono mb-1 block text-[10px] uppercase text-white/70">
                                {t('composer.salesStart', { defaultValue: 'Sales start' })}
                              </span>
                              <input
                                type="datetime-local"
                                /* Sizing for every date/time input lives in
                                   app/globals.css — `min-w-0` alone does NOT
                                   hold on iOS, which is why these spilled out
                                   of the card. Don't re-fix it per field. */
                                value={tier.salesStart || ''}
                                onChange={(e) => updateTier(tier.id, { salesStart: e.target.value })}
                                aria-label={`Ticket type ${i + 1} sales start`}
                                className={field}
                              />
                            </label>
                            <label className="block">
                              <span className="label-mono mb-1 block text-[10px] uppercase text-white/70">
                                {t('composer.salesEnd', { defaultValue: 'Sales end' })}
                              </span>
                              <input
                                type="datetime-local"
                                /* Sizing for every date/time input lives in
                                   app/globals.css — `min-w-0` alone does NOT
                                   hold on iOS, which is why these spilled out
                                   of the card. Don't re-fix it per field. */
                                value={tier.salesEnd || ''}
                                min={tier.salesStart || undefined}
                                onChange={(e) => updateTier(tier.id, { salesEnd: e.target.value })}
                                aria-label={`Ticket type ${i + 1} sales end`}
                                className={field}
                              />
                            </label>
                          </div>
                          {saleWindowInvalid(tier) && (
                            <p className="text-sm text-red-300">
                              {t('composer.saleWindowError', { defaultValue: 'Sales end must be after sales start.' })}
                            </p>
                          )}
                          {/* Optional per-tier entry (validity) window — when the ticket
                              admits the holder. Leave blank to admit anytime. */}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="block">
                              <span className="label-mono mb-1 block text-[10px] uppercase text-white/70">
                                {t('composer.validFrom', { defaultValue: 'Valid from' })}
                              </span>
                              <input
                                type="datetime-local"
                                /* Sizing for every date/time input lives in
                                   app/globals.css — `min-w-0` alone does NOT
                                   hold on iOS, which is why these spilled out
                                   of the card. Don't re-fix it per field. */
                                value={tier.validFrom || ''}
                                onChange={(e) => updateTier(tier.id, { validFrom: e.target.value })}
                                aria-label={`Ticket type ${i + 1} valid from`}
                                className={field}
                              />
                            </label>
                            <label className="block">
                              <span className="label-mono mb-1 block text-[10px] uppercase text-white/70">
                                {t('composer.validUntil', { defaultValue: 'Valid until' })}
                              </span>
                              <input
                                type="datetime-local"
                                /* Sizing for every date/time input lives in
                                   app/globals.css — `min-w-0` alone does NOT
                                   hold on iOS, which is why these spilled out
                                   of the card. Don't re-fix it per field. */
                                value={tier.validUntil || ''}
                                min={tier.validFrom || undefined}
                                onChange={(e) => updateTier(tier.id, { validUntil: e.target.value })}
                                aria-label={`Ticket type ${i + 1} valid until`}
                                className={field}
                              />
                            </label>
                          </div>
                          {validityWindowInvalid(tier) && (
                            <p className="text-sm text-red-300">
                              {t('composer.validityError', { defaultValue: 'Valid until must be after valid from.' })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={addTier}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-transparent px-4 py-3 text-sm font-semibold text-white/70 transition-colors hover:border-white/30 hover:text-white"
                >
                  <Plus className="h-4 w-4" /> {t('composer.addTicketType', { defaultValue: 'Add ticket type' })}
                </button>
              </div>

              {/* WHO PAYS THE SERVICE FEE — only meaningful once something costs money. */}
              {isPaid && (
                <div className="mt-3 rounded-xl bg-white/[0.025] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[15px] text-white/80">
                        {t('composer.fee.passTitle', { defaultValue: 'Pass the service fee to buyers' })}
                      </p>
                      <p className="mt-1 text-xs text-white/50">
                        {passFeesToBuyer
                          ? t('composer.fee.onDesc', {
                              defaultValue:
                                'Buyers pay the fee on top of your ticket price. You receive the full price you set.',
                            })
                          : t('composer.fee.offDesc', {
                              defaultValue:
                                'The fee comes out of your ticket price. Buyers pay exactly what you set, and you receive less.',
                            })}
                      </p>
                    </div>
                    <Toggle
                      on={passFeesToBuyer}
                      onChange={setPassFeesToBuyer}
                      label={tx('event_composer.pass_service_fee')}
                    />
                  </div>
                  <p className="mt-3 border-t border-white/10 pt-3 text-xs text-white/50">
                    {feeExample}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Guestlist — the lineup: artists, hosts & special guests joining */}
          <div className="mt-8 border-t border-white/10 pt-6">
            {/* The standing paragraph of explanation is now an (i) popover;
                the show-on-page toggle moved into advanced Page Settings. */}
            <SectionTitle
              icon={Users}
              info={t('composer.guestlistHint', {
                defaultValue: 'Add the artists, hosts, DJs and special guests performing or joining your event.',
              })}
            >
              {t('composer.guestlist', { defaultValue: 'Guestlist' })}
            </SectionTitle>

            <div className="space-y-4 rounded-xl bg-white/[0.025] p-4">
              {/* How the list appears to the public, chosen against a live
                  preview of the row the event page will draw. */}
              <GuestlistVisibilityPicker
                value={guestlistVisibility}
                onChange={setGuestlistVisibility}
                faces={guests.map((g) => ({ id: g.id, name: g.name, photoUrl: g.photoUrl }))}
              />

              <div className="h-px bg-white/[0.07]" />

              {/* The bill so far, in running order. Each row is the whole entry
                  in miniature, face, name, role, set time, whether a link is
                  attached, and clicking it reopens the editor. */}
              {guests.length > 0 && (
                <div className="space-y-2">
                  {guests.map((g, i) => (
                    <div
                      key={g.id}
                      className="flex items-center gap-3 rounded-lg bg-white/[0.055] px-3 py-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => openEditGuest(g)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        aria-label={t('composer.editGuest', { defaultValue: 'Edit {{name}}', name: g.name })}
                      >
                        {g.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={g.photoUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-bold text-white">
                            {g.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-white">{g.name}</span>
                          <span className="flex items-center gap-1.5 text-xs text-white/50">
                            <span>{t(`composer.roles.${g.role}`, { defaultValue: g.role })}</span>
                            {g.startTime && (
                              <>
                                <span aria-hidden>·</span>
                                <span>
                                  {g.startTime}
                                  {g.endTime ? `, ${g.endTime}` : ''}
                                </span>
                              </>
                            )}
                            {g.link && <Link2 className="h-3 w-3" aria-hidden />}
                          </span>
                        </span>
                      </button>
                      {/* Running order. Both arrows always render (disabled at
                          the ends) so the row's controls never shift position
                          as entries move. */}
                      <span className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          onClick={() => moveGuest(g.id, -1)}
                          disabled={i === 0}
                          className="rounded p-0.5 text-white/40 transition-colors hover:text-white disabled:opacity-20 disabled:hover:text-white/40"
                          aria-label={t('composer.moveUp', { defaultValue: 'Move earlier' })}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveGuest(g.id, 1)}
                          disabled={i === guests.length - 1}
                          className="rounded p-0.5 text-white/40 transition-colors hover:text-white disabled:opacity-20 disabled:hover:text-white/40"
                          aria-label={t('composer.moveDown', { defaultValue: 'Move later' })}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeGuest(g.id)}
                        className="shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/[0.04] hover:text-red-300"
                        aria-label={t('composer.removeGuest', { defaultValue: 'Remove {{name}}', name: g.name })}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={openNewGuest}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm font-semibold text-white/70 transition-colors hover:border-white/30 hover:text-white"
              >
                <Plus className="h-4 w-4" /> {t('composer.addToGuestlist', { defaultValue: 'Add to guestlist' })}
              </button>
            </div>
          </div>

          {/* The entry editor. Signed-out visitors upload the photo through the
              same guest-upload route as the poster, so a lineup can be built
              before there is an account. */}
          {guestDraft && (
            <GuestEditorSheet
              draft={guestDraft}
              roles={GUEST_ROLES}
              isNew={guestDraftIsNew}
              endpoint={guest ? '/api/guest-upload' : undefined}
              onPatch={patchGuestDraft}
              onSave={saveGuestDraft}
              onCancel={() => setGuestDraft(null)}
            />
          )}

          {/* ADVANCED — one control instead of two more sections shouting on
              first load. Title, dates, location and tickets stay open above;
              everything here is a refinement, not a requirement. Conditional
              render (not opacity) so collapsed controls are untabbable. */}
          <div className="mt-8 border-t border-white/10 pt-6">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className="flex items-center gap-2 text-[15px] font-medium text-white/80">
                <Settings className="h-4 w-4 text-white/50" />
                {advancedOpen
                  ? t('composer.hideAdvanced', { defaultValue: 'Hide advanced settings' })
                  : t('composer.showAdvanced', { defaultValue: 'Advanced settings' })}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${
                  advancedOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>

          {advancedOpen && (
            <>
          {/* The "Event Features — coming soon" row that used to sit here
              promised exactly what the Guestlist section above now does
              (performers with photos, links and set times), so it was removed
              rather than left contradicting a shipped feature. */}

          {/* Media rows */}
          <div className="mt-8 space-y-3 border-t border-white/10 pt-6">
            {/* Promo video — optional link (persisted as video_url). */}
            <div className="flex items-center gap-3 rounded-xl bg-white/[0.05] px-4 transition-colors focus-within:bg-white/[0.08] focus-within:ring-2 focus-within:ring-brand-400/50">
              <Youtube className="h-[18px] w-[18px] shrink-0 text-white/50" />
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder={t('composer.promoVideoPlaceholder', { defaultValue: 'Promo video link (YouTube, Vimeo…)' })}
                aria-label={tx('event_composer.promo_video_link')}
                className="w-full bg-transparent py-3.5 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-[15px] text-white/70">
              <span className="flex items-center gap-3">
                <ImageIcon className="h-[18px] w-[18px]" /> {t('composer.imageGallery', { defaultValue: 'Image Gallery' })}
              </span>
              <span className="inline-flex select-none items-center rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white/60">
                {t('composer.comingSoon', { defaultValue: 'Coming soon' })}
              </span>
            </div>
          </div>

          {/* Page Settings */}
          <div className="mt-8 border-t border-white/10 pt-6">
            <SectionTitle icon={Settings}>{t('composer.pageSettings', { defaultValue: 'Page Settings' })}</SectionTitle>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3.5">
                {/* "Discover", not "Explore". The field is `show_on_explore`
                    and the toggle said Explore, but there is no Explore
                    surface on the web — it governs /discover, the homepage
                    rails and the sitemap. The stored key keeps its name; the
                    label now matches what an organizer can actually go and
                    look at. */}
                <span className="text-[15px] text-white/80">{t('composer.showOnExplore', { defaultValue: 'Show on Discover' })}</span>
                <Toggle on={showOnExplore} onChange={setShowOnExplore} label={tx('event_composer.show_on_explore')} />
              </div>
              <div className="rounded-xl bg-white/[0.03] px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[15px] text-white/80">
                    <Lock className="h-4 w-4 text-white/50" /> {t('composer.passwordProtected', { defaultValue: 'Password Protected Event' })}
                  </span>
                  <Toggle on={passwordProtected} onChange={setPasswordProtected} label={tx('event_composer.password_protected')} />
                </div>
                {passwordProtected && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <input
                      type="text"
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      placeholder={
                        isEdit
                          ? t('composer.accessCodePlaceholderEdit', {
                              defaultValue: 'New access code (blank keeps current)',
                            })
                          : t('composer.accessCodePlaceholderNew', {
                              defaultValue: 'Access code (min 6 characters)',
                            })
                      }
                      aria-label={tx('event_composer.access_code')}
                      autoComplete="off"
                      className={`${field} ${accessCodeInvalid ? 'border-red-400/60' : ''}`}
                    />
                    {accessCodeInvalid ? (
                      <p className="mt-1.5 text-sm text-red-300">
                        {t('composer.accessCodeError', { defaultValue: 'Access codes must be at least 6 characters.' })}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-white/50">
                        {t('composer.accessCodeHint', {
                          defaultValue:
                            'Attendees must enter this code to view and buy. It’s stored hashed, so we never keep the plain code.',
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
            </>
          )}
        </div>

        {/* ===================== RIGHT — flyer + style ===================== */}
        <div className="order-1 lg:col-start-2 lg:row-start-1">
          <div className="space-y-4 lg:sticky lg:top-24">
            {/* Flyer. Guests upload through the API route (storage rules
                require auth for the client SDK); the file waits under
                guest-uploads/ and is promoted to event-images/ at create
                time. Abandoned ones are cleaned up after 7 days. */}
            <ImageUpload
              variant="flyer"
              currentImage={bannerUrl}
              onImageUploaded={(url) => setBannerUrl(url)}
              endpoint={guest ? '/api/guest-upload' : undefined}
            />
            {guest && (
              <p className="-mt-1 text-center text-[11px] text-white/40">
                {/* Short enough to hold one line at 11px in the 360px poster
                    column and on a phone, in all three locales — the longer
                    sentence wrapped to two and read as a warning. */}
                {t('composer.posterKept', {
                  defaultValue: 'Kept for 7 days while you finish.',
                })}
              </p>
            )}

            {/* Spotify — a real song search. Falls back to the old
                paste-a-URL input when the search route has no credentials. */}
            <SpotifySongPicker value={spotifyUrl} onChange={setSpotifyUrl} />

            {/* Font + accent */}
            <div className="space-y-3 rounded-xl bg-white/[0.025] p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-white/80">
                  <Type className="h-4 w-4 text-white/50" /> {t('composer.titleFont', { defaultValue: 'Title Font' })}
                </span>
                <select
                  value={titleFont}
                  onChange={(e) => setTitleFont(e.target.value as any)}
                  className={inset}
                >
                  <option value="Default">{t('composer.fonts.Default', { defaultValue: 'Default' })}</option>
                  <option value="Serif">{t('composer.fonts.Serif', { defaultValue: 'Serif' })}</option>
                  <option value="Sans">{t('composer.fonts.Sans', { defaultValue: 'Sans' })}</option>
                </select>
              </div>
              {/* The accent is TAKEN FROM THE POSTER, not chosen.
                  A seven-swatch picker used to sit here. It was dead: the
                  chosen hex was written to `accent_color` and read by nothing
                  in the app, so the organizer picked a colour and nothing ever
                  used it. And a colour picked in isolation rarely matches the
                  artwork anyway. The dominant colour of the flyer is extracted
                  client-side and shown here as a read-out, so it is honest
                  about being automatic. */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-white/80">
                  <Palette className="h-4 w-4 text-white/50" />{' '}
                  {t('composer.accentFromPoster', { defaultValue: 'Accent from poster' })}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-5 w-5 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: accentColor }}
                  />
                  <span className="font-mono text-[11px] uppercase text-white/40">
                    {bannerUrl
                      ? accentColor
                      : t('composer.accentAwaitingPoster', { defaultValue: 'add a flyer' })}
                  </span>
                </span>
              </div>
            </div>

            {/* The "Poster Theme" swatch row was here. It pinned the gradient
                used INSTEAD of a flyer, so it did nothing for the great
                majority of events (which have one), and on web it did nothing
                at all: every reader here resolves the gradient from a hash of
                the event id and none consult `theme_key`. Ten near-identical
                teal circles with no explanation, next to the flyer uploader,
                cost more confusion than they bought. `theme_key` itself lives
                on (the mobile composer's picker does work), and is preserved
                through a web edit, see the state initializer. */}

            {/* Series edit — apply shared field changes to every sibling. */}
            {isEdit && seriesId && (
              <label className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06]">
                <input
                  type="checkbox"
                  checked={applyToSeries}
                  onChange={(e) => setApplyToSeries(e.target.checked)}
                  aria-label={tx('event_composer.apply_to_series')}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600 [color-scheme:dark]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Repeat className="h-4 w-4 text-white/50" />{' '}
                    {t('composer.applySeries', { defaultValue: 'Apply changes to all events in this series' })}
                  </span>
                  <span className="mt-0.5 block text-xs text-white/60">
                    {t('composer.applySeriesHint', {
                      defaultValue: 'Updates every event in the series. Each keeps its own date & time.',
                    })}
                  </span>
                </span>
              </label>
            )}

          </div>
        </div>

        {/* ACTIONS — their own grid cell so mobile can put them last.
            On desktop they sit under the poster in column two, exactly where
            they were; on a phone they follow the form, which is the only place
            a "publish" button makes sense. */}
        <div className="order-3 lg:col-start-2 lg:row-start-2">
          <div className="space-y-4">
            {/* Save / Create */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-xl bg-brand-600 px-7 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {guest
                ? authed
                  ? t('composer.continueOrganizer', { defaultValue: 'Continue and set up your organizer profile' })
                  : t('composer.continueSignup', { defaultValue: 'Continue and sign up to publish' })
                : isEdit
                ? saving
                  ? t('composer.saving', { defaultValue: 'Saving…' })
                  : t('composer.saveChanges', { defaultValue: 'Save changes' })
                : saving
                ? t('composer.creating', { defaultValue: 'Creating…' })
                : readyToPublish
                ? t('composer.createEvent', { defaultValue: 'Create Event' })
                : /* Creation always writes is_published:false — publishing is a
                     separate, Stripe-gated step — so below 100% the button says
                     what it actually does instead of implying it goes live. */
                  t('composer.saveDraft', { defaultValue: 'Save as draft' })}
            </button>

            {isEdit ? (
              <>
                <button
                  type="button"
                  onClick={handleTogglePublish}
                  // 100% or nothing, on owner ask: "the last one only lights up
                  // after 100%. then the person can submit the event, otherwise
                  // save as we draft." Unpublishing is never blocked — an
                  // organizer must always be able to take a live event down,
                  // whatever state the form is in.
                  disabled={
                    publishing ||
                    (!isPublished && (paidPublishingBlocked || !readyToPublish))
                  }
                  className={`w-full rounded-xl px-7 py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                    isPublished
                      ? 'border border-white/15 text-white/80 hover:bg-white/[0.04]'
                      : 'bg-white text-black hover:bg-white/90'
                  }`}
                >
                  {publishing
                    ? t('composer.updating', { defaultValue: 'Updating…' })
                    : isPublished
                    ? t('composer.unpublish', { defaultValue: 'Unpublish (move to draft)' })
                    : t('composer.publishEvent', { defaultValue: 'Publish event' })}
                </button>
                {!isPublished && paidPublishingBlocked ? (
                  <p className="text-center text-xs text-amber-300">
                    {t('composer.verifyToPublish', {
                      defaultValue: 'Complete identity verification to publish paid events.',
                    })}
                  </p>
                ) : !isPublished && !readyToPublish ? (
                  /* A disabled button with no explanation is a dead end. The
                     bar at the top shows HOW far; this says how much is left. */
                  <p className="text-center text-xs text-white/70">
                    {t('composer.completeToPublish', {
                      count: quarters.length - quartersDone,
                      defaultValue: 'Fill in {{count}} more of the four to publish. Saved as a draft until then.',
                    })}
                  </p>
                ) : (
                  <p className="text-center text-xs text-white/70">
                    {isPublished
                      ? t('composer.liveNote', { defaultValue: 'Live. Visible to attendees.' })
                      : t('composer.draftNote', { defaultValue: 'Draft. Only you can see this.' })}
                  </p>
                )}
              </>
            ) : guest ? (
              <>
                <p className="text-center text-xs text-white/70">
                  {t('composer.guestFreeNote', {
                    defaultValue: 'Free to set up. Your draft is saved on this device, so nothing is lost at sign-in.',
                  })}
                </p>
                {isPaid && (
                  <p className="text-center text-xs text-amber-300/90">
                    {t('composer.guestPaidNote', {
                      defaultValue:
                        'Paid tickets need a one-time identity verification before the event can go live. You can finish setting everything up first.',
                    })}
                  </p>
                )}
              </>
            ) : (
              <p className="text-center text-xs text-white/70">
                {t('composer.savedPrivateNote', {
                  defaultValue: 'Saved as a private draft. Publish when you’re ready.',
                })}
              </p>
            )}

            {/* A restored draft always offers a way out — without this, an
                abandoned draft (or a stranger's, on a shared device) re-fills
                the form on every visit with no visible escape. */}
            {draftRestored && !isEdit && (
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem(DRAFT_KEY)
                  } catch {}
                  window.location.reload()
                }}
                className="w-full text-center text-xs text-white/45 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white/80"
              >
                {t('composer.startFresh', { defaultValue: 'Not your draft? Start fresh' })}
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
