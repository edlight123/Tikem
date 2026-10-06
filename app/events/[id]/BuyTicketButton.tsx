'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { isDemoMode } from '@/lib/demo'
import { normalizeCountryCode } from '@/lib/payment-provider'
import EventbriteStyleTicketSelector from '@/components/EventbriteStyleTicketSelector'
import { allSelectionsFree, computeSelectionTotal } from '@/lib/ticketPricing'
import { priceOrder } from '@/lib/checkout/buyer-pricing'
import BottomSheet from '@/components/ui/BottomSheet'
import { useToast } from '@/components/ui/Toast'
import GuestCheckoutForm, { type GuestContactInput } from './GuestCheckoutForm'
import { paymentNavigationMode } from '@/lib/utils/in-app-browser'
import { captureAttribution } from '@/lib/attribution-client'
import type { Attribution } from '@/lib/attribution'
import dynamic from 'next/dynamic'

const EmbeddedStripePayment = dynamic(() => import('./EmbeddedStripePayment'), { ssr: false })

/**
 * BUNDLE: no Firebase import at module scope. This button sits on EVERY event
 * page, and a static import of the client SDK put 444KB across three chunks
 * (223 + 136 + 85) out of ~988KB of shared JS on that route's first load — a
 * route only sheds it once its LAST static importer goes. Its one real use is
 * the access-grant read in the effect below, so Firestore is fetched there.
 * (An unused `firebaseDb as supabase` import also lived here and was doing
 * nothing but dragging the shim in.) Please don't hoist either back up.
 */

// Feature flag: Sogepay (Haiti card processing) is not live yet. While disabled, Haiti events
// show only MonCash/NatCash (no card option). Flip to true to re-enable the Sogepay card flow.
const SOGEPAY_ENABLED = false

// Feature flag: launching MonCash-only — NatCash hidden for now. The purchase
// handler and backend path stay intact; flip to true to bring the option back.
const NATCASH_ENABLED = false

/**
 * Refusals from /api/tickets/claim-free that the buyer can still recover from by
 * paying. Everything else (sold out, sales closed, …) is a real dead end.
 */
const PROMO_FAILURE_CODES = new Set([
  'promo_invalid',
  'promo_exhausted',
  'promo_not_free',
  'promo_requires_tier',
  'promo_redeem_failed',
  // The buyer has already used this code as many times as it allows.
  'promo_already_used',
  // A paid tier reaching the free endpoint at all means the discount didn't hold.
  'tier_not_free',
])

interface BuyTicketButtonProps {
  eventId: string
  /**
   * null for a logged-OUT visitor. That is no longer a dead end: they are asked for a
   * name, an email and (in Haiti) a phone number, and check out as a guest. The
   * signed-in path below is untouched.
   */
  userId: string | null
  isFree: boolean
  ticketPrice: number
  eventTitle?: string
  /** Event start, for the ticket selector's "selling fast" pace rule. */
  eventStartsAt?: string | null
  currency?: string
  country?: string
  isPasswordProtected?: boolean
}

