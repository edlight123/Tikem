import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
      Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'

import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { backendFetch, backendJson } from '../../lib/api/backend'
import { getEventById } from '../../lib/api/organizer'
import { getVerificationRequest } from '../../lib/verification'
import { getRequiredPayoutProfileIdForEventCountry, normalizeCountryCode } from '../../lib/payment-provider'
import { RADIUS } from '../../config/brand'
import { colors as tokenColors, radius } from '../../theme/tokens'
import { formatCurrency as fmtCurrency } from '../../lib/currency'
import {
  MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
  computeInstantMoncashQuote,
  moncashMinimumMinor,
  parsePrefundingStatus,
} from '../../lib/moncashPayout'
import StatTriplet from '../../components/StatTriplet'
import WhitePillCTA from '../../components/WhitePillCTA'
import SecondaryPill from '../../components/auth/SecondaryPill'
import InfoNotice from '../../components/organizer/InfoNotice'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import { EarningsSkeleton } from '../../components/Skeleton'
import { useAppAlert } from '../../components/AppAlert'

type RouteParams = {
  OrganizerEventEarnings: {
    eventId: string
  }
}

type BankDestination = {
  id: string
  bankName: string
  accountName: string
  accountNumberLast4: string
  isPrimary: boolean
}

/**
 * The release ladder's verdict for this event, from the server. Settlement
 * status answers "has the hold period elapsed"; this answers "would a withdrawal
 * actually be accepted right now", which is the stricter and more useful
 * question. Absent when the server could not compute it — treat as unknown.
 */
type ReleasePreview = {
  releasedNow: boolean
  releasableMinor: number
  availableAt: string | null
  holdHours: number
  reason: string
  tier: 'new' | 'established' | 'pre_event' | string
  reviewStatus: string | null
}

type EventEarnings = {
  availableToWithdraw: number
  currency?: 'HTG' | 'USD' | 'CAD' | 'EUR'
  settlementStatus?: 'pending' | 'ready' | 'locked' | string
  settlementReadyDate?: string | null
  release?: ReleasePreview | null
  lastCalculatedAt?: string | null
  dataSource?: string
  grossSales?: number
  netAmount?: number
  ticketsSold?: number
  totalEarned?: number
  withdrawnAmount?: number
  /** Set when the server holds this balance for admin review — nothing is withdrawable. */
  withdrawalBlocked?: { code: string; storedCurrency?: string; eventCurrency?: string } | null
  /** The MonCash 1,000 HTG floor in this event's currency, computed server-side. */
  moncashMinimum?: { minimumHtgCents: number; minimumMinor: number | null; currency: string; usdToHtgRate: number | null } | null
}

/** Haiti bank-transfer floor enforced by /api/organizer/withdraw-bank (unchanged). */
const BANK_MIN_WITHDRAWAL_CENTS = 5000