export default function BuyTicketButton({ eventId, userId, isFree, ticketPrice, eventTitle = 'Event', currency = 'HTG', country, eventStartsAt, isPasswordProtected = false }: BuyTicketButtonProps) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const { showToast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [showTieredModal, setShowTieredModal] = useState(false)
  const [showEmbeddedPayment, setShowEmbeddedPayment] = useState(false)
  const [tierProbeLoading, setTierProbeLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pendingMethod, setPendingMethod] = useState<'stripe' | 'moncash' | 'natcash' | 'sogepay' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'moncash' | 'natcash' | 'sogepay'>('stripe')
  const [quantity, setQuantity] = useState(1)
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [selectedTierPrice, setSelectedTierPrice] = useState<number>(0)
  const [selectedTiers, setSelectedTiers] = useState<{ tierId: string; quantity: number; price: number; tierName?: string }[]>([])
  // Stores the promo code ID (promo_codes.id) once validated.
  const [promoCode, setPromoCode] = useState<string | undefined>()
  // ── Promoter attribution ────────────────────────────────────────────────────
  // `?ref=CODE` on the event URL names the promoter who sent this buyer. Read once
  // on mount (window.location, not useSearchParams — the page stays statically
  // revalidated) and mirrored to sessionStorage so it survives in-app-browser
  // reloads and the MonCash/Sogepay round trip. Never validated client-side and
  // never blocks a purchase: the server resolves it and silently drops junk.
  const [refCode, setRefCode] = useState<string | undefined>()
  useEffect(() => {
    try {
      const key = `tikem_ref:${eventId}`
      const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase()
      if (fromUrl) {
        // Last click wins: a newer promoter link overwrites a stored one.
        sessionStorage.setItem(key, fromUrl)
        setRefCode(fromUrl)
        return
      }
      const stored = sessionStorage.getItem(key)
      if (stored) setRefCode(stored)
    } catch {
      // Storage unavailable (private mode) — attribution stays best-effort.
    }
  }, [eventId])
  // Tracking-link / utm attribution (`?t=` + utm_*), captured the same way and
  // sent with every purchase body; the server re-resolves it against the event.
  const [attribution, setAttribution] = useState<Attribution | null>(null)
  useEffect(() => {
    setAttribution(captureAttribution(eventId).attribution)
  }, [eventId])
  const [isMonCashPopupOpen, setIsMonCashPopupOpen] = useState(false)
  const moncashPopupRef = useRef<Window | null>(null)

  const countryCode = normalizeCountryCode(country)
  const isHaitiEvent = countryCode === 'HT'

  // ── Guest checkout ──────────────────────────────────────────────────────────
  // Collected once per visit, then attached to whichever endpoint the buyer reaches
  // (free claim, MonCash initiate, Stripe PaymentIntent). Held in memory only; the
  // server is what actually validates it and creates the guest order.
  const isGuestCheckout = !userId
  const [guestContact, setGuestContact] = useState<GuestContactInput | null>(null)
  const [showGuestForm, setShowGuestForm] = useState(false)
  /** The action to resume once the guest has given their details. */
  const pendingGuestActionRef = useRef<'free' | 'paid' | null>(null)

  /**
   * A GUEST's access code for a password-protected event.
   *
   * An account holder proves the code once and the server stores a grant against
   * their uid; a guest has no uid until their order is created, so there is nothing
   * to grant against up front. Their proof therefore travels WITH the checkout
   * request and is re-verified server-side before the order exists. Held in a ref,
   * in memory only, for the length of this visit — never persisted, never logged.
   */
  const accessCodeRef = useRef<string | null>(null)
  const guestBody = guestContact ? { guest: guestContact } : {}
  /** The access-code field a guest's checkout request must carry, if any. */
  const accessBody =
    isGuestCheckout && isPasswordProtected && accessCodeRef.current
      ? { accessCode: accessCodeRef.current }
      : {}

  // Password-protected access gate state.
  // hasAccess: null = unknown (still checking), true/false once resolved.
  const [hasAccess, setHasAccess] = useState<boolean | null>(isPasswordProtected ? null : true)
  const [showCodePrompt, setShowCodePrompt] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [verifyingCode, setVerifyingCode] = useState(false)
  // Which action to resume after a successful unlock.
  const pendingActionRef = useRef<'free' | 'paid' | null>(null)

  // On mount, read the user's existing grant so we can skip the prompt if
  // already unlocked. A client read of access_grants/{uid} is permitted by rules.
  useEffect(() => {
    if (!isPasswordProtected) {
      setHasAccess(true)
      return
    }
    if (isDemoMode()) {
      setHasAccess(true)
      return
    }
    // A guest has no uid and therefore no grant to read, so they always start locked
    // and are asked for the code. Unlocking is per visit for them: the code they type
    // is held in memory and re-verified by the server with their order.
    if (!userId) {
      setHasAccess(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        // Firestore arrives here, not at module scope — see the BUNDLE note at
        // the top. `cancelled` already guarded the read; it now also covers the
        // chunk fetch that precedes it, so an unmount (or StrictMode's
        // double-invoke in dev) never writes state on a dead component. There
        // is no listener to unsubscribe, only this one-shot read.
        const [{ doc, getDoc }, { db }] = await Promise.all([
          import('firebase/firestore'),
          import('@/lib/firebase/client'),
        ])
        if (cancelled) return
        const snap = await getDoc(doc(db, 'events', eventId, 'access_grants', userId))
        if (!cancelled) setHasAccess(snap.exists())
      } catch {
        if (!cancelled) setHasAccess(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventId, userId, isPasswordProtected])

  /**
   * Buyer-facing copy for a `code` returned by /api/tickets/claim-free. The
   * endpoint's English `error` string is for logs; what the buyer reads is
   * localized here (with an English defaultValue until the keys land).
   */
  function localizedClaimError(code: string): string {
    switch (code) {
      case 'promo_invalid':
        return t('events.claim_promo_invalid', {
          defaultValue: 'This promo code is no longer valid for this event.',
        })
      case 'promo_exhausted':
        return t('events.claim_promo_exhausted', {
          defaultValue: 'This promo code has reached its usage limit.',
        })
      case 'promo_not_free':
        return t('events.claim_promo_not_free', {
          defaultValue: 'This promo code does not cover the full price of these tickets.',
        })
      case 'promo_requires_tier':
        return t('events.claim_promo_requires_tier', {
          defaultValue: 'Choose a ticket type before using this promo code.',
        })
      case 'promo_redeem_failed':
        return t('events.claim_promo_failed', {
          defaultValue: 'We could not apply this promo code. Please try again.',
        })
      case 'tier_not_free':
      case 'event_not_free':
        return t('events.claim_not_free', { defaultValue: 'These tickets are not free.' })
      case 'tier_inactive':
      case 'tier_not_found':
        return t('events.claim_tier_unavailable', {
          defaultValue: 'This ticket type is no longer available.',
        })
      case 'tier_not_started':
        return t('events.claim_sales_not_started', {
          defaultValue: 'Ticket sales have not started yet.',
        })
      case 'tier_sales_ended':
        return t('events.claim_sales_ended', { defaultValue: 'Ticket sales have ended.' })
      case 'already_claimed':
        return t('events.claim_already_claimed', { defaultValue: "You already claimed tickets for this event. Check your email for them." })
      case 'promo_already_used':
        return t('events.claim_promo_already_used', { defaultValue: "You have already used this promo code." })
      case 'event_cancelled':
        return t('events.claim_event_cancelled', { defaultValue: "This event has been cancelled." })
      case 'event_unavailable':
        return t('events.claim_event_unavailable', { defaultValue: "This event is not available right now." })
      case 'event_ended':
        return t('events.claim_event_ended', { defaultValue: "This event has already ended." })
      case 'tier_sold_out':
      case 'no_tickets_available':
        return t('events.claim_sold_out', { defaultValue: 'These tickets are sold out.' })
      case 'limited_availability':
        return t('events.claim_limited', {
          defaultValue: 'There are not enough tickets left for this order.',
        })
      case 'too_many_tickets':
        return t('events.claim_too_many', {
          defaultValue: 'You can claim at most 10 free tickets at a time.',
        })
      case 'access_code_required':
        return t('events.password_required', { defaultValue: 'Password required' })
      default:
        return t('events.claim_generic_error', {
          defaultValue: 'Could not claim your ticket. Please try again.',
        })
    }
  }

  /**
   * Resume what the buyer was doing once the event is unlocked.
   *
   * Re-enters `gateOrRun` rather than calling the handlers directly, so a GUEST who
   * has just unlocked still passes through the contact-details gate — without this
   * they would hit the claim/purchase endpoint with no name, email or phone, and
   * there would be nowhere to send the ticket.
   */
  function runPendingAction() {
    const action = pendingActionRef.current
    pendingActionRef.current = null
    // `accessJustProven` matters: this runs in the same tick as setHasAccess(true),
    // so `hasAccess` still reads false in this closure and the gate below would
    // re-prompt for a code the buyer has just entered correctly.
    if (action) gateOrRun(action, { accessJustProven: true })
  }

  // Entry-point gate: for password-protected events without a grant, prompt for
  // the code before running the real purchase/claim flow.
  function gateOrRun(action: 'free' | 'paid', opts?: { accessJustProven?: boolean }) {
    if (!opts?.accessJustProven && isPasswordProtected && hasAccess !== true) {
      pendingActionRef.current = action
      setCodeInput('')
      setCodeError(null)
      setShowCodePrompt(true)
      return
    }
    // A logged-out buyer gives their name / email / phone once, here, and then the
    // normal flow continues. No password, no account, no redirect to a sign-in page
    // that cannot complete inside an Instagram WebView.
    if (isGuestCheckout && !guestContact) {
      pendingGuestActionRef.current = action
      setShowGuestForm(true)
      return
    }
    if (action === 'free') {
      handleClaimFreeTicket()
    } else {
      handleOpenPurchaseFlow()
    }
  }

  /** Stash the guest's details and resume whatever they were trying to do. */
  function handleGuestSubmit(contact: GuestContactInput) {
    setGuestContact(contact)
    setShowGuestForm(false)
    const action = pendingGuestActionRef.current
    pendingGuestActionRef.current = null
    if (action === 'free') {
      handleClaimFreeTicket(undefined, undefined, contact)
    } else if (action === 'paid') {
      handleOpenPurchaseFlow()
    }
  }

  async function handleVerifyCode(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const code = codeInput.trim()
    if (!code) {
      setCodeError(t('events.password_required', { defaultValue: 'Please enter the access code.' }))
      return
    }
    setVerifyingCode(true)
    setCodeError(null)
    try {
      const res = await fetch('/api/events/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        // A signed-in buyer now holds a server-side grant (`data.granted`). A guest
        // got only the answer, so keep their code for the checkout request that
        // re-proves it.
        if (!data?.granted) accessCodeRef.current = code
        setHasAccess(true)
        setShowCodePrompt(false)
        setCodeInput('')
        runPendingAction()
        return
      }
      if (res.status === 429) {
        setCodeError(t('events.password_throttled', { defaultValue: 'Too many attempts. Please try again later.' }))
      } else {
        setCodeError(t('events.password_incorrect', { defaultValue: 'Incorrect access code. Please try again.' }))
      }
    } catch {
      setCodeError(t('events.password_error', { defaultValue: 'Could not verify the code. Please try again.' }))
    } finally {
      setVerifyingCode(false)
    }
  }

  async function handleOpenPurchaseFlow() {
    if (loading || tierProbeLoading) return
    setError(null)

    // Prefer tiered checkout when tiers exist; otherwise fall back to the legacy
    // single-price purchase modal (this matches the empty-state guidance shown
    // in the tier selector).
    setTierProbeLoading(true)
    try {
      const res = await fetch(`/api/ticket-tiers?eventId=${encodeURIComponent(String(eventId))}`)
      const data = await res.json().catch(() => ({}))
      const tiers = Array.isArray(data?.tiers) ? data.tiers : []

      if (tiers.length > 0) {
        setShowTieredModal(true)
      } else {
        setShowModal(true)
      }
    } catch {
      setShowModal(true)
    } finally {
      setTierProbeLoading(false)
    }
  }

  const [usdHtgQuote, setUsdHtgQuote] = useState<null | {
    baseRate: number
    effectiveRate: number
    spreadPercent: number
    provider: string
    fetchedAtIso: string
    amountUsd: number
    amountHtg: number
    chargeCurrency: string
  }>(null)
  const [usdHtgQuoteError, setUsdHtgQuoteError] = useState<string | null>(null)
  const [usdHtgQuoteLoading, setUsdHtgQuoteLoading] = useState(false)

  /** Face total for the current selection — what the organizer priced. */
  const totalAmountDisplay = useMemo(() => {
    return selectedTiers.length > 0
      ? selectedTiers.reduce((sum, t) => sum + t.price * t.quantity, 0)
      : (selectedTierPrice || ticketPrice) * quantity
  }, [quantity, selectedTierPrice, selectedTiers, ticketPrice])

  /**
   * The ALL-IN total for the current selection.
   *
   * In a buyer-pays market (US/CA/FR) the fee is added on top, so this is above the
   * face total and is the only number allowed to be presented as "total" — US rules
   * on live-event ticket pricing require it up front rather than at the last step.
   * In Haiti the fee comes out of the organizer's proceeds, so `buyerFee` is 0 and
   * this equals the face total exactly as before.
   *
   * A pre-payment estimate: the server recomputes it from the tier's stored price
   * and the PaymentIntent's own breakdown is what the payment sheet finally shows.
   */
  const orderPricing = useMemo(
    () =>
      priceOrder(totalAmountDisplay, country, {
        // Tickets in the cart. The fee is a flat rate of the total, so this no
        // longer changes it; passed for the pricing seam's order context.
        quantity: selectedTiers.length
          ? selectedTiers.reduce((sum, t) => sum + t.quantity, 0)
          : quantity,
        currency,
      }),
    [totalAmountDisplay, country, currency, quantity, selectedTiers]
  )
  const showFeeLine = orderPricing.feeOnTop && orderPricing.buyerFee > 0
  const formatAmount = (amount: number) => `${amount.toLocaleString()} ${currency}`
  /**
   * True once the buyer has actually chosen what they are buying. Before that
   * `ticketPrice` is only the event's "from" headline, so no total may be quoted
   * from it — a guest is asked for their details before tiers are shown.
   */
  const hasConcreteSelection = selectedTiers.length > 0 || selectedTierPrice > 0

  useEffect(() => {
    if (!showModal) return
    if (!isHaitiEvent) {
      setUsdHtgQuote(null)
      setUsdHtgQuoteError(null)
      setUsdHtgQuoteLoading(false)
      return
    }
    if (String(currency || 'HTG').toUpperCase() !== 'USD') {
      setUsdHtgQuote(null)
      setUsdHtgQuoteError(null)
      setUsdHtgQuoteLoading(false)
      return
    }

    // Only Haiti events can settle USD-priced tickets in HTG via local mobile money.
    // If the user is paying by card, we charge in the event currency.
    if (paymentMethod === 'stripe') {
      setUsdHtgQuote(null)
      setUsdHtgQuoteError(null)
      setUsdHtgQuoteLoading(false)
      return
    }

    const amountUsd = Number(totalAmountDisplay)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return

    const controller = new AbortController()
    const run = async () => {
      setUsdHtgQuoteLoading(true)
      setUsdHtgQuoteError(null)
      try {
        const url = `/api/fx/usd-htg-quote?amount=${encodeURIComponent(String(amountUsd))}`
        const res = await fetch(url, { signal: controller.signal })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to fetch exchange rate')
        }
        setUsdHtgQuote(data)
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        setUsdHtgQuote(null)
        setUsdHtgQuoteError(err?.message || 'Failed to fetch exchange rate')
      } finally {
        setUsdHtgQuoteLoading(false)
      }
    }

    run()
    return () => controller.abort()
  }, [currency, isHaitiEvent, paymentMethod, showModal, totalAmountDisplay])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data: any = event.data
      if (!data || data.source !== 'tikem' || data.type !== 'purchase_result') return

      // Payment completed in the popup; remove blurred backdrop.
      setIsMonCashPopupOpen(false)
      moncashPopupRef.current = null

      if (data.status === 'success') {
        const ticketId = data.ticketId || data.ticket_id
        if (ticketId) {
          router.push(`/purchase/success?ticketId=${encodeURIComponent(String(ticketId))}`)
        } else {
          router.push('/purchase/success')
        }
      } else if (data.status === 'failed') {
        const reason = data.reason ? encodeURIComponent(String(data.reason)) : 'unknown'
        router.push(`/purchase/failed?reason=${reason}`)
      }

      router.refresh()
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [router])

  // If the user closes the MonCash popup manually, remove blurred backdrop.
  useEffect(() => {
    if (!isMonCashPopupOpen) return
    const id = window.setInterval(() => {
      const popup = moncashPopupRef.current
      if (popup && popup.closed) {
        moncashPopupRef.current = null
        setIsMonCashPopupOpen(false)
      }
    }, 500)

    return () => window.clearInterval(id)
  }, [isMonCashPopupOpen])

  /**
   * Issue free tickets without touching a payment gateway.
   *
   * Called three ways:
   *  - no argument: the whole event is free (no tier selection was shown), so the
   *    server resolves the event's free tier itself. This is the original payload
   *    shape and is left byte-identical.
   *  - with `selections`: the buyer picked specific FREE tiers out of an event that
   *    also sells paid ones. Every tier and quantity is sent so the server can
   *    validate and reserve each one.
   *  - with `selections` AND `promoCodeId`: paid tiers the buyer's promo code takes
   *    to 0. The code is forwarded so the SERVER can re-resolve it, recompute the
   *    discount and decide for itself whether the order is really free. If it
   *    disagrees the buyer is handed back to checkout rather than left stuck.
   */
  async function handleClaimFreeTicket(
    selections?: { tierId: string; quantity: number; tierName?: string }[],
    promoCodeId?: string,
    /**
     * The guest's details, passed explicitly when this is called straight out of the
     * guest form — `setGuestContact` has not committed yet at that point, so reading
     * state here would send an RSVP with no contact and no way to deliver the ticket.
     */
    contactOverride?: GuestContactInput
  ) {
    setLoading(true)
    setError(null)
    const contact = contactOverride || guestContact

    const claimedQuantity = selections?.length
      ? selections.reduce((sum, s) => sum + s.quantity, 0)
      : quantity

    try {
      if (isDemoMode()) {
        await new Promise(resolve => setTimeout(resolve, 800))
        showToast({
          type: 'success',
          title: t('checkout.free_ticket_claimed_title', { defaultValue: 'Free ticket claimed!' }),
          message:
            claimedQuantity === 1
              ? t('checkout.tickets_added_collection', {
                  count: claimedQuantity,
                  defaultValue: '{{count}} ticket added to your collection',
                })
              : t('checkout.tickets_added_collection_plural', {
                  count: claimedQuantity,
                  defaultValue: '{{count}} tickets added to your collection',
                }),
          duration: 4000
        })
        router.push('/tickets')
        return
      }

      console.log('Claiming free tickets for event:', eventId, 'Quantity:', claimedQuantity)

      const response = await fetch('/api/tickets/claim-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          selections?.length
            ? {
                eventId,
                selections: selections.map(s => ({ tierId: s.tierId, quantity: s.quantity })),
                ...(promoCodeId ? { promoCode: promoCodeId } : {}),
                ...(refCode ? { refCode } : {}),
                ...(attribution ? { attribution } : {}),
                ...(contact ? { guest: contact } : {}),
                ...accessBody,
              }
            : {
                eventId,
                quantity,
                ...(refCode ? { refCode } : {}),
                ...(attribution ? { attribution } : {}),
                ...(contact ? { guest: contact } : {}),
                ...accessBody,
              }
        ),
      })

      const data = await response.json()

      console.log('Claim response:', data)

      if (!response.ok) {
        // A promo refusal is recoverable: the order still has a real price, so put
        // the buyer on the checkout path instead of leaving them with a dead end.
        if (promoCodeId && PROMO_FAILURE_CODES.has(String(data?.code || ''))) {
          setLoading(false)
          setError(null)
          showToast({
            type: 'info',
            title: t('events.promo_free_claim_failed_title', {
              defaultValue: 'This promo code needs checkout',
            }),
            message: localizedClaimError(String(data?.code || '')),
            duration: 6000,
          })
          // The paid-branch state (tiers, promo, quantity) was already staged by
          // handleTieredPurchase, so opening the sheet resumes a normal purchase.
          setShowModal(true)
          return
        }
        const claimError = new Error(localizedClaimError(String(data?.code || ''))) as Error & {
          code?: string
        }
        claimError.code = data?.code
        throw claimError
      }

      // Show success toast and redirect
      showToast({
        type: 'success',
        title: t('checkout.tickets_claimed_title', { defaultValue: 'Tickets claimed successfully!' }),
        message: data.guestTicketUrl
          ? (data.count === 1
              ? t('checkout.tickets_claimed_email', {
                  count: data.count,
                  defaultValue: '{{count}} free ticket. Check your email',
                })
              : t('checkout.tickets_claimed_email_plural', {
                  count: data.count,
                  defaultValue: '{{count}} free tickets. Check your email',
                }))
          : (data.count === 1
              ? t('checkout.tickets_added_collection', {
                  count: data.count,
                  defaultValue: '{{count}} ticket added to your collection',
                })
              : t('checkout.tickets_added_collection_plural', {
                  count: data.count,
                  defaultValue: '{{count}} tickets added to your collection',
                })),
        duration: 4000
      })

      // A guest has no /tickets page; the server hands back their own signed link.
      if (data.guestTicketUrl) {
        window.location.href = data.guestTicketUrl
        return
      }

      router.push('/tickets')
      router.refresh()
    } catch (err: any) {
      console.error('Claim error:', err)
      // `err.message` is already localized when it came from a coded server
      // refusal above; anything else (network/parse failure) gets the generic
      // localized line rather than a raw English exception string.
      const message = err?.code ? err.message : localizedClaimError('')
      setError(message)
      showToast({
        type: 'error',
        title: t('events.claim_failed_title', { defaultValue: 'Could not claim your ticket' }),
        message,
        duration: 4000
      })
      setLoading(false)
    }
  }

  // Clear the per-button pending state whenever the shared loading flag settles.
  useEffect(() => {
    if (!loading) setPendingMethod(null)
  }, [loading])

  async function handlePurchase(method: 'stripe' | 'moncash' | 'natcash' | 'sogepay') {
    setLoading(true)
    setPendingMethod(method)
    setError(null)

    try {
      // In demo mode, just show success message
      if (isDemoMode()) {
        await new Promise(resolve => setTimeout(resolve, 800))
        setShowModal(false)
        setShowTieredModal(false)
        showToast({
          type: 'success',
          title: t('checkout.tickets_purchased_title', { defaultValue: 'Tickets purchased!' }),
          message:
            quantity === 1
              ? t('checkout.tickets_purchased_message', {
                  count: quantity,
                  defaultValue: '{{count}} ticket successfully purchased',
                })
              : t('checkout.tickets_purchased_message_plural', {
                  count: quantity,
                  defaultValue: '{{count}} tickets successfully purchased',
                }),
          duration: 4000
        })
        router.refresh()
        setLoading(false)
        return
      }

      if (method === 'stripe') {
        if (isHaitiEvent) {
          throw new Error(
            t('checkout.card_haiti_uses_sogepay', {
              defaultValue: 'Card payments for Haiti events use Sogepay.',
            })
          )
        }
        // Use embedded payment instead of redirect
        setShowModal(false)
        setShowEmbeddedPayment(true)
        setLoading(false)
      } else if (method === 'sogepay') {
        if (!isHaitiEvent) {
          throw new Error(
            t('checkout.sogepay_haiti_only', { defaultValue: 'Sogepay is only available for Haiti events.' })
          )
        }

        setShowModal(false)

        const tiers = selectedTiers.length
          ? selectedTiers.map(t => ({ tierId: t.tierId, quantity: t.quantity }))
          : undefined

        const response = await fetch('/api/sogepay/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId,
            quantity,
            tierId: selectedTierId,
            promoCode,
            ...(refCode ? { refCode } : {}),
            ...(attribution ? { attribution } : {}),
            tiers,
            ...guestBody,
            ...accessBody,
          }),
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(
            data.error ||
              t('checkout.sogepay_initiate_failed', { defaultValue: 'Failed to initiate Sogepay payment' })
          )
        }

        if (!data.redirectUrl) {
          throw new Error(
            t('checkout.sogepay_missing_redirect', { defaultValue: 'Missing Sogepay redirect URL' })
          )
        }

        // IN-APP BROWSER: navigate in THIS tab, never a popup.
        //
        // Inside Instagram's or Facebook's WebView a popup does not "fail" in a way we
        // can detect — it opens a chromeless view with no address bar and often no way
        // back, stranding a buyer whose order has already been created. A full-page
        // navigation keeps the gateway in the view they are already in, and its return
        // URL brings them back to us. Popups stay the default in a real browser, where
        // keeping the event page alive behind the payment is genuinely nicer.
        if (paymentNavigationMode() === 'same-tab') {
          window.location.href = data.redirectUrl
          return
        }

        const popupWidth = 480
        const popupHeight = 720
        const dualScreenLeft = (window as any).screenLeft ?? window.screenX ?? 0
        const dualScreenTop = (window as any).screenTop ?? window.screenY ?? 0
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height
        const left = Math.max(0, Math.floor(dualScreenLeft + (viewportWidth - popupWidth) / 2))
        const top = Math.max(0, Math.floor(dualScreenTop + (viewportHeight - popupHeight) / 2))

        const popup = window.open(
          data.redirectUrl,
          'sogepay_checkout',
          `popup=yes,width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
        )

        if (!popup) {
          setIsMonCashPopupOpen(false)
          moncashPopupRef.current = null
          window.location.href = data.redirectUrl
          return
        }

        popup.focus()
        moncashPopupRef.current = popup
        setIsMonCashPopupOpen(true)

        showToast({
          type: 'info',
          title: t('checkout.complete_payment_popup_title', { defaultValue: 'Complete payment in the popup' }),
          message: t('checkout.complete_payment_popup_message', {
            defaultValue: 'Keep this tab open. We’ll bring you back when payment completes.',
          }),
          duration: 6000,
        })

        setLoading(false)
      } else {
        // MonCash Button checkout (hosted redirect)
        if (!isHaitiEvent) {
          throw new Error(
            t('checkout.moncash_haiti_only', { defaultValue: 'MonCash is only available for Haiti events.' })
          )
        }
        setShowModal(false)

        const tiers = selectedTiers.length
          ? selectedTiers.map(t => ({ tierId: t.tierId, quantity: t.quantity }))
          : undefined

        const response = await fetch('/api/moncash-button/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId,
            quantity,
            tierId: selectedTierId,
            promoCode,
            ...(refCode ? { refCode } : {}),
            ...(attribution ? { attribution } : {}),
            tiers,
            mobileMoneyProvider: method,
            ...guestBody,
            ...accessBody,
          }),
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(
            data.error ||
              t('checkout.moncash_initiate_failed', {
                defaultValue: 'Failed to initiate MonCash Button payment',
              })
          )
        }

        if (!data.redirectUrl) {
          throw new Error(
            t('checkout.moncash_missing_redirect', { defaultValue: 'Missing MonCash redirect URL' })
          )
        }

        // IN-APP BROWSER: navigate in THIS tab, never a popup.
        //
        // Inside Instagram's or Facebook's WebView a popup does not "fail" in a way we
        // can detect — it opens a chromeless view with no address bar and often no way
        // back, stranding a buyer whose order has already been created. A full-page
        // navigation keeps the gateway in the view they are already in, and its return
        // URL brings them back to us. Popups stay the default in a real browser, where
        // keeping the event page alive behind the payment is genuinely nicer.
        if (paymentNavigationMode() === 'same-tab') {
          window.location.href = data.redirectUrl
          return
        }

        const popupWidth = 480
        const popupHeight = 720
        const dualScreenLeft = (window as any).screenLeft ?? window.screenX ?? 0
        const dualScreenTop = (window as any).screenTop ?? window.screenY ?? 0
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height
        const left = Math.max(0, Math.floor(dualScreenLeft + (viewportWidth - popupWidth) / 2))
        const top = Math.max(0, Math.floor(dualScreenTop + (viewportHeight - popupHeight) / 2))

        const popup = window.open(
          data.redirectUrl,
          'moncash_checkout',
          `popup=yes,width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
        )

        if (!popup) {
          // Popup blocked: fallback to same-tab redirect.
          setIsMonCashPopupOpen(false)
          moncashPopupRef.current = null
          window.location.href = data.redirectUrl
          return
        }

        popup.focus()

        // Blur the opener background while the popup is open.
        moncashPopupRef.current = popup
        setIsMonCashPopupOpen(true)

        showToast({
          type: 'info',
          title: t('checkout.complete_payment_popup_title', { defaultValue: 'Complete payment in the popup' }),
          message: t('checkout.complete_payment_popup_message', {
            defaultValue: 'Keep this tab open. We’ll bring you back when payment completes.',
          }),
          duration: 6000,
        })

        setLoading(false)
      }
    } catch (err: any) {
      const message =
        err.message || t('checkout.purchase_generic_failed', { defaultValue: 'Failed to purchase ticket' })
      setError(message)
      showToast({
        type: 'error',
        title: t('checkout.purchase_failed_title', { defaultValue: 'Purchase failed' }),
        message:
          err.message || t('checkout.purchase_failed_generic', { defaultValue: 'Please try again later' }),
        duration: 4000
      })
      setLoading(false)
    }
  }

  const handleTieredPurchase = (
    selections: { tierId: string; quantity: number; price: number; tierName?: string }[],
    promoCodeId?: string,
    discountedTotal?: number
  ) => {
    if (!selections || selections.length === 0) return

    const totalQuantity = selections.reduce((sum, s) => sum + s.quantity, 0)
    const totalPrice = computeSelectionTotal(selections)

    // Every selected tier costs 0 on its OWN price → issue the tickets directly.
    // Sending this to a payment initiator would produce a 0-amount gateway call:
    // Stripe rejects a 0 PaymentIntent, and MonCash would write a pending
    // transaction of 0 and redirect the buyer to pay nothing.
    if (allSelectionsFree(selections)) {
      setShowTieredModal(false)
      setSelectedTiers(selections)
      setSelectedTierId(selections[0].tierId)
      setQuantity(totalQuantity)
      handleClaimFreeTicket(selections)
      return
    }

    // Store all selections for multi-tier support
    setSelectedTiers(selections)

    // Persist promo code (id) so payment APIs can apply the discount.
    setPromoCode(promoCodeId)

    // For backward compatibility, also set the first tier
    const firstSelection = selections[0]
    setSelectedTierId(firstSelection.tierId)
    setSelectedTierPrice(totalPrice / totalQuantity) // Average price (for display compatibility)
    setQuantity(totalQuantity)

    setShowTieredModal(false)

    // PAID tiers a promo code takes to zero. This total is the CLIENT's arithmetic
    // and is treated as nothing more than a routing hint: it only decides which
    // endpoint to try first. /api/tickets/claim-free re-resolves the promo against
    // the event's own records, recomputes the discount from the Firestore tier
    // prices, and issues only if ITS total is 0 — otherwise it refuses and the
    // handler above reopens this checkout sheet (whose state is already staged
    // just above, so nothing is lost).
    //
    // Routing on the discounted total rather than sending it to a gateway is the
    // whole point: `create-payment-intent` would compute amountCents = 0 (Stripe
    // rejects it) and `moncash-button/initiate` would write a 0-amount pending
    // transaction and redirect.
    if (promoCodeId && typeof discountedTotal === 'number' && discountedTotal <= 0 && totalPrice > 0) {
      handleClaimFreeTicket(selections, promoCodeId)
      return
    }

    setShowModal(true)
  }

  return (
    <>
      {isMonCashPopupOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}

      {showGuestForm && (
        <BottomSheet
          isOpen={showGuestForm}
          onClose={() => {
            if (loading) return
            setShowGuestForm(false)
            pendingGuestActionRef.current = null
          }}
          title={t('checkout.guest_title', { defaultValue: 'Where should we send your ticket?' })}
        >
          <GuestCheckoutForm
            requirePhone={isHaitiEvent}
            busy={loading}
            initial={guestContact || undefined}
            // Only quote a total once the buyer has actually chosen tickets. Before
            // that the headline price is a "from" figure, and inventing a total from
            // it would be the very thing this must not do; the fee notice covers it.
            orderSummary={
              !isFree && hasConcreteSelection && totalAmountDisplay > 0
                ? {
                    subtotal: orderPricing.faceValue,
                    fee: orderPricing.buyerFee,
                    total: orderPricing.total,
                    currency,
                  }
                : null
            }
            feesAddedOnTop={!isFree && orderPricing.feeOnTop}
            submitLabel={
              pendingGuestActionRef.current === 'free'
                ? t('events.claim', { defaultValue: 'Get my ticket' })
                : t('events.continue_to_payment', { defaultValue: 'Continue to payment' })
            }
            onSubmit={handleGuestSubmit}
            onCancel={() => {
              if (loading) return
              setShowGuestForm(false)
              pendingGuestActionRef.current = null
            }}
          />
        </BottomSheet>
      )}

      {showCodePrompt && (
        <BottomSheet
          isOpen={showCodePrompt}
          onClose={() => {
            if (verifyingCode) return
            setShowCodePrompt(false)
            pendingActionRef.current = null
          }}
          title={t('events.enter_access_code', { defaultValue: 'Enter access code' })}
        >
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-white/70">
              <span aria-hidden="true">🔒</span>
              <span>
                {t('events.password_protected_hint', {
                  defaultValue: 'This event is password protected. Enter the code to continue.',
                })}
              </span>
            </div>

            <input
              type="password"
              autoFocus
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder={t('events.access_code_placeholder', { defaultValue: 'Access code' })}
              disabled={verifyingCode}
              className="w-full rounded-lg bg-white/[0.03] border border-white/10 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-brand-500 disabled:opacity-50"
            />

            {codeError && (
              <div className="bg-error-500/10 text-red-300 px-4 py-3 rounded-lg text-sm">
                {codeError}
              </div>
            )}

            <button
              type="submit"
              disabled={verifyingCode || !codeInput.trim()}
              className="block w-full bg-white hover:bg-white/90 text-black text-center text-[15px] font-medium py-3 px-5 rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {verifyingCode
                ? t('events.processing')
                : t('events.unlock', { defaultValue: 'Unlock' })}
            </button>

            <button
              type="button"
              onClick={() => {
                if (verifyingCode) return
                setShowCodePrompt(false)
                pendingActionRef.current = null
              }}
              disabled={verifyingCode}
              className="w-full px-4 py-3 border border-white/10 rounded-lg font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </form>
        </BottomSheet>
      )}
      {isFree ? (
        <div className="space-y-4">
          {/* Quantity Selector for Free Tickets */}
          <div className="flex items-center justify-between bg-white/[0.03] border border-white/10 rounded-lg p-4">
            <span className="text-sm font-medium text-white/70">{t('events.quantity')}</span>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1 || loading}
                aria-label={t('events.decrease_quantity', { defaultValue: 'Decrease quantity' })}
                className="w-8 h-8 rounded-full bg-white/[0.03] border border-white/10 flex items-center justify-center hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 text-white/65" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <span className="w-12 text-center font-semibold text-white">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(10, quantity + 1))}
                disabled={quantity >= 10 || loading}
                aria-label={t('events.increase_quantity', { defaultValue: 'Increase quantity' })}
                className="w-8 h-8 rounded-full bg-white/[0.03] border border-white/10 flex items-center justify-center hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 text-white/65" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {isPasswordProtected && hasAccess !== true && (
            <div className="flex items-center gap-2 text-sm text-white/70">
              <span aria-hidden="true">🔒</span>
              <span>{t('events.password_required', { defaultValue: 'Password required' })}</span>
            </div>
          )}

          <button
            onClick={() => gateOrRun('free')}
            disabled={loading}
            className="block w-full bg-white hover:bg-white/90 text-black text-center text-[15px] font-medium py-2.5 px-5 rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {loading ? t('events.processing') : `${t('events.claim')} ${quantity} ${t('events.free_ticket')}${quantity !== 1 ? 's' : ''}`}
          </button>
        </div>
      ) : (
        <>
          {isPasswordProtected && hasAccess !== true && (
            <div className="mb-3 flex items-center gap-2 text-sm text-white/70">
              <span aria-hidden="true">🔒</span>
              <span>{t('events.password_required', { defaultValue: 'Password required' })}</span>
            </div>
          )}

          <button
            onClick={() => gateOrRun('paid')}
            disabled={loading || tierProbeLoading}
            className="block w-full bg-white hover:bg-white/90 text-black text-center text-[15px] font-medium py-2.5 px-5 rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {loading || tierProbeLoading ? t('events.processing') : t('events.buy_ticket')}
          </button>

          {/* Tiered Ticket Selection Modal */}
          {showTieredModal && (
            <BottomSheet 
              isOpen={showTieredModal} 
              onClose={() => setShowTieredModal(false)}
              title={t('events.select_tickets')}
            >
              <EventbriteStyleTicketSelector
                eventId={eventId}
                userId={userId}
                currency={currency}
                country={country}
                eventStartsAt={eventStartsAt}
                allowGuest={isGuestCheckout}
                onPurchase={handleTieredPurchase}
              />
            </BottomSheet>
          )}
        </>
      )}

      {error && !showModal && (
        <div className="mt-3 bg-error-500/10 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {showModal && !isFree && (
        <BottomSheet 
          isOpen={showModal} 
          onClose={() => setShowModal(false)}
          title={t('events.choose_payment_method')}
        >
          <div className="space-y-4">
            <p className="text-white/70">
              {quantity === 1 ? t('events.select_payment_description', { count: quantity }) : t('events.select_payment_description_plural', { count: quantity })}
            </p>

            {/* Quantity Selector - Only show for single tier purchases */}
            {selectedTiers.length === 0 && (
              <div className="flex items-center justify-between bg-white/[0.03] border border-white/10 rounded-lg p-4">
                <span className="text-sm font-medium text-white/70">{t('events.quantity')}</span>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1 || loading}
                    aria-label={t('events.decrease_quantity', { defaultValue: 'Decrease quantity' })}
                    className="w-8 h-8 rounded-full bg-white/[0.03] border border-white/10 flex items-center justify-center hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4 text-white/65" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <span className="w-12 text-center font-semibold text-white">{quantity}</span>
                  <button
                    onClick={() => setQuantity(Math.min(10, quantity + 1))}
                    disabled={quantity >= 10 || loading}
                    aria-label={t('events.increase_quantity', { defaultValue: 'Increase quantity' })}
                    className="w-8 h-8 rounded-full bg-white/[0.03] border border-white/10 flex items-center justify-center hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4 text-white/65" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-white/[0.03] border border-white/10 p-4">
              {selectedTiers.length > 0 ? (
                // Show itemized breakdown for multi-tier purchases
                <div className="space-y-2">
                  {selectedTiers.map((tier, index) => (
                    <div key={index} className="flex justify-between items-center text-sm">
                      <span className="text-white/65">
                        {tier.quantity}x {tier.tierName || t('ticket.ticket')}
                      </span>
                      <span className="font-medium text-white">
                        {(tier.price * tier.quantity).toLocaleString()} {currency}
                      </span>
                    </div>
                  ))}
                  {showFeeLine && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-white/65">
                        {t('checkout.service_fee', { defaultValue: 'Service fee' })}
                      </span>
                      <span className="font-medium text-white">{formatAmount(orderPricing.buyerFee)}</span>
                    </div>
                  )}
                  <div className="border-t border-white/10 pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-white/65">{t('events.total_amount')}:</span>
                      <span className="text-xl font-bold text-brand-300">
                        {formatAmount(orderPricing.total)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                // Single tier or legacy display
                <div className="space-y-2">
                  {showFeeLine && (
                    <>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-white/65">
                          {t('events.subtotal', { defaultValue: 'Subtotal' })}
                        </span>
                        <span className="font-medium text-white">{formatAmount(orderPricing.faceValue)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-white/65">
                          {t('checkout.service_fee', { defaultValue: 'Service fee' })}
                        </span>
                        <span className="font-medium text-white">{formatAmount(orderPricing.buyerFee)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white/65">{t('events.total_amount')}:</span>
                    <span className="text-xl font-bold text-brand-300">
                      {formatAmount(orderPricing.total)}
                    </span>
                  </div>
                </div>
              )}

              {showFeeLine && (
                <p className="mt-2 text-xs text-white/45">
                  {t('checkout.total_includes_fees', {
                    defaultValue: 'Total includes all fees. This is what you pay.',
                  })}{' '}
                  {t('checkout.service_fee_nonrefundable', {
                    defaultValue: 'Service fee is non-refundable unless the event is cancelled.',
                  })}
                </p>
              )}

              {isHaitiEvent && String(currency || 'HTG').toUpperCase() === 'USD' && (
                <div className="mt-3 text-sm text-white/65">
                  {usdHtgQuoteLoading && (
                    <span>
                      {t('checkout.estimating_moncash_total', {
                        defaultValue: 'Estimating MonCash total in HTG…',
                      })}
                    </span>
                  )}
                  {!usdHtgQuoteLoading && usdHtgQuote && (
                    <div className="space-y-1">
                      <div>
                        {t('checkout.estimated_moncash_charge', { defaultValue: 'Estimated MonCash charge:' })}{' '}
                        <span className="font-semibold text-white">{usdHtgQuote.amountHtg.toLocaleString()} HTG</span>
                      </div>
                      <div className="text-xs text-white/70">
                        {t('checkout.moncash_rate_detail', {
                          rate: usdHtgQuote.baseRate.toFixed(2),
                          spread: (usdHtgQuote.spreadPercent * 100).toFixed(0),
                          defaultValue: 'Rate: {{rate}} HTG/USD + {{spread}}% spread',
                        })}
                      </div>
                    </div>
                  )}
                  {!usdHtgQuoteLoading && usdHtgQuoteError && (
                    <span className="text-red-300">
                      {t('checkout.moncash_estimate_unavailable', {
                        defaultValue: 'Unable to estimate HTG total right now.',
                      })}
                    </span>
                  )}
                </div>
              )}

              {promoCode && (
                <div className="mt-2 text-sm text-green-400">
                  ✓ {t('events.promo_code_applied')}
                </div>
              )}
            </div>

            {error && (
              <div className="bg-error-500/10 text-red-300 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {/* Card Option (Stripe for US/CA and others; Sogepay for Haiti).
                  Sogepay isn't live yet, so the card option is hidden for Haiti events for now. */}
              {(!isHaitiEvent || SOGEPAY_ENABLED) && (
              <button
                onClick={() => handlePurchase(isHaitiEvent ? 'sogepay' : 'stripe')}
                disabled={loading}
                className="w-full flex items-center justify-between px-4 py-4 border-2 border-white/10 rounded-lg hover:border-brand-500 hover:bg-white/10 transition disabled:opacity-50"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-white">{t('events.credit_debit_card')}</div>
                    <div className="text-sm text-white/70">{isHaitiEvent ? 'Sogepay' : t('events.visa_mastercard_amex')}</div>
                  </div>
                </div>
                {pendingMethod === (isHaitiEvent ? 'sogepay' : 'stripe') ? (
                  <svg className="w-5 h-5 text-white/70 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
              )}

              {/* MonCash Option (Haiti only) */}
              {isHaitiEvent && (
                <>
                  <button
                    onClick={() => handlePurchase('moncash')}
                    disabled={loading}
                    className="w-full flex items-center justify-between px-4 py-4 border-2 border-white/10 rounded-lg hover:border-brand-500 hover:bg-white/10 transition disabled:opacity-50"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
                        </svg>
                      </div>
                      <div className="text-left">
                        <div className="font-semibold text-white">MonCash</div>
                        <div className="text-sm text-white/70">{t('events.mobile_money_haiti')}</div>
                      </div>
                    </div>
                    {pendingMethod === 'moncash' ? (
                      <svg className="w-5 h-5 text-white/70 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>

                  {NATCASH_ENABLED && (
                  <button
                    onClick={() => handlePurchase('natcash')}
                    disabled={loading}
                    className="w-full flex items-center justify-between px-4 py-4 border-2 border-white/10 rounded-lg hover:border-brand-500 hover:bg-white/10 transition disabled:opacity-50"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h10V6H7zm2 10h6v2H9v-2zm0-4h6v2H9v-2z" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <div className="font-semibold text-white">NatCash</div>
                        <div className="text-sm text-white/70">{t('events.mobile_money_haiti')}</div>
                      </div>
                    </div>
                    {pendingMethod === 'natcash' ? (
                      <svg className="w-5 h-5 text-white/70 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                  )}
                </>
              )}
            </div>

            <button
              onClick={() => setShowModal(false)}
              disabled={loading}
              className="w-full px-4 py-3 border border-white/10 rounded-lg font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? t('events.processing') : t('common.cancel')}
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Embedded Stripe Payment */}
      {showEmbeddedPayment && (
        <EmbeddedStripePayment
          eventId={eventId}
          eventTitle={eventTitle}
          userId={userId}
          guest={guestContact}
          quantity={quantity}
          // The FACE total. The payment sheet adds the fee for a buyer-pays market and
          // then replaces both with the PaymentIntent's own server-computed breakdown.
          totalAmount={totalAmountDisplay}
          currency={currency}
          country={country}
          tierId={selectedTierId || undefined}
          promoCodeId={promoCode}
          refCode={refCode}
          attribution={attribution}
          accessCode={accessCodeRef.current}
          onClose={() => {
            setShowEmbeddedPayment(false)
            // Reset state
            setQuantity(1)
            setSelectedTierId(null)
            setSelectedTierPrice(0)
            setSelectedTiers([])
            setPromoCode(undefined)
          }}
        />
      )}
    </>
  )
}