export default function OrganizerEventEarningsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerEventEarnings'>>()
  const navigation = useNavigation<any>()
  const { eventId } = route.params

  const { user } = useAuth()
  const { t, language } = useI18n()
  const insets = useSafeAreaInsets()
  const showAlert = useAppAlert()
  const dateLocale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US'

  const [loading, setLoading] = useState(true)
  const [eventTitle, setEventTitle] = useState<string>('')
  const [eventCountry, setEventCountry] = useState<string>('')
  const [earnings, setEarnings] = useState<EventEarnings | null>(null)

  const [isStripeConnectAccount, setIsStripeConnectAccount] = useState(false)
  const [accountLocation, setAccountLocation] = useState<string>('')

  // Identity verification (KYC) is required before earnings can be withdrawn.
  // null = still checking, true = approved, false = not verified.
  const [identityVerified, setIdentityVerified] = useState<boolean | null>(null)
  // Whether the organizer has ANY payout method configured (Haiti profile).
  // null = unknown/loading. When false, guide them to set one up before they
  // can hit the "Haiti payout profile required" wall on withdraw.
  const [hasPayoutMethod, setHasPayoutMethod] = useState<boolean | null>(null)

  const requiresStripeConnect = useMemo(() => {
    const normalized = normalizeCountryCode(eventCountry)
    if (normalized) {
      return getRequiredPayoutProfileIdForEventCountry(normalized) === 'stripe_connect'
    }
    // Fallback for legacy events missing a country: infer from organizer payout config.
    return isStripeConnectAccount
  }, [eventCountry, isStripeConnectAccount])

  const [showWithdraw, setShowWithdraw] = useState(false)
  const [method, setMethod] = useState<'moncash' | 'bank' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // MonCash
  const [moncashNumber, setMoncashNumber] = useState('')
  const [prefunding, setPrefunding] = useState<{ enabled: boolean; available: boolean } | null>(null)
  const [allowInstantMoncash, setAllowInstantMoncash] = useState(false)
  // USD events are converted to HTG at withdrawal; the server's quote endpoint
  // hands us the rate it will use so the preview can show the HTG that lands.
  const [usdToHtgRate, setUsdToHtgRate] = useState<number | null>(null)

  // Bank
  const [bankDestinations, setBankDestinations] = useState<BankDestination[] | null>(null)
  const [bankMode, setBankMode] = useState<'on_file' | 'saved' | 'new'>('new')
  const [selectedBankDestinationId, setSelectedBankDestinationId] = useState('')
  const [saveNewBankDestination, setSaveNewBankDestination] = useState(true)
  const [bankDetails, setBankDetails] = useState({
    accountHolder: '',
    bankName: '',
    accountNumber: '',
    routingNumber: '',
    swiftCode: '',
  })

  // OTP step-up
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [pendingEndpoint, setPendingEndpoint] = useState<string | null>(null)
  const [pendingPayload, setPendingPayload] = useState<any | null>(null)

  const currency = (earnings?.currency || 'HTG') as 'HTG' | 'USD' | 'CAD' | 'EUR'
  const availableToWithdraw = useMemo(() => {
    if (!earnings) return 0
    if (earnings.withdrawalBlocked) return 0
    if (earnings?.settlementStatus !== 'ready') return 0
    /**
     * The release ladder has the final say, and it is stricter than settlement:
     * an event still inside its post-event hold, one with no end date, or one the
     * payouts team is reviewing has nothing withdrawable no matter what
     * settlement says. Showing a figure here that the withdraw button then
     * refuses is the surprise this guards against.
     *
     * `release` absent means the server could not compute it — treat that as
     * unknown and fall back to the old behaviour rather than blocking a payout.
     */
    if (earnings.release && earnings.release.releasedNow === false) return 0
    if (earnings.release && typeof earnings.release.releasableMinor === 'number') {
      return Math.max(0, earnings.release.releasableMinor)
    }

    const net = typeof earnings.netAmount === 'number' && Number.isFinite(earnings.netAmount) ? earnings.netAmount : null
    const withdrawn = typeof earnings.withdrawnAmount === 'number' && Number.isFinite(earnings.withdrawnAmount) ? earnings.withdrawnAmount : 0

    if (net != null) {
      return Math.max(0, net - withdrawn)
    }

    // Backwards-compatible fallback if API doesn't provide netAmount.
    return Math.max(0, Number(earnings.availableToWithdraw || 0))
  }, [earnings])

  const instantPreview = useMemo(() => {
    if (!prefunding?.enabled || !prefunding?.available) return null
    if (!allowInstantMoncash) return null
    // The MonCash rail pays HTG and USD events (USD converted at withdrawal);
    // CAD/EUR events withdraw through Stripe and never reach it.
    if (currency !== 'HTG' && currency !== 'USD') return null

    // Same math as the server (computePrefundedPayout): fee on the gross, in the
    // event's currency; the rest is converted to HTG for a USD event.
    const quote = computeInstantMoncashQuote(availableToWithdraw, currency === 'USD' ? usdToHtgRate ?? 0 : 1)
    return {
      ...quote,
      // Only claim an HTG figure once we actually know the rate.
      payoutAmountHtgCents: currency === 'USD' && !usdToHtgRate ? null : quote.payoutAmountHtgCents,
    }
  }, [allowInstantMoncash, availableToWithdraw, currency, prefunding?.available, prefunding?.enabled, usdToHtgRate])

  // Platform can pay instantly but this organizer hasn't opted in — worth a
  // pointer to the setting, since the default is manual review.
  const instantOffered = Boolean(prefunding?.enabled && prefunding?.available && !allowInstantMoncash)

  // Centralized formatter (values are in cents server-side).
  const formatCurrency = (cents: number, curr: string) => fmtCurrency(cents, curr, { fromCents: true })

  // Per-rail floors. MonCash: 1,000 HTG (for a USD event, the server's converted
  // figure, else the quote's rate; unknown → let the server decide). Bank: 5,000 minor.
  const moncashMinMinor = useMemo(() => {
    const serverMin = earnings?.moncashMinimum?.minimumMinor
    if (typeof serverMin === 'number' && Number.isFinite(serverMin)) return serverMin
    return moncashMinimumMinor(currency, usdToHtgRate) ?? 0
  }, [earnings?.moncashMinimum?.minimumMinor, currency, usdToHtgRate])
  const moncashMinLabel = useMemo(() => {
    const htg = formatCurrency(MONCASH_MIN_WITHDRAWAL_HTG_CENTS, 'HTG')
    return currency === 'USD' && moncashMinMinor > 0 ? `${htg} (≈ ${formatCurrency(moncashMinMinor, 'USD')})` : htg
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, moncashMinMinor])
  const moncashBelowMinimum = availableToWithdraw > 0 && availableToWithdraw < moncashMinMinor
  const minimumFor = (m: 'moncash' | 'bank' | null) => (m === 'moncash' ? moncashMinMinor : BANK_MIN_WITHDRAWAL_CENTS)
  const belowMinimumMessage = (m: 'moncash' | 'bank' | null) =>
    m === 'moncash'
      ? t('organizerEarnings.validation.moncashBelowMinimumBody')
          .replace('{min}', moncashMinLabel)
          .replace('{balance}', formatCurrency(availableToWithdraw, currency))
      : t('organizerEarnings.validation.belowMinimumBody').replace('{min}', formatCurrency(BANK_MIN_WITHDRAWAL_CENTS, currency))

  // Map the raw settlement status ('ready'/'pending'/'locked') to a localized
  // label instead of printing the DB value.
  const settlementStatusLabel = useMemo(() => {
    const raw = String(earnings?.settlementStatus || 'pending')
    const key = raw === 'ready' ? 'ready' : raw === 'locked' ? 'locked' : 'pending'
    return t(`organizerEarnings.settlementLabels.${key}`)
  }, [earnings?.settlementStatus, t])

  // The loaded settlement date ("Available Aug 3"), formatted for the current
  // locale. Only meaningful while funds are not yet ready to withdraw.
  const settlementReadyDateLabel = useMemo(() => {
    const raw = earnings?.settlementReadyDate
    if (!raw) return ''
    const d = new Date(raw)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
  }, [earnings?.settlementReadyDate, dateLocale])

  /**
   * When the release ladder says the money is due — the date the withdraw button
   * will actually start working. Preferred over the settlement date, which is a
   * weaker promise: settlement can read "ready" while the post-event hold still
   * has hours to run.
   */
  const releaseDateLabel = useMemo(() => {
    const raw = earnings?.release?.availableAt
    if (!raw) return ''
    const d = new Date(raw)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
  }, [earnings?.release?.availableAt, dateLocale])

  const notReadyReason = useMemo(() => {
    // The payouts team holding an event is a different situation from waiting out
    // a hold, and saying "available Aug 20" would be a promise nobody can keep.
    if (earnings?.release?.reason === 'payout_under_review') {
      return t('organizerEarnings.notices.underReview')
    }
    if (earnings?.release?.reason === 'no_end_date') {
      return t('organizerEarnings.notices.missingEndDate')
    }
    const label = releaseDateLabel || settlementReadyDateLabel
    if (label) {
      return t('organizerEarnings.notices.notReadyWithDate').replace('{date}', label)
    }
    return t('organizerEarnings.notices.notReady')
  }, [earnings?.release?.reason, releaseDateLabel, settlementReadyDateLabel, t])

  const webBaseUrl = process.env.EXPO_PUBLIC_WEB_URL || 'https://tikem.co'

  const loadPayoutRail = useCallback(async () => {
    if (!user?.uid) {
      setIsStripeConnectAccount(false)
      setAccountLocation('')
      return
    }

    try {
      // Prefer backend payout profile (supports legacy fallback server-side).
      try {
        const res = await backendJson<{ profile: any | null }>('/api/organizer/payout-profiles/stripe-connect')
        const profile = res?.profile

        const loc = String(profile?.accountLocation || '').toLowerCase()
        const provider = String(profile?.payoutProvider || '').toLowerCase()
        const stripeAccountId = String(profile?.stripeAccountId || '')

        const stripe = Boolean(stripeAccountId) || provider === 'stripe_connect' || loc === 'united_states' || loc === 'canada'

        setIsStripeConnectAccount(stripe)
        setAccountLocation(loc)
        return
      } catch {
        // Fall back to Firestore read if API host is missing the endpoint.
      }

      const payoutRef = doc(db, 'organizers', user.uid, 'payoutConfig', 'main')
      const snap = await getDoc(payoutRef)
      const data = snap.exists() ? (snap.data() as any) : null

      const loc = String(data?.accountLocation || data?.bankDetails?.accountLocation || '').toLowerCase()
      const provider = String(data?.payoutProvider || '').toLowerCase()
      const stripe = provider === 'stripe_connect' || loc === 'united_states' || loc === 'canada'

      setIsStripeConnectAccount(stripe)
      setAccountLocation(loc)
    } catch (e) {
      // Default to Haiti rails if we can't read payout config.
      setIsStripeConnectAccount(false)
      setAccountLocation('')
    }
  }, [user?.uid])

  const loadIdentityStatus = useCallback(async () => {
    if (!user?.uid) {
      setIdentityVerified(false)
      return
    }
    try {
      const req = await getVerificationRequest(user.uid)
      setIdentityVerified(req?.status === 'approved')
    } catch {
      setIdentityVerified(false)
    }
  }, [user?.uid])

  // Whether a payout method exists (Haiti profile). Drives the "set up payouts"
  // guidance so users don't hit the raw "Haiti payout profile required" error.
  const loadPayoutMethod = useCallback(async () => {
    if (!user?.uid) {
      setHasPayoutMethod(null)
      return
    }
    try {
      const cfg = await backendJson<{ method?: string | null }>('/api/organizer/payout-config-summary')
      setHasPayoutMethod(!!cfg?.method)
    } catch {
      // Unknown — don't block the UI; leave null so withdraw buttons still show.
      setHasPayoutMethod(null)
    }
  }, [user?.uid])

  const loadEarnings = useCallback(async () => {
    setLoading(true)
    try {
      const event = await getEventById(eventId)
      setEventTitle(event?.title || '')
      const rawCountry = (event as any)?.country
      setEventCountry(normalizeCountryCode(rawCountry) || '')

      try {
        const res = await backendJson<{ earnings: EventEarnings | null }>(
          `/api/organizer/events/${eventId}/earnings`
        )
        setEarnings(res?.earnings || null)
        return
      } catch (e: any) {
        const message = String(e?.message || '')
        const isMissingEndpoint = message.includes('(404)') && message.includes(`/api/organizer/events/${eventId}/earnings`)

        if (!isMissingEndpoint) {
          throw e
        }

        // Fallback: the deployed API host doesn't have the per-event earnings endpoint.
        // We can still load the screen by computing total revenue from tickets.
        // NOTE: availableToWithdraw/withdrawnAmount/settlementStatus remain server-managed.
        const ticketsSnap = await getDocs(
          query(
            collection(db, 'tickets'),
            where('event_id', '==', eventId),
            where('status', 'in', ['active', 'checked_in', 'confirmed', 'valid'])
          )
        )

        const prices = ticketsSnap.docs
          .map((d) => (d.data() as any)?.price_paid)
          .filter((v) => typeof v === 'number' && isFinite(v)) as number[]

        const looksLikeDollars = prices.some((v) => Math.abs(v - Math.round(v)) > 1e-6) || prices.every((v) => v < 500)
        const totalCents = prices.reduce((sum, v) => sum + (looksLikeDollars ? Math.round(v * 100) : Math.round(v)), 0)

        const curr = String((event as any)?.currency || '').toUpperCase()
        const currency: 'HTG' | 'USD' = curr === 'HTG' ? 'HTG' : 'USD'

        setEarnings({
          totalEarned: totalCents,
          availableToWithdraw: 0,
          withdrawnAmount: 0,
          settlementStatus: 'pending',
          currency,
        })

        console.warn(
          '[OrganizerEventEarnings] Per-event earnings endpoint missing on API host; showing estimated total revenue only.'
        )
      }
    } catch (e: any) {
      console.error('Error loading earnings:', e)
      showAlert(t('common.error'), e?.message || t('organizerEarnings.errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [eventId, t])

  useEffect(() => {
    loadEarnings()
    loadPayoutRail()
    loadIdentityStatus()
    loadPayoutMethod()
  }, [loadEarnings])

  useFocusEffect(
    useCallback(() => {
      loadEarnings()
      loadPayoutRail()
      loadIdentityStatus()
      loadPayoutMethod()
    }, [loadEarnings, loadPayoutRail, loadIdentityStatus, loadPayoutMethod])
  )

  const openWithdraw = async (nextMethod: 'moncash' | 'bank') => {
    /**
     * Tikèm's own identity check gates the HAITI rail only, and only here — at
     * disbursement. Organizers create events and sell tickets without it; the
     * check is about who we are about to send money to, not who may use the app.
     *
     * On the Stripe rail it is Stripe that verifies identity during Connect
     * onboarding, and only Stripe's verdict can enable payouts. Asking for ID
     * here would add friction that unlocks nothing and make us hold PII we have
     * no reason to hold.
     */
    if (!requiresStripeConnect && !identityVerified) {
      showAlert(
        t('organizerEarnings.identity.title'),
        t('organizerEarnings.identity.alertBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('organizerEarnings.identity.cta'), onPress: () => navigation.navigate('OrganizerVerification') },
        ]
      )
      return
    }

    if (!earnings) {
      showAlert(t('organizerEarnings.validation.unavailableTitle'), t('organizerEarnings.validation.unavailableBody'))
      return
    }

    if (earnings.withdrawalBlocked) {
      showAlert(t('organizerEarnings.validation.unavailableTitle'), t('organizerEarnings.notices.needsAdminReview'))
      return
    }

    if (earnings?.settlementStatus !== 'ready') {
      showAlert(t('organizerEarnings.validation.notReadyTitle'), t('organizerEarnings.validation.notReadyBody'))
      return
    }

    if (availableToWithdraw <= 0) {
      showAlert(t('organizerEarnings.validation.nothingToWithdrawTitle'), t('organizerEarnings.validation.nothingToWithdrawBody'))
      return
    }

    if (!requiresStripeConnect && availableToWithdraw < minimumFor(nextMethod)) {
      showAlert(t('organizerEarnings.validation.belowMinimumTitle'), belowMinimumMessage(nextMethod))
      return
    }

    if (requiresStripeConnect) {
      showAlert(
        t('organizerEarnings.stripeConnectRequired.title'),
        t('organizerEarnings.stripeConnectRequired.body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('organizerEarnings.stripeConnectRequired.cta'),
            // Native Stripe onboarding (RN SDK embedded component); the screen
            // owns account creation and falls back to the hosted flow itself.
            onPress: () => navigation.navigate('StripeOnboarding', {}),
          },
        ]
      )
      return
    }

    setMethod(nextMethod)
    setShowWithdraw(true)
    setVerificationRequired(false)
    setPendingEndpoint(null)
    setPendingPayload(null)
    setVerificationCode('')

    if (nextMethod === 'moncash') {
      try {
        const [prefRaw, cfg] = await Promise.all([
          backendJson<any>('/api/organizer/payout-prefunding-status'),
          backendJson<{ allowInstantMoncash?: boolean }>('/api/organizer/payout-config-summary'),
        ])

        setPrefunding(parsePrefundingStatus(prefRaw))
        setAllowInstantMoncash(!!cfg?.allowInstantMoncash)
      } catch {
        setPrefunding(null)
        setAllowInstantMoncash(false)
      }

      if (currency === 'USD') {
        try {
          const q = await backendJson<{ quote?: { usdToHtgRate?: number | null } }>(
            `/api/organizer/withdraw-moncash/quote?eventId=${encodeURIComponent(String(eventId))}`
          )
          const rate = Number(q?.quote?.usdToHtgRate)
          setUsdToHtgRate(Number.isFinite(rate) && rate > 0 ? rate : null)
        } catch {
          setUsdToHtgRate(null)
        }
      }
    }

    if (nextMethod === 'bank') {
      try {
        const res = await backendFetch('/api/organizer/payout-destinations/bank')
        const raw = await res.text().catch(() => '')
        const data = (() => {
          try {
            return raw ? (JSON.parse(raw) as any) : {}
          } catch {
            return {}
          }
        })()

        if (!res.ok) {
          const msg = String(data?.error || data?.message || `Request failed (${res.status})`)
          throw new Error(msg)
        }

        const destinations = (data?.destinations || []) as BankDestination[]
        setBankDestinations(destinations)

        const primary = destinations.find((d) => d.isPrimary)
        if (primary) {
          setBankMode('on_file')
          setSelectedBankDestinationId(primary.id)
        } else if (destinations.length > 0) {
          setBankMode('saved')
          setSelectedBankDestinationId(destinations[0].id)
        } else {
          setBankMode('new')
          setSelectedBankDestinationId('')
        }
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (/payout profile required/i.test(msg) || /payout profile not active/i.test(msg) || /not configured/i.test(msg)) {
          showAlert(
            t('common.error'),
            msg || 'Payout setup is required before using bank withdrawals.',
            [
              {
                text: t('organizerEarnings.openPayoutSettings'),
                onPress: () => navigation.navigate('OrganizerPayoutSettings'),
              },
              { text: t('common.cancel'), style: 'cancel' },
            ]
          )
        }
        setBankDestinations(null)
        setBankMode('new')
        setSelectedBankDestinationId('')
      }
    }
  }

  const sendOtp = async () => {
    setIsSendingCode(true)
    try {
      await backendJson('/api/organizer/payout-details-change/send-email-code', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      showAlert(t('organizerEarnings.otp.codeSentTitle'), t('organizerEarnings.otp.codeSentBody'))
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerEarnings.errors.sendCodeFailed'))
    } finally {
      setIsSendingCode(false)
    }
  }

  const verifyOtpThenRetry = async () => {
    if (!verificationCode.trim()) {
      showAlert(t('organizerEarnings.otp.enterCodeTitle'), t('organizerEarnings.otp.enterCodeBody'))
      return
    }

    setIsVerifyingCode(true)
    try {
      await backendJson('/api/organizer/payout-details-change/verify-email-code', {
        method: 'POST',
        body: JSON.stringify({ code: verificationCode.trim() }),
      })

      setVerificationRequired(false)

      if (pendingEndpoint && pendingPayload) {
        await attemptWithdrawal(pendingEndpoint, pendingPayload)
      }
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerEarnings.errors.verificationFailed'))
    } finally {
      setIsVerifyingCode(false)
    }
  }

  const attemptWithdrawal = async (endpoint: string, payload: any) => {
    setSubmitting(true)
    try {
      const res = await backendJson<any>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      // Success. What lands in MonCash is always HTG; for a USD event the
      // server reports the converted figure separately.
      const received =
        typeof res?.payoutAmountHtgCents === 'number'
          ? formatCurrency(res.payoutAmountHtgCents, 'HTG')
          : formatCurrency(res?.payoutAmountCents || 0, currency)

      if (method === 'moncash' && res?.confirming) {
        // 202: the instant transfer was sent but MonCash hasn't confirmed it.
        // The balance stays reserved; resubmitting could pay twice.
        showAlert(t('organizerEarnings.success.confirmingTitle'), t('organizerEarnings.success.confirmingBody'))
      } else if (method === 'moncash' && res?.instant) {
        showAlert(
          t('organizerEarnings.success.instantTitle'),
          `${t('organizerEarnings.success.feeLabel')}${formatCurrency(res?.feeCents || 0, currency)}\n${t('organizerEarnings.success.youReceivedLabel')}${received}`
        )
      } else if (method === 'moncash' && res?.instantFallbackReason) {
        // Instant was on but the pool couldn't cover it: filed for manual
        // review instead, with no instant fee.
        showAlert(t('organizerEarnings.success.requestSubmittedTitle'), t('organizerEarnings.success.instantFallbackBody'))
      } else if (method === 'moncash') {
        showAlert(t('organizerEarnings.success.requestSubmittedTitle'), t('organizerEarnings.success.manualReviewBody'))
      } else {
        showAlert(t('organizerEarnings.success.requestSubmittedTitle'), t('organizerEarnings.success.requestSubmittedBody'))
      }

      setShowWithdraw(false)
      setMethod(null)
      await loadEarnings()
    } catch (e: any) {
      // backendJson appends " [url]" for debugging — never show that.
      const message = String(e?.message || t('organizerEarnings.errors.submitFailed')).replace(/\s*\[https?:[^\]]*\]\s*$/, '')
      const status = typeof e?.status === 'number' ? e.status : null
      const requires =
        e?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED' ||
        e?.payload?.requiresVerification === true ||
        (status === 403 && /verify|verification/i.test(message))

      if (status === 409) {
        // Another submit already took this balance (double tap, second device),
        // or the reservation was refused. Show the fresh balance.
        showAlert(t('organizerEarnings.errors.duplicateTitle'), t('organizerEarnings.errors.duplicateBody'))
        setShowWithdraw(false)
        setMethod(null)
        await loadEarnings()
        return
      }

      if (method === 'moncash' && status === 502) {
        // MonCash definitively refused the instant transfer; nothing moved and
        // the balance was released.
        showAlert(t('common.error'), t('organizerEarnings.errors.instantFailedBody'))
        await loadEarnings()
        return
      }

      if (/payout profile required/i.test(message) || /payout profile not active/i.test(message) || /not configured/i.test(message)) {
        showAlert(
          t('common.error'),
          message,
          [
            {
              text: t('organizerEarnings.openPayoutSettings'),
              onPress: () => navigation.navigate('OrganizerPayoutSettings'),
            },
            { text: t('common.ok'), style: 'cancel' },
          ]
        )
        return
      }

      if (requires) {
        setVerificationRequired(true)
        setPendingEndpoint(endpoint)
        setPendingPayload(payload)
        showAlert(
          t('organizerEarnings.otp.verificationRequiredTitle'),
          endpoint.includes('withdraw-moncash')
            ? t('organizerEarnings.otp.moncashNumberBody')
            : t('organizerEarnings.otp.verificationRequiredBody')
        )
        return
      }

      showAlert(t('common.error'), message)
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async () => {
    if (!method) return

    if (!earnings) {
      showAlert(t('organizerEarnings.validation.unavailableTitle'), t('organizerEarnings.validation.unavailableBody'))
      return
    }

    if (earnings.withdrawalBlocked) {
      showAlert(t('organizerEarnings.validation.unavailableTitle'), t('organizerEarnings.notices.needsAdminReview'))
      return
    }

    if (earnings?.settlementStatus !== 'ready') {
      showAlert(t('organizerEarnings.validation.notReadyTitle'), t('organizerEarnings.validation.notReadyBody'))
      return
    }

    if (availableToWithdraw <= 0) {
      showAlert(t('organizerEarnings.validation.nothingToWithdrawTitle'), t('organizerEarnings.validation.nothingToWithdrawBody'))
      return
    }

    if (availableToWithdraw < minimumFor(method)) {
      showAlert(t('organizerEarnings.validation.belowMinimumTitle'), belowMinimumMessage(method))
      return
    }

    if (method === 'moncash') {
      if (!moncashNumber.trim()) {
        showAlert(t('organizerEarnings.validation.missingPhoneTitle'), t('organizerEarnings.validation.missingPhoneBody'))
        return
      }
      await attemptWithdrawal('/api/organizer/withdraw-moncash', {
        eventId,
        amount: availableToWithdraw,
        moncashNumber: moncashNumber.trim(),
      })
      return
    }

    // bank
    if (bankMode === 'new') {
      if (!bankDetails.accountHolder.trim() || !bankDetails.bankName.trim() || !bankDetails.accountNumber.trim()) {
        showAlert(t('organizerEarnings.validation.missingBankDetailsTitle'), t('organizerEarnings.validation.missingBankDetailsBody'))
        return
      }

      await attemptWithdrawal('/api/organizer/withdraw-bank', {
        eventId,
        amount: availableToWithdraw,
        bankDetails: {
          accountHolder: bankDetails.accountHolder.trim(),
          bankName: bankDetails.bankName.trim(),
          accountNumber: bankDetails.accountNumber.trim(),
          routingNumber: bankDetails.routingNumber.trim() || undefined,
          swiftCode: bankDetails.swiftCode.trim() || undefined,
        },
        saveDestination: saveNewBankDestination,
      })
      return
    }

    if (!selectedBankDestinationId) {
      showAlert(t('organizerEarnings.validation.selectAccountTitle'), t('organizerEarnings.validation.selectAccountBody'))
      return
    }

    await attemptWithdrawal('/api/organizer/withdraw-bank', {
      eventId,
      amount: availableToWithdraw,
      bankDestinationId: selectedBankDestinationId,
    })
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <OrganizerScreenHeader
          title={t('organizerEarnings.headerTitle')}
          subtitle={eventTitle || eventId}
          onBack={() => navigation.goBack()}
        />
        <EarningsSkeleton />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <OrganizerScreenHeader
        title={t('organizerEarnings.headerTitle')}
        subtitle={eventTitle || eventId}
        onBack={() => navigation.goBack()}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t('organizerEarnings.availableToWithdraw')}</Text>
          <Text style={styles.amountText} numberOfLines={1} adjustsFontSizeToFit>{formatCurrency(availableToWithdraw, currency)}</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.metaText}>{t('organizerEarnings.settlement')}</Text>
            <Text style={styles.metaText}>{settlementStatusLabel}</Text>
          </View>
          {/* When funds aren't ready, tie the zeroed balance to the reason + date
              so "Available to withdraw: 0" doesn't read as an error. */}
          {earnings && earnings.settlementStatus !== 'ready' ? (
            <View style={styles.rowBetween}>
              <Text style={styles.metaText}>{t('organizerEarnings.availableOn')}</Text>
              <Text style={styles.metaText}>{settlementReadyDateLabel || t('organizerEarnings.availableOnUnknown')}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ height: 12 }} />

        {/* Performance triplet (POSH §2.3): Revenue / Tickets Sold / Net. */}
        <StatTriplet
          items={[
            {
              label: t('organizerEarnings.stats.revenue') || 'Revenue',
              value:
                typeof earnings?.grossSales === 'number'
                  ? formatCurrency(earnings.grossSales, currency)
                  : null,
            },
            {
              label: t('organizerEarnings.stats.ticketsSold') || 'Tickets Sold',
              value: typeof earnings?.ticketsSold === 'number' ? earnings.ticketsSold : null,
            },
            {
              label: t('organizerEarnings.stats.net') || 'Net',
              value:
                typeof earnings?.netAmount === 'number'
                  ? formatCurrency(earnings.netAmount, currency)
                  : null,
              tone: 'emerald',
            },
          ]}
        />

        <View style={{ height: 12 }} />

        {/*
          STRIPE FIRST. Identity on the US/Canada/France rail is Stripe's job —
          Stripe Connect collects and verifies it during onboarding, and only
          Stripe's verdict can turn payouts on. Asking those organizers for ID
          here would be friction that unlocks nothing, on top of PII we have no
          reason to hold. Tikèm's own KYC exists for HAITI, where we operate the
          payout rail ourselves and are the party that must know who we are
          paying. Testing identity first sent US organizers into the Haitian flow.
        */}
        {requiresStripeConnect ? (
          <View style={styles.noticeStack}>
            <InfoNotice icon="card-outline" text={t('organizerEarnings.stripeNotice')} />
            <SecondaryPill
              style={styles.noticeCta}
              label={t('organizerEarnings.openPayoutSettings')}
              icon={<Ionicons name="settings-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate('OrganizerPayoutSettings')}
            />
          </View>
        ) : identityVerified === false ? (
          <View style={styles.noticeStack}>
            <InfoNotice
              icon="shield-checkmark-outline"
              text={t('organizerEarnings.identity.noticeBody')}
            />
            <SecondaryPill
              style={styles.noticeCta}
              label={t('organizerEarnings.identity.cta')}
              icon={<Ionicons name="shield-checkmark-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate('OrganizerVerification')}
            />
          </View>
        ) : identityVerified === true && hasPayoutMethod === false ? (
          // Verified, but no payout method yet → guide to set one up instead of
          // letting them tap Withdraw and hit "Haiti payout profile required".
          <View style={styles.noticeStack}>
            <InfoNotice
              icon="wallet-outline"
              text={t('organizerEarnings.noMethodNotice')}
            />
            <SecondaryPill
              style={styles.noticeCta}
              label={t('organizerEarnings.setUpPayouts')}
              icon={<Ionicons name="wallet-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate('OrganizerPayoutSettings')}
            />
          </View>
        ) : identityVerified === true ? (
          <>
            {/* The one white-pill primary for this screen (POSH §2.2). */}
            {moncashBelowMinimum ? (
              <View style={styles.noticeStack}>
                <InfoNotice
                  icon="information-circle-outline"
                  text={t('organizerEarnings.notices.moncashBelowMinimum')
                    .replace('{min}', moncashMinLabel)
                    .replace('{balance}', formatCurrency(availableToWithdraw, currency))}
                />
              </View>
            ) : null}
            <WhitePillCTA
              label={t('organizerEarnings.withdrawViaMoncash')}
              disabled={moncashBelowMinimum || Boolean(earnings?.withdrawalBlocked)}
              onPress={() => openWithdraw('moncash')}
              icon={<Ionicons name="phone-portrait-outline" size={20} color={tokenColors.onWhite} />}
            />

            <View style={{ height: 12 }} />

            {/* Secondary = dark-grey pill. */}
            <SecondaryPill
              label={t('organizerEarnings.withdrawToBank')}
              icon={<Ionicons name="business-outline" size={20} color={colors.text} />}
              onPress={() => openWithdraw('bank')}
            />
          </>
        ) : null}

        {!earnings ? (
          <View style={styles.noticeStack}>
            <InfoNotice icon="alert-circle-outline" text={t('organizerEarnings.notices.noEarnings')} />
          </View>
        ) : earnings.withdrawalBlocked ? (
          <View style={styles.noticeStack}>
            <InfoNotice icon="shield-outline" text={t('organizerEarnings.notices.needsAdminReview')} />
          </View>
        ) : earnings?.settlementStatus !== 'ready' ? (
          <View style={styles.noticeStack}>
            <InfoNotice icon="lock-closed-outline" text={notReadyReason} />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={showWithdraw} transparent animationType="slide" onRequestClose={() => setShowWithdraw(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {method === 'moncash'
                  ? t('organizerEarnings.modal.titleMoncash')
                  : t('organizerEarnings.modal.titleBank')}
              </Text>
              <TouchableOpacity onPress={() => setShowWithdraw(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.summaryBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.metaText}>{t('organizerEarnings.modal.amount')}</Text>
                <Text style={styles.metaText}>{formatCurrency(availableToWithdraw, currency)}</Text>
              </View>
              {method === 'moncash' && instantPreview ? (
                <>
                  <View style={styles.rowBetween}>
                    <Text style={styles.metaText}>{t('organizerEarnings.modal.instantFee')}</Text>
                    <Text style={styles.metaText}>{formatCurrency(instantPreview.feeCents, currency)}</Text>
                  </View>
                  <View style={styles.rowBetween}>
                    <Text style={styles.metaText}>{t('organizerEarnings.modal.youReceive')}</Text>
                    <Text style={styles.metaText}>
                      {currency === 'USD' && instantPreview.payoutAmountHtgCents != null
                        ? formatCurrency(instantPreview.payoutAmountHtgCents, 'HTG')
                        : formatCurrency(instantPreview.payoutAmountCents, currency)}
                    </Text>
                  </View>
                  {currency === 'USD' ? (
                    <Text style={styles.metaText}>
                      {instantPreview.payoutAmountHtgCents != null
                        ? t('organizerEarnings.modal.usdConverted').replace(
                            '{usd}',
                            formatCurrency(instantPreview.payoutAmountCents, 'USD')
                          )
                        : t('organizerEarnings.modal.usdConvertedNoRate')}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              {verificationRequired ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.sectionTitle}>{t('organizerEarnings.otp.verifyTitle')}</Text>
                  <Text style={styles.sectionHelp}>
                    {t('organizerEarnings.otp.verifyHelp')}
                  </Text>
                  <View style={styles.rowBetween}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={sendOtp} disabled={isSendingCode}>
                      <Text style={styles.secondaryButtonText}>
                        {isSendingCode ? t('organizerEarnings.otp.sending') : t('organizerEarnings.otp.sendCode')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    placeholder={t('organizerEarnings.otp.enterCodePlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                  <WhitePillCTA
                    label={isVerifyingCode ? t('organizerEarnings.otp.verifying') : t('organizerEarnings.otp.verifyAndContinue')}
                    onPress={verifyOtpThenRetry}
                    loading={isVerifyingCode}
                    disabled={submitting || isVerifyingCode}
                  />
                </View>
              ) : method === 'moncash' ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.sectionTitle}>{t('organizerEarnings.moncash.title')}</Text>
                  <TextInput
                    value={moncashNumber}
                    onChangeText={setMoncashNumber}
                    placeholder={t('organizerEarnings.moncash.placeholder')}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    keyboardType="phone-pad"
                    style={styles.input}
                  />
                  {instantPreview ? (
                    <Text style={styles.sectionHelp}>{t('organizerEarnings.moncash.instantAvailable')}</Text>
                  ) : (
                    <Text style={styles.sectionHelp}>{t('organizerEarnings.moncash.processedWithin24')}</Text>
                  )}
                  {instantOffered ? (
                    <TouchableOpacity
                      onPress={() => {
                        setShowWithdraw(false)
                        navigation.navigate('OrganizerPayoutSettings')
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.sectionHelp, { textDecorationLine: 'underline' }]}>
                        {t('organizerEarnings.moncash.instantOffered')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.sectionTitle}>{t('organizerEarnings.bank.title')}</Text>

                  <View style={styles.radioRow}>
                    <TouchableOpacity
                      style={[styles.radioChip, bankMode === 'on_file' ? styles.radioChipActive : null]}
                      onPress={() => setBankMode('on_file')}
                      disabled={!bankDestinations?.some((d) => d.isPrimary)}
                    >
                      <Text style={styles.radioChipText}>{t('organizerEarnings.bank.modes.onFile')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.radioChip, bankMode === 'saved' ? styles.radioChipActive : null]}
                      onPress={() => setBankMode('saved')}
                      disabled={!bankDestinations || bankDestinations.length === 0}
                    >
                      <Text style={styles.radioChipText}>{t('organizerEarnings.bank.modes.saved')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.radioChip, bankMode === 'new' ? styles.radioChipActive : null]}
                      onPress={() => setBankMode('new')}
                    >
                      <Text style={styles.radioChipText}>{t('organizerEarnings.bank.modes.new')}</Text>
                    </TouchableOpacity>
                  </View>

                  {bankMode !== 'new' ? (
                    <View style={{ marginTop: 10 }}>
                      {(bankDestinations || []).map((d) => (
                        <TouchableOpacity
                          key={d.id}
                          style={[styles.destinationRow, selectedBankDestinationId === d.id ? styles.destinationRowActive : null]}
                          onPress={() => setSelectedBankDestinationId(d.id)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.destinationTitle} numberOfLines={1}>
                              {d.bankName} ••••{d.accountNumberLast4}{d.isPrimary ? ` ${t('organizerEarnings.bank.primarySuffix')}` : ''}
                            </Text>
                            <Text style={styles.destinationSubtitle} numberOfLines={1}>{d.accountName}</Text>
                          </View>
                          <Ionicons
                            name={selectedBankDestinationId === d.id ? 'checkmark-circle' : 'ellipse-outline'}
                            size={20}
                            color={selectedBankDestinationId === d.id ? colors.primary : colors.textSecondary}
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <View style={{ marginTop: 10 }}>
                      <TextInput
                        value={bankDetails.accountHolder}
                        onChangeText={(v) => setBankDetails((s) => ({ ...s, accountHolder: v }))}
                        placeholder={t('organizerEarnings.bank.placeholders.accountHolder')}
                        placeholderTextColor={colors.textTertiary}
                        selectionColor={colors.primary}
                        style={styles.input}
                      />
                      <TextInput
                        value={bankDetails.bankName}
                        onChangeText={(v) => setBankDetails((s) => ({ ...s, bankName: v }))}
                        placeholder={t('organizerEarnings.bank.placeholders.bankName')}
                        placeholderTextColor={colors.textTertiary}
                        selectionColor={colors.primary}
                        style={styles.input}
                      />
                      <TextInput
                        value={bankDetails.accountNumber}
                        onChangeText={(v) => setBankDetails((s) => ({ ...s, accountNumber: v }))}
                        placeholder={t('organizerEarnings.bank.placeholders.accountNumber')}
                        placeholderTextColor={colors.textTertiary}
                        selectionColor={colors.primary}
                        style={styles.input}
                      />
                      <TextInput
                        value={bankDetails.routingNumber}
                        onChangeText={(v) => setBankDetails((s) => ({ ...s, routingNumber: v }))}
                        placeholder={t('organizerEarnings.bank.placeholders.routingNumberOptional')}
                        placeholderTextColor={colors.textTertiary}
                        selectionColor={colors.primary}
                        style={styles.input}
                      />
                      <TextInput
                        value={bankDetails.swiftCode}
                        onChangeText={(v) => setBankDetails((s) => ({ ...s, swiftCode: v }))}
                        placeholder={t('organizerEarnings.bank.placeholders.swiftOptional')}
                        placeholderTextColor={colors.textTertiary}
                        selectionColor={colors.primary}
                        style={styles.input}
                      />

                      <TouchableOpacity
                        style={styles.checkboxRow}
                        onPress={() => setSaveNewBankDestination((v) => !v)}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name={saveNewBankDestination ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={saveNewBankDestination ? colors.primary : colors.textSecondary}
                        />
                        <Text style={styles.checkboxText}>{t('organizerEarnings.bank.saveSecondAccount')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Text style={styles.sectionHelp}>
                    {t('organizerEarnings.bank.verificationHint')}
                  </Text>
                </View>
              )}
            </ScrollView>

            {!verificationRequired ? (
              <View style={styles.modalFooter}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowWithdraw(false)} disabled={submitting}>
                  <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <WhitePillCTA
                  style={styles.footerPill}
                  label={submitting ? t('organizerEarnings.submitting') : t('common.confirm')}
                  onPress={submit}
                  loading={submitting}
                  disabled={submitting}
                />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  // De-boxed hero (beta feedback: no grayed box backgrounds) — the balance sits
  // directly on the canvas, closed by a hairline before the stats triplet.
  card: {
    paddingVertical: 6,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cardLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  amountText: {
    marginTop: 8,
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  noticeStack: {
    marginTop: 14,
  },
  noticeCta: {
    marginTop: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  summaryBox: {
    marginTop: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: RADIUS.lg,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  sectionHelp: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    color: colors.text,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  footerPill: {
    flex: 1,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: RADIUS.md,
    // 56 = the system's primary-row height. This button shares the modal footer
    // row with a 56pt WhitePillCTA, so an off-scale 48 left the pair misaligned.
    minHeight: 56,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  radioRow: {
    flexDirection: 'row',
    gap: 8,
  },
  radioChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceMuted,
  },
  radioChipActive: {
    backgroundColor: colors.surfaceRaised,
  },
  radioChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  destinationRowActive: {
    borderColor: colors.textSecondary,
    backgroundColor: colors.surfaceRaised,
  },
  destinationTitle: {
    fontWeight: '700',
    color: colors.text,
  },
  destinationSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  checkboxText: {
    color: colors.text,
    fontWeight: '600',
  },
})
