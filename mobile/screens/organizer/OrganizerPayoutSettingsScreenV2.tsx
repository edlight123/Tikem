import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { backendFetch, backendJson } from '../../lib/api/backend'
import { getVerificationRequest, submitVerificationForReview } from '../../lib/verification'
import { useLocaleFormat } from '../../lib/format'
import { formatCurrency as fmtCurrency } from '../../lib/currency'
import {
  INSTANT_MONCASH_FEE_PERCENT,
  MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
  parsePrefundingStatus,
  type PrefundingStatus,
} from '../../lib/moncashPayout'
import { RADIUS } from '../../config/brand'
import { colors as T, font, radius } from '../../theme/tokens'
import { Skeleton } from '../../components/Skeleton'
import { useAppAlert } from '../../components/AppAlert'
import { statusTone } from '../../components/StatusChip'
import SectionHeader from '../../components/SectionHeader'
import EmptyState from '../../components/EmptyState'
import WhitePillCTA from '../../components/WhitePillCTA'
import MoneyText from '../../components/MoneyText'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import MarketsSheet, { FlagSquare, MarketsPicker } from '../../components/organizer/MarketsSheet'
import { ListGroup, ListRow } from '../../components/ui/ListRow'
import PayoutMethodFlow, {
  type BankFormState,
  type MoncashFormState,
  type PayoutMethodType,
} from '../../components/organizer/payouts/PayoutMethodFlow'
import { OTHER_BANK } from '../../data/haitiBanks'
import { getDeviceLocationInfo } from '../../utils/deviceLocation'
import { countryName, normalizeSupportedCountry } from '../../lib/countrySupport'
import {
  marketsForRail,
  railsForMarkets,
  shouldShowRail,
  useDeclaredMarkets,
} from '../../lib/organizerMarkets'
import { Globe, Landmark, Plus, Receipt, ShieldCheck, Smartphone, Zap } from 'lucide-react-native'
import { AFTER_ALERT_MS } from '../../lib/moderationActions'

import { Touchable } from '../../components/ui/Touchable';
import { Switch } from '../../components/ui/Switch';
import { useSwipeToClose } from '../../hooks/useSwipeToClose';
type VerificationStatus = 'not_started' | 'pending' | 'verified' | 'failed'

type BankDestination = {
  id: string
  type: 'bank'
  bankName: string
  accountName: string
  accountNumberLast4: string
  isPrimary: boolean
  createdAt: string
  updatedAt: string
  verificationStatus?: VerificationStatus
  verificationSubmittedAt?: string | null
}

type MoncashDestination = {
  id: string
  type: 'moncash'
  provider: string
  phoneNumber: string
  phoneNumberLast4: string
  accountName: string
  verificationStatus?: VerificationStatus
}

type PayoutDestination = BankDestination | MoncashDestination

// Read-only shape returned by GET /api/organizer/payout-history. Amounts are in
// MINOR units (cents) per the payout doc model; currency is optional (HTG default).
type PayoutHistoryItem = {
  id: string
  amount: number
  status: string
  method?: string
  currency?: string
  createdAt: string
  updatedAt?: string
}

type PayoutTab = 'methods' | 'history'

// Instant-open cache (mirrors TicketsScreen): the last-loaded payout methods +
// verification status paint immediately on open while the network refreshes
// silently in the background.
const payoutCacheKey = (uid: string) => `payout_settings_cache_${uid}`

// Feature flag: launching MonCash-only — the NatCash provider option is hidden
// for new payout methods (existing NatCash destinations still display). Flip to
// true to bring it back. Mirrors NATCASH_ENABLED in components/PaymentModal.tsx.
const NATCASH_ENABLED = false

/**
 * Status as a dot + sentence-case label (TestFlight #197: no uppercase chips
 * on this screen). Same locked tones as the shared StatusChip.
 */
function StatusDot({ status, label, lines = 1 }: { status: string; label?: string; lines?: number }) {
  const tone = statusTone(status)
  const text = label ?? tone.defaultLabel
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone.color }} />
      <Text style={{ fontSize: 13, color: T.textSecondary, flexShrink: 1 }} numberOfLines={lines}>
        {text}
      </Text>
    </View>
  )
}

type PayoutRegion = 'haiti' | 'international'

// The region the organizer last looked at, kept for this app session so
// coming back to the screen lands where they left it.
let lastRegionThisSession: PayoutRegion | null = null

const EMPTY_BANK_FORM: BankFormState = { accountName: '', bankName: '', accountNumber: '', routingNumber: '', swift: '' }
const EMPTY_MONCASH_FORM: MoncashFormState = { provider: 'moncash', accountName: '', phoneNumber: '+509 ' }

type SaveResult = 'ok' | 'verify' | 'error'

export default function OrganizerPayoutSettingsScreenV2() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const navigation = useNavigation<any>()
  const insets = useSafeAreaInsets()
  const { t } = useI18n()
  const { formatDate } = useLocaleFormat()
  const { user, userProfile } = useAuth()
  const showAlert = useAppAlert()
  // From an AppAlert button: the alert's own Modal is still fading out when
  // onPress fires, and a native-stack push racing that teardown can be dropped
  // on iOS (the "Verify Identity does nothing" report). Wait it out first.
  const openVerificationAfterAlert = useCallback(() => {
    setTimeout(() => navigation.navigate('OrganizerVerification'), AFTER_ALERT_MS)
  }, [navigation])

  // FIRST-PAINT gate only. `loading` starts true and flips false exactly once —
  // when the cache seed or the first network load paints. Background refreshes
  // (focus regain, pull-to-refresh) must NEVER flip it back: doing so unmounted
  // the whole ScrollView into skeletons mid-scroll, which testers saw as the
  // page "reloading on its own".
  const [loading, setLoading] = useState(true)
  // True once a live server load has landed — gates cache writes and stops a
  // slow cache read from clobbering fresher server data.
  const serverLoadedRef = useRef(false)
  // Dedupes overlapping loads (mount focus + pull-to-refresh, etc.).
  const loadInFlightRef = useRef(false)
  const [destinations, setDestinations] = useState<PayoutDestination[]>([])
  // Latest list for loadDestinations' merge (its callback must not go stale).
  const destinationsRef = useRef<PayoutDestination[]>([])
  destinationsRef.current = destinations
  // Stripe Connect (US/CA/FR) live status. `verified` = onboarding fully
  // complete (charges + payouts enabled); otherwise the card prompts to finish.
  const [stripeProfile, setStripeProfile] = useState<{ connected: boolean; verified: boolean; country?: string } | null>(null)
  const [identityVerified, setIdentityVerified] = useState(false)
  // The verification request's own status and per-step state, for the setup's
  // step 1 rows ("01 Your details" etc.) and the under-review chip.
  const [identityStatus, setIdentityStatus] = useState<string | null>(null)
  const [identitySteps, setIdentitySteps] = useState<Record<string, string> | null>(null)
  // A live server load has landed (state, not a ref, so the setup can react).
  const [serverLoaded, setServerLoaded] = useState(false)

  // Guided setup: which step is showing (null until live data picks one),
  // whether the organizer chose to leave it for now, and per-step drafts.
  const [setupStep, setSetupStep] = useState<1 | 2 | 3 | null>(null)
  const [setupDone, setSetupDone] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [marketsDraft, setMarketsDraft] = useState<string[]>([])
  const [setupMethod, setSetupMethod] = useState<'moncash' | 'bank' | null>(null)

  // Methods vs History toggle (History is an additive, read-only view).
  const [activeTab, setActiveTab] = useState<PayoutTab>('methods')
  const [refreshing, setRefreshing] = useState(false)

  // Payout history (lazily fetched the first time the History tab is shown).
  const [payouts, setPayouts] = useState<PayoutHistoryItem[]>([])
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [payoutsError, setPayoutsError] = useState(false)
  const [payoutsLoaded, setPayoutsLoaded] = useState(false)

  // Add / change a Haiti method: a three-step flow (type → details → save).
  const [flowVisible, setFlowVisible] = useState(false)
  const [flowStep, setFlowStep] = useState<1 | 2 | 3>(1)
  const [flowType, setFlowType] = useState<PayoutMethodType | null>(null)
  const [flowMode, setFlowMode] = useState<'add' | 'change'>('add')
  // The server asked for the payout-change email code before saving.
  const [flowNeedsCode, setFlowNeedsCode] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [verifyingOtp, setVerifyingOtp] = useState(false)

  // Bank form
  const [savingBank, setSavingBank] = useState(false)
  const [bankForm, setBankForm] = useState<BankFormState>(EMPTY_BANK_FORM)
  // Tracks the bank-name DROPDOWN selection (one of HAITI_BANKS). When it is
  // 'Other', a free-text field is revealed and the typed value is what lands in
  // bankForm.bankName. For a listed bank, the dropdown value IS bankForm.bankName.
  const [bankNameChoice, setBankNameChoice] = useState('')

  // MonCash form
  const [savingMoncash, setSavingMoncash] = useState(false)
  // Pre-fill the Haiti country code so organizers only type the local digits.
  const [moncashForm, setMoncashForm] = useState<MoncashFormState>(EMPTY_MONCASH_FORM)

  // The method whose detail sheet is open.
  const [detailDest, setDetailDest] = useState<PayoutDestination | null>(null)
  const detailSwipe = useSwipeToClose(() => setDetailDest(null), Boolean(detailDest))

  // Region on show: the organizer's pick this session, else where they run events.
  const [pickedRegion, setPickedRegion] = useState<PayoutRegion | null>(lastRegionThisSession)

  // Verification flow for selected destination
  const [selectedDestination, setSelectedDestination] = useState<PayoutDestination | null>(null)
  const [showVerificationModal, setShowVerificationModal] = useState(false)
  const [verificationType, setVerificationType] = useState<'bank_statement' | 'void_check' | 'utility_bill'>(
    'bank_statement'
  )
  const [verificationAsset, setVerificationAsset] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [submittingVerification, setSubmittingVerification] = useState(false)

  // Instant MonCash (prefunded) payouts. `haitiMethod` is the Haiti profile's
  // ACTIVE method — the opt-in only means something while payouts go to
  // MonCash. `prefunding` is the platform switch (null = not loaded / failed).
  const [haitiMethod, setHaitiMethod] = useState<string | null>(null)
  const [allowInstantMoncash, setAllowInstantMoncash] = useState(false)
  const [prefunding, setPrefunding] = useState<PrefundingStatus | null>(null)
  const [savingInstant, setSavingInstant] = useState(false)
  // A background refresh landing mid-toggle must not stomp the optimistic value.
  const savingInstantRef = useRef(false)

  // Maps a destination's verification status onto the shared StatusChip's locked
  // semantic tones (POSH §2.7) — pending is amber, not teal.
  const statusChip = useCallback((status?: VerificationStatus) => {
    if (status === 'verified') return { status: 'verified', label: t('organizerPayoutSettings.status.verified') }
    if (status === 'pending') return { status: 'pending', label: t('organizerPayoutSettings.status.underReview') }
    if (status === 'failed') return { status: 'error', label: t('organizerPayoutSettings.status.needsAttention') }
    return { status: 'neutral', label: t('organizerPayoutSettings.status.notVerified') }
  }, [t])

  // ── Declared markets ──────────────────────────────────────────────────────
  // Where the organizer says they'll run events. This narrows WHAT THEY SEE:
  // Haiti only and the Stripe rail never appears; Haiti + US and both appear as
  // two separate setups. It is not a permission — publish and withdrawal still
  // derive the required profile from the EVENT's country, server-side — and it
  // stays editable so a diaspora organizer can add a market at any time.
  const {
    markets: declaredMarkets,
    loaded: marketsLoaded,
    saving: savingMarkets,
    save: saveMarkets,
  } = useDeclaredMarkets(user?.uid)

  // Manual override: a declaration narrows the UI, it must never be able to
  // lock anyone out of a rail they turn out to need.
  const [showAllRails, setShowAllRails] = useState(false)
  /**
   * The country list is a sheet you open, never a form on the page. The page
   * shows the saved answer as one row; Change opens the sheet, where choices
   * are a draft until Save.
   */
  const [marketsSheetOpen, setMarketsSheetOpen] = useState(false)

  // Until markets have loaded we show everything — narrowing off a not-yet-known
  // answer would flash the wrong rails. A rail that is already SET UP always
  // stays visible: hiding a live payout method would misdescribe the account.
  const showHaitiRail =
    !marketsLoaded ||
    showAllRails ||
    shouldShowRail('haiti', declaredMarkets) ||
    destinations.length > 0
  const showStripeRail =
    !marketsLoaded ||
    showAllRails ||
    shouldShowRail('stripe_connect', declaredMarkets) ||
    Boolean(stripeProfile?.connected)
  const someRailHidden = !showHaitiRail || !showStripeRail

  const saveMarketsDraft = useCallback(
    async (next: string[]) => {
      try {
        await saveMarkets(next)
        setMarketsSheetOpen(false)
      } catch {
        showAlert(t('common.error'), t('organizerPayoutSettings.markets.saveFailed'))
      }
    },
    [saveMarkets, showAlert, t]
  )

  const marketsSummary =
    declaredMarkets.length > 0
      ? declaredMarkets.map((code) => countryName(code)).join(' · ')
      : t('organizerPayoutSettings.markets.notSet')

  // Cross-border payout advisory. A Stripe Express account's country is fixed
  // at creation and an organizer holds exactly ONE connected account, so a
  // US-registered organizer running a Canadian event is still paid — into the
  // US account, in USD, after a conversion. Surfaced here against their DECLARED
  // markets, and again at publish against the actual event country.
  const connectedAccountCountry = normalizeSupportedCountry(stripeProfile?.country)
  const mismatchedStripeMarkets = useMemo(() => {
    if (!connectedAccountCountry) return []
    return marketsForRail('stripe_connect', declaredMarkets).filter(
      (code) => code !== connectedAccountCountry
    )
  }, [connectedAccountCountry, declaredMarkets])

  const loadDestinations = useCallback(async () => {
    if (!user?.uid) return

    // null = that source could not be loaded (network blip, server error).
    // A failed source keeps what we already had instead of reading as "no
    // methods", which used to wipe the list (and its cache) and invite the
    // organizer to set MonCash or a bank up a second time.
    let bankRows: PayoutDestination[] | null = null
    let mobileMoneyRows: PayoutDestination[] | null = null

    try {
      // Load bank destinations from backend
      const bankRes = await backendFetch('/api/organizer/payout-destinations/bank')
      if (bankRes.ok) {
        const data = await bankRes.json()
        bankRows = (data?.destinations || []) as BankDestination[]
      }
    } catch (e) {
      console.error('Failed to load destinations:', e)
    }

    // Mobile-money (MonCash/NatCash) payout lives on the Haiti payout PROFILE,
    // not the bank destinations endpoint. Surface it as a destination row so a
    // saved MonCash method shows as configured instead of the empty state.
    try {
      const profileRes = await backendFetch('/api/organizer/payout-profiles/haiti')
      if (profileRes.ok) {
        const data = await profileRes.json()
        setHaitiMethod(data?.profile?.method ? String(data.profile.method) : null)
        if (!savingInstantRef.current) {
          setAllowInstantMoncash(Boolean(data?.profile?.allowInstantMoncash))
        }
        const mm = data?.profile?.mobileMoneyDetails
        mobileMoneyRows = []
        if (mm && (mm.phoneNumber || mm.accountName)) {
          const phone = String(mm.phoneNumber || '')
          const digits = phone.replace(/\D/g, '')
          const last4 = (digits || phone).slice(-4)
          mobileMoneyRows.push({
            id: 'haiti-mobile-money',
            type: 'moncash',
            provider: String(mm.provider || 'moncash'),
            phoneNumber: phone,
            phoneNumberLast4: last4,
            accountName: String(mm.accountName || ''),
            verificationStatus: data?.profile?.verificationStatus?.phone as VerificationStatus | undefined,
          })
        }
      }
    } catch (e) {
      console.error('Failed to load Haiti payout profile:', e)
    }

    // Stripe Connect (US/CA/FR) — live status so the card reflects REAL
    // onboarding completion (charges/payouts enabled), not just "account exists".
    try {
      const stripeRes = await backendFetch('/api/organizer/stripe/status')
      if (stripeRes.ok) {
        const data = await stripeRes.json()
        if (data?.connected) {
          setStripeProfile({
            connected: true,
            verified: data?.status === 'verified',
            country: data?.account?.country,
          })
        } else {
          setStripeProfile(null)
        }
      }
    } catch (e) {
      console.error('Failed to load Stripe status:', e)
    }

    // Fill a failed source from what is on screen, else from the saved cache
    // (the cache seed may not have painted yet on a cold open).
    let previous = destinationsRef.current
    if ((bankRows === null || mobileMoneyRows === null) && previous.length === 0) {
      try {
        const raw = await AsyncStorage.getItem(payoutCacheKey(user.uid))
        const cached = raw ? JSON.parse(raw) : null
        if (Array.isArray(cached?.destinations)) previous = cached.destinations
      } catch {}
    }
    const isMobileMoneyRow = (d: PayoutDestination) => d.id === 'haiti-mobile-money'
    const combined: PayoutDestination[] = [
      ...(bankRows ?? previous.filter((d) => !isMobileMoneyRow(d))),
      ...(mobileMoneyRows ?? previous.filter(isMobileMoneyRow)),
    ]

    setDestinations(combined)
    return combined
  }, [user?.uid])

  const loadPrefunding = useCallback(async () => {
    try {
      const raw = await backendJson<any>('/api/organizer/payout-prefunding-status')
      setPrefunding(parsePrefundingStatus(raw))
    } catch {
      // Unknown platform state: hide the opt-in rather than guess.
      setPrefunding(null)
    }
  }, [])

  const loadIdentityStatus = useCallback(async () => {
    if (!user?.uid) return

    try {
      const req = await getVerificationRequest(user.uid)
      setIdentityVerified(req?.status === 'approved')
      setIdentityStatus(req?.status ? String(req.status) : null)
      const steps: Record<string, string> = {}
      for (const [k, v] of Object.entries((req as any)?.steps || {})) steps[k] = String((v as any)?.status || 'incomplete')
      setIdentitySteps(steps)
    } catch {
      setIdentityVerified(false)
    }
  }, [user?.uid])

  // Background-safe load: keeps the current content on screen while fetching.
  // It never sets `loading` back to true, so a refresh can't swap the tree to
  // skeletons after first paint.
  const load = useCallback(async () => {
    if (loadInFlightRef.current) return
    loadInFlightRef.current = true
    try {
      await Promise.all([loadDestinations(), loadIdentityStatus(), loadPrefunding()])
      serverLoadedRef.current = true
      setServerLoaded(true)
    } finally {
      setLoading(false)
      loadInFlightRef.current = false
    }
  }, [loadDestinations, loadIdentityStatus, loadPrefunding])

  // Instant paint: seed from the AsyncStorage cache so subsequent opens show
  // methods + verification status immediately (never a blank screen), while the
  // focus effect below refreshes from the network in the background.
  useEffect(() => {
    if (!user?.uid) return
    let cancelled = false
    const uid = user.uid
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(payoutCacheKey(uid))
        if (raw && !cancelled && !serverLoadedRef.current) {
          const c = JSON.parse(raw)
          if (Array.isArray(c?.destinations)) setDestinations(c.destinations)
          setStripeProfile(c?.stripeProfile ?? null)
          setIdentityVerified(!!c?.identityVerified)
          setLoading(false)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [user?.uid])

  // Persist after every live load so the next open paints from cache. Gated on
  // serverLoadedRef so a cache seed never rewrites itself (or clears newer data).
  useEffect(() => {
    if (!user?.uid || !serverLoadedRef.current) return
    AsyncStorage.setItem(
      payoutCacheKey(user.uid),
      JSON.stringify({ destinations, stripeProfile, identityVerified }),
    ).catch(() => {})
  }, [user?.uid, destinations, stripeProfile, identityVerified, loading])

  // Refresh on focus (fires on mount too) — silently, in the background.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const loadPayouts = useCallback(async () => {
    if (!user?.uid) return
    setPayoutsLoading(true)
    setPayoutsError(false)
    try {
      const data = await backendJson<{ payouts?: PayoutHistoryItem[] }>('/api/organizer/payout-history')
      // Don't rely on the endpoint's ordering — sort newest first by createdAt.
      const list = (data?.payouts || [])
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setPayouts(list)
    } catch (e) {
      console.error('Failed to load payout history:', e)
      setPayoutsError(true)
    } finally {
      setPayoutsLoading(false)
      setPayoutsLoaded(true)
    }
  }, [user?.uid])

  // Fetch history the first time the tab is opened (and whenever a retry resets it).
  useEffect(() => {
    if (activeTab === 'history' && !payoutsLoaded && !payoutsLoading) {
      loadPayouts()
    }
  }, [activeTab, payoutsLoaded, payoutsLoading, loadPayouts])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      if (activeTab === 'history') {
        await loadPayouts()
      } else {
        await load()
      }
    } finally {
      setRefreshing(false)
    }
  }, [activeTab, load, loadPayouts])

  // Maps a payout status onto the shared StatusChip semantic tones + an i18n label.
  const payoutStatusMeta = useCallback((status: string): { tone: string; labelKey: string | null } => {
    switch (String(status).toLowerCase()) {
      case 'completed':
        return { tone: 'success', labelKey: 'completed' }
      case 'processing':
        return { tone: 'pending', labelKey: 'processing' }
      case 'pending':
        return { tone: 'pending', labelKey: 'pending' }
      case 'failed':
        return { tone: 'error', labelKey: 'failed' }
      case 'cancelled':
        return { tone: 'neutral', labelKey: 'cancelled' }
      default:
        return { tone: 'neutral', labelKey: null }
    }
  }, [])

  const payoutMethodLabel = useCallback((method?: string): string => {
    const key = String(method || '').toLowerCase()
    if (key.includes('mobile') || key.includes('moncash') || key.includes('natcash')) {
      return t('organizerPayoutSettings.payoutHistory.method.moncash')
    }
    if (key.includes('bank')) {
      return t('organizerPayoutSettings.payoutHistory.method.bank')
    }
    return method || ''
  }, [t])

  // Identity gate for adding or changing a payout method (same alert as before).
  const promptIdentity = useCallback(() => {
    showAlert(
      t('organizerPayoutSettings.identityRequired.title'),
      t('organizerPayoutSettings.identityRequired.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('organizerPayoutSettings.verifyIdentity'), onPress: openVerificationAfterAlert },
      ]
    )
  }, [showAlert, openVerificationAfterAlert, t])

  const resetOtp = useCallback(() => {
    setFlowNeedsCode(false)
    setOtpCode('')
    setOtpSent(false)
  }, [])

  const closeFlow = useCallback(() => {
    setFlowVisible(false)
    resetOtp()
  }, [resetOtp])

  // "Add a payout method": step 1 of the flow (choose MonCash or a bank).
  const openAddFlow = useCallback(() => {
    if (!identityVerified) {
      promptIdentity()
      return
    }
    setBankForm(EMPTY_BANK_FORM)
    setBankNameChoice('')
    setMoncashForm(EMPTY_MONCASH_FORM)
    setFlowType(null)
    setFlowMode('add')
    setFlowStep(1)
    resetOtp()
    setFlowVisible(true)
  }, [identityVerified, promptIdentity, resetOtp])

  // Opens the flow straight at the details step for one type.
  const openFlowAtDetails = useCallback(
    (type: PayoutMethodType, mode: 'add' | 'change') => {
      setFlowType(type)
      setFlowMode(mode)
      setFlowStep(2)
      resetOtp()
      setFlowVisible(true)
    },
    [resetOtp]
  )

  // Stripe Connect onboarding for events OUTSIDE Haiti (US/Canada/France).
  // The mobile payout screen was Haiti-only; this is the entry point that lets a
  // diaspora organizer declare their country and start Stripe onboarding, which
  // creates the connected account the checkout destination-charge path pays into.
  const startStripeConnect = useCallback(
    (accountLocation: 'united_states' | 'canada' | 'france') => {
      // Native Stripe onboarding (RN SDK embedded component). The screen owns
      // account creation, session minting, and the hosted-flow fallback. The
      // plain-WebView approach hung: Express onboarding needs Stripe user
      // authentication popups that react-native-webview can't open.
      navigation.navigate('StripeOnboarding', { accountLocation })
    },
    [navigation]
  )

  // Which region the organizer belongs to by default: a DECLARATION outranks
  // any inference — the organizer said outright where they run events, and the
  // first market they named leads.
  const ownRegion = useMemo<PayoutRegion>(() => {
    const rails = railsForMarkets(declaredMarkets)
    if (rails.length > 0) return rails[0] === 'stripe_connect' ? 'international' : 'haiti'

    // Nothing declared, but only Stripe is set up: that is where they are paid.
    if (stripeProfile?.connected && destinations.length === 0) return 'international'

    const stated = (userProfile as any)?.default_country
    const code = stated || (() => {
      try {
        const d = getDeviceLocationInfo()
        return d.isSupported ? d.country : null
      } catch {
        return null
      }
    })()
    return code && code !== 'HT' ? 'international' : 'haiti'
  }, [declaredMarkets, userProfile, stripeProfile?.connected, destinations.length])

  const region: PayoutRegion = pickedRegion ?? ownRegion
  const pickRegion = useCallback((next: PayoutRegion) => {
    lastRegionThisSession = next
    setPickedRegion(next)
  }, [])

  const handleAddStripe = useCallback(() => {
    if (!identityVerified) {
      promptIdentity()
      return
    }
    showAlert(t('organizerPayoutSettings.stripeSetup.title'), t('organizerPayoutSettings.stripeSetup.question'), [
      { text: t('organizerPayoutSettings.countries.united_states'), onPress: () => startStripeConnect('united_states') },
      { text: t('organizerPayoutSettings.countries.canada'), onPress: () => startStripeConnect('canada') },
      { text: t('organizerPayoutSettings.countries.france'), onPress: () => startStripeConnect('france') },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }, [identityVerified, promptIdentity, showAlert, startStripeConnect, t])

  /**
   * Saves the bank in the flow. Returns 'verify' when the server wants the
   * payout-change email code first (the flow then shows the code step and
   * retries), 'ok' on success, 'error' otherwise.
   */
  const handleSaveBank = useCallback(async (): Promise<SaveResult> => {
    if (!bankForm.accountName || !bankForm.bankName || !bankForm.accountNumber) {
      showAlert(t('organizerPayoutSettings.alerts.missingInfoTitle'), t('organizerPayoutSettings.alerts.missingBankBody'))
      return 'error'
    }

    setSavingBank(true)
    try {
      const res = await backendFetch('/api/organizer/payout-destinations/bank', {
        method: 'POST',
        body: JSON.stringify({
          bankDetails: {
            accountHolder: bankForm.accountName.trim(),
            bankName: bankForm.bankName.trim(),
            accountNumber: bankForm.accountNumber.trim(),
            routingNumber: bankForm.routingNumber.trim() || undefined,
            swiftCode: bankForm.swift.trim() || undefined,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        // Adding a bank needs a recent payout-change email code.
        if (data?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
          return 'verify'
        }
        throw new Error(data?.error || data?.message || t('organizerPayoutSettings.alerts.failedAddBank'))
      }

      // Also set the Haiti payout PROFILE method to bank_transfer (and store the
      // bank details on it) so the profile exists and withdraw-bank's
      // `method === 'bank_transfer'` check passes. The haiti route masks/persists
      // the details; the destinations endpoint above owns per-destination
      // verification. Switching methods flips the single Haiti profile method —
      // that's expected (one active method at a time).
      try {
        const profileRes = await backendFetch('/api/organizer/payout-profiles/haiti', {
          method: 'POST',
          body: JSON.stringify({
            method: 'bank_transfer',
            bankDetails: {
              accountName: bankForm.accountName.trim(),
              bankName: bankForm.bankName.trim(),
              accountNumber: bankForm.accountNumber.trim(),
              routingNumber: bankForm.routingNumber.trim() || undefined,
              swift: bankForm.swift.trim() || undefined,
            },
          }),
        })

        const profileData = await profileRes.json().catch(() => ({}))
        if (!profileRes.ok) {
          const msg = String(profileData?.message || profileData?.error || '')
          // Preserve OTP step-up: switching an existing method may require a
          // recent security verification before the profile change is accepted.
          // The bank itself is already saved, so retrying the whole save would
          // add it twice: say so and stop (as before).
          if (
            profileData?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED' ||
            msg.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
          ) {
            showAlert(
              t('organizerPayoutSettings.alerts.securityTitle'),
              t('organizerPayoutSettings.alerts.securityBody'),
              [{ text: t('common.ok') }]
            )
            closeFlow()
            await loadDestinations()
            return 'ok'
          }
          // Non-fatal: the bank destination itself was saved. Log and continue.
          console.warn('Failed to set Haiti profile method to bank_transfer:', msg)
        }
      } catch (e) {
        console.warn('Failed to set Haiti profile method to bank_transfer:', e)
      }

      showAlert(
        t('organizerPayoutSettings.alerts.bankAddedTitle'),
        t('organizerPayoutSettings.alerts.bankAddedBody'),
        [
          {
            text: t('organizerPayoutSettings.alerts.verifyNow'),
            onPress: () => {
              closeFlow()
              // Use the freshly-loaded list (not the stale `destinations` closure),
              // and wait out the flow's slide-down or iOS drops the next modal.
              Promise.all([
                loadDestinations(),
                new Promise((resolve) => setTimeout(resolve, AFTER_ALERT_MS)),
              ]).then(([fresh]) => {
                const newDest = (fresh || []).find((d) => d.id === data.destinationId)
                if (newDest) {
                  setSelectedDestination(newDest)
                  setShowVerificationModal(true)
                } else {
                  showAlert(t('organizerPayoutSettings.alerts.bankAddedTitle'), t('organizerPayoutSettings.alerts.verifyOpenFailed'))
                }
              })
            },
          },
          { text: t('organizerPayoutSettings.alerts.later'), onPress: closeFlow },
        ]
      )

      setBankForm(EMPTY_BANK_FORM)
      await loadDestinations()
      return 'ok'
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerPayoutSettings.alerts.failedSaveBank'))
      return 'error'
    } finally {
      setSavingBank(false)
    }
  }, [bankForm, loadDestinations, closeFlow, showAlert, t])

  const handleSaveMoncash = useCallback(async (): Promise<SaveResult> => {
    if (!moncashForm.accountName.trim() || !moncashForm.phoneNumber.trim()) {
      showAlert(t('organizerPayoutSettings.alerts.missingInfoTitle'), t('organizerPayoutSettings.alerts.missingMoncashBody'))
      return 'error'
    }

    setSavingMoncash(true)
    try {
      // Mobile-money payout lives on the Haiti payout profile (method: mobile_money),
      // which is what the MonCash withdrawal flow reads.
      const res = await backendFetch('/api/organizer/payout-profiles/haiti', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mobile_money',
          mobileMoneyDetails: {
            provider: moncashForm.provider,
            phoneNumber: moncashForm.phoneNumber.trim(),
            accountName: moncashForm.accountName.trim(),
          },
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Replacing an existing MonCash number needs a recent email OTP.
        if (data?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
          return 'verify'
        }
        throw new Error(data?.error || data?.message || t('organizerPayoutSettings.alerts.failedSaveMoncash'))
      }

      showAlert(t('organizerPayoutSettings.alerts.moncashSavedTitle'), t('organizerPayoutSettings.alerts.moncashSavedBody'))
      setMoncashForm(EMPTY_MONCASH_FORM)
      closeFlow()
      await loadDestinations()
      return 'ok'
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerPayoutSettings.alerts.failedSaveMoncash'))
      return 'error'
    } finally {
      setSavingMoncash(false)
    }
  }, [moncashForm, loadDestinations, closeFlow, showAlert, t])

  const saveFlowMethod = useCallback(async (): Promise<SaveResult> => {
    const result = flowType === 'bank' ? await handleSaveBank() : await handleSaveMoncash()
    if (result === 'verify') setFlowNeedsCode(true)
    return result
  }, [flowType, handleSaveBank, handleSaveMoncash])

  // Payout-change email code (the same endpoints the withdraw sheet uses).
  const sendPayoutChangeCode = useCallback(async () => {
    setSendingOtp(true)
    try {
      await backendJson('/api/organizer/payout-details-change/send-email-code', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setOtpSent(true)
      showAlert(t('organizerEarnings.otp.codeSentTitle'), t('organizerEarnings.otp.codeSentBody'))
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerEarnings.errors.sendCodeFailed'))
    } finally {
      setSendingOtp(false)
    }
  }, [showAlert, t])

  const verifyCodeThenSave = useCallback(async () => {
    if (!otpCode.trim()) {
      showAlert(t('organizerEarnings.otp.enterCodeTitle'), t('organizerEarnings.otp.enterCodeBody'))
      return
    }
    setVerifyingOtp(true)
    try {
      await backendJson('/api/organizer/payout-details-change/verify-email-code', {
        method: 'POST',
        body: JSON.stringify({ code: otpCode.trim() }),
      })
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerEarnings.errors.verificationFailed'))
      setVerifyingOtp(false)
      return
    }
    setVerifyingOtp(false)
    const result = await saveFlowMethod()
    if (result === 'verify') {
      showAlert(t('common.error'), t('organizerEarnings.errors.verificationFailed'))
    }
  }, [otpCode, saveFlowMethod, showAlert, t])

  const flowBack = useCallback(() => {
    if (flowNeedsCode) {
      resetOtp()
      return
    }
    // A "change" starts at the details step; back from there closes.
    const firstStep = flowMode === 'change' ? 2 : 1
    if (flowStep > firstStep) setFlowStep((flowStep - 1) as 1 | 2)
    else closeFlow()
  }, [flowNeedsCode, flowMode, flowStep, resetOtp, closeFlow])

  const flowContinue = useCallback(() => {
    if (flowStep === 1) {
      if (flowType) setFlowStep(2)
      return
    }
    if (flowStep === 2) {
      if (flowType === 'bank') {
        if (!bankForm.accountName.trim() || !bankForm.bankName.trim() || !bankForm.accountNumber.trim()) {
          showAlert(t('organizerPayoutSettings.alerts.missingInfoTitle'), t('organizerPayoutSettings.alerts.missingBankBody'))
          return
        }
      } else if (!moncashForm.accountName.trim() || !moncashForm.phoneNumber.replace(/\D/g, '').replace(/^509/, '')) {
        showAlert(t('organizerPayoutSettings.alerts.missingInfoTitle'), t('organizerPayoutSettings.alerts.missingMoncashBody'))
        return
      }
      setFlowStep(3)
    }
  }, [flowStep, flowType, bankForm, moncashForm, showAlert, t])

  /**
   * Instant MonCash opt-in. Optimistic: the switch moves at once, and snaps
   * back if the write fails. It sends ONLY the preference — resending the
   * payout details would read as a destination change and trip the OTP hold.
   */
  const toggleInstantMoncash = useCallback(
    async (next: boolean) => {
      if (savingInstantRef.current) return
      const previous = allowInstantMoncash
      savingInstantRef.current = true
      setSavingInstant(true)
      setAllowInstantMoncash(next)
      try {
        await backendJson('/api/organizer/payout-profiles/haiti', {
          method: 'POST',
          body: JSON.stringify({ allowInstantMoncash: next }),
        })
      } catch (e: any) {
        setAllowInstantMoncash(previous)
        if (e?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
          showAlert(t('organizerPayoutSettings.alerts.securityTitle'), t('organizerPayoutSettings.alerts.securityBody'))
        } else {
          showAlert(t('common.error'), t('organizerPayoutSettings.instantMoncash.saveFailed'))
        }
      } finally {
        savingInstantRef.current = false
        setSavingInstant(false)
      }
    },
    [allowInstantMoncash, showAlert, t]
  )

  // Only for an organizer whose Haiti payouts actually go to MonCash, and only
  // once the platform state is known.
  const hasActiveMoncash =
    haitiMethod === 'mobile_money' &&
    destinations.some(
      (d) => d.type === 'moncash' && String((d as MoncashDestination).provider || 'moncash').toLowerCase() === 'moncash'
    )
  const instantState: 'available' | 'paused' | 'not_yet' | null = !hasActiveMoncash || !prefunding
    ? null
    : !prefunding.enabled
      ? 'not_yet'
      : prefunding.available
        ? 'available'
        : 'paused'
  const instantFeeLabel = `${Math.round(INSTANT_MONCASH_FEE_PERCENT * 100)}%`

  const pickVerificationDocument = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (perm.status !== 'granted') {
      showAlert(t('organizerPayoutSettings.alerts.permissionTitle'), t('organizerPayoutSettings.alerts.permissionBody'))
      return
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    })

    if (!res.canceled && res.assets?.[0]) {
      setVerificationAsset(res.assets[0])
    }
  }, [t])

  const handleSubmitVerification = useCallback(async () => {
    if (!verificationAsset || !selectedDestination) {
      showAlert(t('organizerPayoutSettings.alerts.missingDocTitle'), t('organizerPayoutSettings.alerts.missingDocBody'))
      return
    }

    setSubmittingVerification(true)
    try {
      const uri = verificationAsset.uri
      const name = verificationAsset.fileName || `verification-${Date.now()}.jpg`
      const type = verificationAsset.mimeType || 'image/jpeg'

      const form = new FormData()
      form.append('verificationType', verificationType)
      form.append('destinationId', selectedDestination.id)
      form.append('proofDocument', { uri, name, type } as any)

      const res = await backendFetch('/api/organizer/submit-bank-verification', {
        method: 'POST',
        body: form as any,
        headers: {},
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || data?.message || t('organizerPayoutSettings.alerts.failedSubmit'))
      }

      showAlert(
        t('organizerPayoutSettings.alerts.submittedTitle'),
        t('organizerPayoutSettings.alerts.submittedBody')
      )

      setShowVerificationModal(false)
      setVerificationAsset(null)
      setSelectedDestination(null)
      await loadDestinations()
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerPayoutSettings.alerts.failedSubmit'))
    } finally {
      setSubmittingVerification(false)
    }
  }, [verificationAsset, selectedDestination, verificationType, loadDestinations, t])

  // ── Method helpers ───────────────────────────────────────────────────────
  const methodName = (dest: PayoutDestination) =>
    dest.type === 'bank'
      ? (dest as BankDestination).bankName
      : (dest as MoncashDestination).provider === 'natcash'
        ? 'NatCash'
        : 'MonCash'
  const methodLast4 = (dest: PayoutDestination) =>
    dest.type === 'bank' ? (dest as BankDestination).accountNumberLast4 : (dest as MoncashDestination).phoneNumberLast4

  // The Haiti profile pays to ONE active method: MonCash, or the bank saved
  // with it (the primary bank destination, else the first bank).
  const defaultDestinationId = useMemo(() => {
    if (haitiMethod === 'mobile_money') return 'haiti-mobile-money'
    if (haitiMethod === 'bank_transfer') {
      const banks = destinations.filter((d) => d.type === 'bank') as BankDestination[]
      return (banks.find((b) => b.isPrimary) ?? banks[0])?.id ?? null
    }
    return null
  }, [haitiMethod, destinations])

  // Opens a sheet/screen only after the detail sheet has finished closing:
  // iOS drops a modal presented while another is still animating out.
  const afterDetailCloses = (fn: () => void) => {
    setDetailDest(null)
    setTimeout(fn, AFTER_ALERT_MS)
  }

  const renderDetailSheet = () => {
    const dest = detailDest
    if (!dest) return null
    const isBank = dest.type === 'bank'
    const chip = statusChip(dest.verificationStatus)
    const holder = isBank ? (dest as BankDestination).accountName : (dest as MoncashDestination).accountName
    const canVerifyBank = isBank && dest.verificationStatus !== 'verified'
    const needsIdentity = !isBank && !identityVerified
    return (
      <>
        {/* The title drags the sheet down too (the grabber alone is a tiny target). */}
        <View {...detailSwipe.panHandlers}>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {methodName(dest)}
            <Text style={styles.modalTitleDigits}>{`  •••• ${methodLast4(dest)}`}</Text>
          </Text>
        </View>
        <ListGroup inset={16}>
          {holder ? <ListRow key="holder" title={t('organizerPayoutSettings.hub.holderLabel')} value={holder} /> : null}
          <ListRow
            key="status"
            title={t('organizerPayoutSettings.hub.status')}
            trailing={<StatusDot status={chip.status} label={chip.label} />}
          />
          {dest.id === defaultDestinationId ? (
            <ListRow key="default" title={t('organizerPayoutSettings.hub.default')} trailing={<Ionicons name="checkmark" size={18} color={colors.text} />} />
          ) : null}
        </ListGroup>
        <ListGroup inset={16} style={{ marginTop: 12 }}>
          {canVerifyBank ? (
            <ListRow
              key="verify"
              title={t('organizerPayoutSettings.hub.verifyAccount')}
              onPress={() =>
                afterDetailCloses(() => {
                  setSelectedDestination(dest)
                  setShowVerificationModal(true)
                })
              }
            />
          ) : null}
          {needsIdentity ? (
            <ListRow
              key="identity"
              title={t('organizerPayoutSettings.identityRowLabel')}
              onPress={() => afterDetailCloses(() => navigation.navigate('OrganizerVerification'))}
            />
          ) : null}
          <ListRow
            key="change"
            title={t('organizerPayoutSettings.markets.change')}
            onPress={() => afterDetailCloses(() => openChangeMethod(dest))}
          />
        </ListGroup>
      </>
    )
  }

  const modals = (
    <>
      <PayoutMethodFlow
        visible={flowVisible}
        step={flowStep}
        type={flowType}
        mode={flowMode}
        onBack={flowBack}
        onClose={closeFlow}
        onSelectType={(type) => {
          setFlowType(type)
          if (type === 'moncash' && !moncashForm.accountName) {
            setMoncashForm((s) => ({
              ...s,
              accountName: String((userProfile as any)?.full_name || (userProfile as any)?.name || ''),
            }))
          }
        }}
        onContinue={flowContinue}
        onSave={saveFlowMethod}
        saving={savingBank || savingMoncash}
        moncashForm={moncashForm}
        onMoncashChange={(patch) => setMoncashForm((s) => ({ ...s, ...patch }))}
        natcashEnabled={NATCASH_ENABLED}
        bankForm={bankForm}
        onBankChange={(patch) => setBankForm((s) => ({ ...s, ...patch }))}
        bankNameChoice={bankNameChoice}
        onBankChoice={(v) => {
          setBankNameChoice(v)
          // A listed bank writes straight into bankForm.bankName; 'Other'
          // clears it so the revealed free-text field supplies the value.
          setBankForm((s) => ({ ...s, bankName: v === OTHER_BANK ? '' : v }))
        }}
        needsCode={flowNeedsCode}
        code={otpCode}
        onCodeChange={setOtpCode}
        codeSent={otpSent}
        sendingCode={sendingOtp}
        verifyingCode={verifyingOtp}
        onSendCode={sendPayoutChangeCode}
        onVerifyAndSave={verifyCodeThenSave}
      />

      {/* One method's detail: status, default, verify, change. */}
      <Modal visible={Boolean(detailDest)} transparent animationType="slide" onRequestClose={() => setDetailDest(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetailDest(null)} />
          <Animated.View style={[styles.modalContent, detailSwipe.sheetStyle, { paddingBottom: insets.bottom + 20 }]}>
            <View {...detailSwipe.panHandlers}>
              <View style={styles.sheetHandle} />
            </View>
            {renderDetailSheet()}
          </Animated.View>
        </View>
      </Modal>

      {/* Bank Verification Modal */}
      <Modal
        visible={showVerificationModal}
        animationType="slide"
        onRequestClose={() => setShowVerificationModal(false)}
      >
        <View style={styles.container}>
          <OrganizerScreenHeader title={t('organizerPayoutSettings.verifyModal.headerTitle')} onBack={() => setShowVerificationModal(false)} />

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            {/* What the document must show: a requirement, so it stays. */}
            <Text style={styles.fieldEyebrow}>{t('organizerPayoutSettings.verifyModal.requiredTitle')}</Text>
            <ListGroup inset={16}>
              <ListRow key="a" title={t('organizerPayoutSettings.verifyModal.bulletAccount')} />
              <ListRow key="n" title={t('organizerPayoutSettings.verifyModal.bulletName')} />
              <ListRow key="b" title={t('organizerPayoutSettings.verifyModal.bulletBank')} />
            </ListGroup>

            <Text style={[styles.fieldEyebrow, { marginTop: 24 }]}>{t('organizerPayoutSettings.verifyModal.documentType')}</Text>
            <View style={styles.row}>
              {(['bank_statement', 'void_check', 'utility_bill'] as const).map((kind) => {
                const on = verificationType === kind
                const label =
                  kind === 'bank_statement'
                    ? t('organizerPayoutSettings.verifyModal.bankStatement')
                    : kind === 'void_check'
                      ? t('organizerPayoutSettings.verifyModal.voidCheck')
                      : t('organizerPayoutSettings.verifyModal.utilityBill')
                return (
                  <Touchable
                    key={kind}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => setVerificationType(kind)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{label}</Text>
                  </Touchable>
                )
              })}
            </View>

            <ListGroup inset={16} style={{ marginTop: 24 }}>
              <ListRow
                key="doc"
                title={
                  verificationAsset
                    ? verificationAsset.fileName || t('organizerPayoutSettings.verifyModal.imageFallback')
                    : t('organizerPayoutSettings.verifyModal.chooseDocument')
                }
                value={verificationAsset ? t('organizerPayoutSettings.verifyModal.changeDocument') : undefined}
                leading={
                  <Ionicons
                    name={verificationAsset ? 'checkmark-circle' : 'document-attach-outline'}
                    size={20}
                    color={verificationAsset ? colors.success : colors.textSecondary}
                  />
                }
                onPress={pickVerificationDocument}
              />
            </ListGroup>

            <WhitePillCTA
              style={{ marginTop: 24 }}
              label={t('organizerPayoutSettings.verifyModal.submit')}
              onPress={handleSubmitVerification}
              loading={submittingVerification}
              disabled={submittingVerification || !verificationAsset}
            />
          </ScrollView>
        </View>
      </Modal>

      <MarketsSheet
        visible={marketsSheetOpen}
        markets={declaredMarkets}
        saving={savingMarkets}
        onClose={() => setMarketsSheetOpen(false)}
        onSave={saveMarketsDraft}
      />
    </>
  )

  // ── Guided setup vs calm summary ──────────────────────────────────────────
  // The first time (no payout method yet) the screen is a three-step setup,
  // one decision per screen. Once a method exists it is a summary.
  const hasAnyMethod = destinations.length > 0 || Boolean(stripeProfile?.connected)
  const identitySubmitted = (['pending', 'pending_review', 'in_review'] as string[]).includes(String(identityStatus || ''))
  const showSetup = serverLoaded && marketsLoaded && !hasAnyMethod && !setupDone

  const firstIncompleteStep = useCallback((): 1 | 2 | 3 => {
    if (!identityVerified) return 1
    if (declaredMarkets.length === 0) return 2
    return 3
  }, [identityVerified, declaredMarkets.length])

  // Pick where the setup starts once, from live data: done steps are skipped.
  useEffect(() => {
    if (showSetup && setupStep === null) setSetupStep(firstIncompleteStep())
  }, [showSetup, setupStep, firstIncompleteStep])

  // Identity approved while the organizer sits on step 1 (they verified in the
  // hub and came back): that step is done, move on by itself.
  const prevVerifiedRef = useRef(identityVerified)
  useEffect(() => {
    if (setupStep === 1 && identityVerified && !prevVerifiedRef.current) {
      setSetupStep(declaredMarkets.length === 0 ? 2 : 3)
    }
    prevVerifiedRef.current = identityVerified
  }, [identityVerified, setupStep, declaredMarkets.length])

  // Step 2 edits a draft of the saved answer.
  useEffect(() => {
    if (setupStep === 2) setMarketsDraft(declaredMarkets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupStep])

  // Step 3: MonCash leads when the Haiti rail is offered.
  useEffect(() => {
    if (setupStep === 3 && setupMethod === null) {
      setSetupMethod(showHaitiRail ? 'moncash' : null)
      setMoncashForm((s) => ({
        ...s,
        accountName: s.accountName || String((userProfile as any)?.full_name || (userProfile as any)?.name || ''),
      }))
    }
  }, [setupStep, setupMethod, showHaitiRail, userProfile])

  const identityStepRows: Array<{ id: 'organizerInfo' | 'governmentId' | 'selfie'; route: string }> = [
    { id: 'organizerInfo', route: 'OrganizerInfoForm' },
    { id: 'governmentId', route: 'GovernmentIDUpload' },
    { id: 'selfie', route: 'SelfieUpload' },
  ]

  // No verification request yet: the hub creates it, so start there rather
  // than opening a step screen with nothing behind it.
  const openIdentityStep = (route: string) => {
    if (!identitySteps || Object.keys(identitySteps).length === 0) {
      navigation.navigate('OrganizerVerification')
      return
    }
    navigation.navigate(route, { onComplete: loadIdentityStatus })
  }

  const continueFromIdentity = useCallback(async () => {
    if (identityVerified || identitySubmitted) {
      setSetupStep(declaredMarkets.length === 0 ? 2 : 3)
      return
    }
    const next = identityStepRows.find((r) => identitySteps?.[r.id] !== 'complete')
    if (next) {
      openIdentityStep(next.route)
      return
    }
    // Every step is done but not yet sent: send it for review, as the hub's
    // Submit does, then carry on with the rest of the setup.
    if (!user?.uid) return
    setSetupBusy(true)
    try {
      await submitVerificationForReview(user.uid)
      await loadIdentityStatus()
      setSetupStep(declaredMarkets.length === 0 ? 2 : 3)
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('verification.organizerVerification.submit.failed'))
    } finally {
      setSetupBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityVerified, identitySubmitted, identitySteps, declaredMarkets.length, navigation, loadIdentityStatus, user?.uid, showAlert, t])

  const continueFromMarkets = useCallback(async () => {
    const dirty =
      marketsDraft.length !== declaredMarkets.length || marketsDraft.some((c) => !declaredMarkets.includes(c))
    if (dirty) {
      try {
        await saveMarkets(marketsDraft)
      } catch {
        showAlert(t('common.error'), t('organizerPayoutSettings.markets.saveFailed'))
        return
      }
    }
    setSetupStep(3)
  }, [marketsDraft, declaredMarkets, saveMarkets, showAlert, t])

  const requireIdentity = useCallback((): boolean => {
    if (identityVerified) return true
    showAlert(
      t('organizerPayoutSettings.identityRequired.title'),
      t('organizerPayoutSettings.identityRequired.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('organizerPayoutSettings.verifyIdentity'),
          // Step 1 only exists inside the first-time setup; from the summary
          // (e.g. Change on an existing method) open the verification hub.
          onPress: () => (showSetup ? setSetupStep(1) : openVerificationAfterAlert()),
        },
      ]
    )
    return false
  }, [identityVerified, showAlert, showSetup, openVerificationAfterAlert, t])

  const finishSetup = useCallback(async () => {
    if (setupMethod === 'moncash') {
      if (!requireIdentity()) return
      const result = await handleSaveMoncash()
      if (result === 'verify') {
        // Needs the payout-change email code: finish in the flow's code step.
        setFlowType('moncash')
        setFlowMode('add')
        setFlowStep(3)
        setOtpCode('')
        setOtpSent(false)
        setFlowNeedsCode(true)
        setFlowVisible(true)
      }
      return
    }
    if (setupMethod === 'bank') {
      if (!requireIdentity()) return
      setBankForm(EMPTY_BANK_FORM)
      setBankNameChoice('')
      openFlowAtDetails('bank', 'add')
      return
    }
    setSetupDone(true)
  }, [setupMethod, requireIdentity, handleSaveMoncash, openFlowAtDetails])

  const setupBack = () => {
    if (setupStep && setupStep > 1) setSetupStep((setupStep - 1) as 1 | 2)
    else navigation.goBack()
  }
  const setupLater = () => {
    if (setupStep === 1) setSetupStep(2)
    else if (setupStep === 2) setSetupStep(3)
    else setSetupDone(true)
  }

  const renderStepHeader = (step: number) => (
    <View style={[styles.stepHeader, { paddingTop: insets.top + 8 }]}>
      <View style={styles.stepHeaderRow}>
        <Touchable
          onPress={setupBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('organizerPayoutSettings.setup.back')}
          style={styles.stepHeaderSide}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Touchable>
        <Text style={styles.stepCount}>
          {t('organizerPayoutSettings.setup.stepOf').replace('{n}', String(step)).replace('{total}', '3')}
        </Text>
        <Touchable
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          style={[styles.stepHeaderSide, { alignItems: 'flex-end' }]}
        >
          <Text style={styles.stepCancel}>{t('organizerPayoutSettings.setup.cancel')}</Text>
        </Touchable>
      </View>
      <View style={styles.stepSegments}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.stepSegment, n <= step && styles.stepSegmentOn]} />
        ))}
      </View>
    </View>
  )

  const renderStepFooter = (label: string, onPress: () => void, opts: { disabled?: boolean; loading?: boolean; note?: string } = {}) => (
    <View style={[styles.stepFooter, { paddingBottom: insets.bottom + 12 }]}>
      {opts.note ? <Text style={styles.stepFooterNote}>{opts.note}</Text> : null}
      <WhitePillCTA label={label} onPress={onPress} disabled={opts.disabled} loading={opts.loading} />
      <TouchableOpacity onPress={setupLater} style={styles.stepLater} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.stepLaterText}>{t('organizerPayoutSettings.setup.later')}</Text>
      </TouchableOpacity>
    </View>
  )

  const identityRowIndicator = (status: string | undefined, isNext: boolean) => {
    if (status === 'complete') return <Ionicons name="checkmark-circle-outline" size={22} color={T.emerald} />
    if (status === 'needs_attention') return <View style={[styles.stepDot, { backgroundColor: colors.warning }]} />
    return <View style={[styles.stepDot, isNext ? { backgroundColor: colors.primary } : null]} />
  }

  const renderSetup = () => {
    const step = setupStep ?? 1

    if (step === 1) {
      const nextId = identityStepRows.find((r) => identitySteps?.[r.id] !== 'complete')?.id
      return (
        <>
          {renderStepHeader(1)}
          <ScrollView contentContainerStyle={styles.stepBody}>
            <Text style={styles.stepTitle}>{t('organizerPayoutSettings.setup.identity.title')}</Text>
            <Text style={styles.stepLead}>{t('organizerPayoutSettings.setup.identity.lead')}</Text>
            {identityVerified ? (
              <View style={styles.stepStatus}>
                <StatusDot status="verified" label={t('organizerPayoutSettings.status.verified')} />
              </View>
            ) : identitySubmitted ? (
              <View style={styles.stepStatus}>
                <StatusDot status="pending" label={t('organizerPayoutSettings.status.underReview')} />
              </View>
            ) : null}
            {identityStepRows.map((row, i) => {
              const status = identityVerified ? 'complete' : identitySteps?.[row.id]
              const isNext = !identityVerified && row.id === nextId
              const muted = !identityVerified && status !== 'complete' && !isNext
              return (
                <Touchable
                  key={row.id}
                  scale={0.98}
                  style={styles.numberedRow}
                  disabled={identityVerified || identitySubmitted}
                  onPress={() => openIdentityStep(row.route)}
                  accessibilityRole="button"
                >
                  <Text style={styles.rowNumber}>{String(i + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.numberedTitle, muted && styles.mutedText]}>
                      {t(`organizerPayoutSettings.setup.identity.${row.id}Title`)}
                    </Text>
                    <Text style={styles.numberedSub}>{t(`organizerPayoutSettings.setup.identity.${row.id}Sub`)}</Text>
                  </View>
                  {identityRowIndicator(status, isNext)}
                </Touchable>
              )
            })}
            <View style={styles.privacyNote}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.privacyText}>{t('organizerPayoutSettings.setup.identity.privacy')}</Text>
            </View>
          </ScrollView>
          {renderStepFooter(t('organizerPayoutSettings.setup.continue'), continueFromIdentity, { loading: setupBusy })}
        </>
      )
    }

    if (step === 2) {
      return (
        <>
          {renderStepHeader(2)}
          <ScrollView contentContainerStyle={styles.stepBody}>
            <Text style={[styles.stepTitle, styles.stepTitleSolo]}>{t('organizerPayoutSettings.setup.markets.title')}</Text>
            <Text style={styles.monoLabel}>{t('organizerPayoutSettings.setup.markets.pickAll')}</Text>
            <MarketsPicker
              draft={marketsDraft}
              onToggle={(code) =>
                setMarketsDraft((d) => (d.includes(code) ? d.filter((c) => c !== code) : [...d, code]))
              }
              disabled={savingMarkets}
              onCanvas
              showHint={false}
            />
          </ScrollView>
          {renderStepFooter(t('organizerPayoutSettings.setup.continue'), continueFromMarkets, {
            disabled: marketsDraft.length === 0 || savingMarkets,
            loading: savingMarkets,
          })}
        </>
      )
    }

    const stripeMarkets = marketsForRail('stripe_connect', declaredMarkets)
    const stripeLabel =
      stripeMarkets.length > 0
        ? stripeMarkets.map((code) => countryName(code)).join(', ')
        : t('organizerPayoutSettings.regions.internationalTitle')

    return (
      <>
        {renderStepHeader(3)}
        <ScrollView contentContainerStyle={styles.stepBody} keyboardShouldPersistTaps="handled">
          <Text style={[styles.stepTitle, styles.stepTitleSolo]}>{t('organizerPayoutSettings.setup.method.title')}</Text>

          {showHaitiRail ? (
            <>
              <Text style={styles.monoLabel}>{t('organizerPayoutSettings.setup.method.haitiLabel')}</Text>
              <Touchable
                scale={0.98}
                style={[styles.methodPick, setupMethod === 'moncash' && styles.methodPickOn]}
                onPress={() => setSetupMethod('moncash')}
                accessibilityRole="radio"
                accessibilityState={{ selected: setupMethod === 'moncash' }}
              >
                <View style={styles.methodPickHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.methodPickTitleRow}>
                      <Text style={styles.methodPickTitle}>MonCash</Text>
                      <Text style={styles.recommended}>{t('organizerPayoutSettings.setup.method.recommended')}</Text>
                    </View>
                    <Text style={styles.methodPickSub}>{t('organizerPayoutSettings.setup.method.moncashSub')}</Text>
                  </View>
                  <View style={[styles.radio, setupMethod === 'moncash' && styles.radioOn]}>
                    {setupMethod === 'moncash' ? <View style={styles.radioDot} /> : null}
                  </View>
                </View>
                {setupMethod === 'moncash' ? (
                  <View style={styles.inlineFields}>
                    <Text style={styles.monoLabelSmall}>{t('organizerPayoutSettings.setup.method.nameLabel')}</Text>
                    <TextInput
                      style={styles.inlineInput}
                      value={moncashForm.accountName}
                      onChangeText={(v) => setMoncashForm((s) => ({ ...s, accountName: v }))}
                      placeholder={t('organizerPayoutSettings.bankForm.fullNamePlaceholder')}
                      placeholderTextColor={colors.textTertiary}
                      selectionColor={colors.primary}
                    />
                    <Text style={[styles.monoLabelSmall, { marginTop: 14 }]}>
                      {t('organizerPayoutSettings.setup.method.numberLabel')}
                    </Text>
                    <TextInput
                      style={[styles.inlineInput, styles.inlineInputMono]}
                      value={moncashForm.phoneNumber}
                      onChangeText={(v) => setMoncashForm((s) => ({ ...s, phoneNumber: v }))}
                      placeholder="+509..."
                      placeholderTextColor={colors.textTertiary}
                      selectionColor={colors.primary}
                      keyboardType="phone-pad"
                    />
                  </View>
                ) : null}
              </Touchable>

              <Touchable
                scale={0.98}
                style={[styles.methodPick, setupMethod === 'bank' && styles.methodPickOn]}
                onPress={() => setSetupMethod('bank')}
                accessibilityRole="radio"
                accessibilityState={{ selected: setupMethod === 'bank' }}
              >
                <View style={styles.methodPickHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodPickTitle}>{t('organizerPayoutSettings.setup.method.bankTitle')}</Text>
                    <Text style={styles.methodPickSub}>{t('organizerPayoutSettings.setup.method.bankSub')}</Text>
                  </View>
                  <View style={[styles.radio, setupMethod === 'bank' && styles.radioOn]}>
                    {setupMethod === 'bank' ? <View style={styles.radioDot} /> : null}
                  </View>
                </View>
              </Touchable>
            </>
          ) : null}

          {showStripeRail ? (
            <>
              <Text style={[styles.monoLabel, showHaitiRail && { marginTop: 24 }]}>
                {t('organizerPayoutSettings.setup.method.stripeLabel').replace('{countries}', stripeLabel)}
              </Text>
              <Touchable scale={0.98} style={styles.methodPick} onPress={handleAddStripe} accessibilityRole="button">
                <View style={styles.methodPickHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodPickTitle}>Stripe</Text>
                    <Text style={styles.methodPickSub}>{t('organizerPayoutSettings.setup.method.stripeSub')}</Text>
                  </View>
                  <Text style={styles.connectLink}>{t('organizerPayoutSettings.setup.method.connect')}</Text>
                </View>
              </Touchable>
            </>
          ) : null}

          {someRailHidden ? (
            <TouchableOpacity onPress={() => setShowAllRails(true)} style={{ alignSelf: 'center' }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.marketsShowAll}>{t('organizerPayoutSettings.markets.showAllRails')}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
        {renderStepFooter(t('organizerPayoutSettings.setup.finish'), finishSetup, {
          loading: savingMoncash,
          disabled: savingMoncash,
        })}
      </>
    )
  }

  const openChangeMethod = (dest: PayoutDestination) => {
    if (!requireIdentity()) return
    if (dest.type === 'moncash') {
      const m = dest as MoncashDestination
      setMoncashForm({ provider: m.provider || 'moncash', accountName: m.accountName || '', phoneNumber: m.phoneNumber || '+509 ' })
      openFlowAtDetails('moncash', 'change')
    } else {
      setBankForm(EMPTY_BANK_FORM)
      setBankNameChoice('')
      openFlowAtDetails('bank', 'change')
    }
  }

  if (showSetup) {
    return (
      <View style={styles.container}>
        {renderSetup()}
        {modals}
      </View>
    )
  }

  const inHistory = activeTab === 'history'
  const hub = (key: string) => t(`organizerPayoutSettings.hub.${key}`)

  // ── Region summaries (the two tiles at the top) ──────────────────────────
  const haitiSummary: { status: string; label: string } = (() => {
    const n = destinations.length
    if (n === 0) return { status: 'neutral', label: hub('notSetUp') }
    const count = n === 1 ? hub('methodCountOne') : hub('methodCountMany').replace('{n}', String(n))
    if (destinations.some((d) => d.verificationStatus === 'verified')) return { status: 'verified', label: `${count} · ${hub('ready')}` }
    if (destinations.some((d) => d.verificationStatus === 'pending')) return { status: 'pending', label: `${count} · ${hub('underReview')}` }
    return { status: 'actionneeded', label: `${count} · ${hub('actionNeeded')}` }
  })()
  const outsideSummary: { status: string; label: string } = !stripeProfile?.connected
    ? { status: 'neutral', label: hub('notSetUp') }
    : stripeProfile.verified
      ? { status: 'verified', label: hub('ready') }
      : { status: 'pending', label: hub('finishSetup') }

  const stripeCountry = stripeProfile?.country === 'CA' ? 'CA' : stripeProfile?.country === 'FR' ? 'FR' : 'US'
  const stripeCurrency = stripeCountry === 'CA' ? 'CAD' : stripeCountry === 'FR' ? 'EUR' : 'USD'
  const stripeAction = () => {
    if (stripeProfile?.connected) {
      startStripeConnect(stripeCountry === 'CA' ? 'canada' : stripeCountry === 'FR' ? 'france' : 'united_states')
    } else {
      handleAddStripe()
    }
  }
  const stripeActionLabel = !stripeProfile?.connected
    ? hub('connect')
    : stripeProfile.verified
      ? hub('manage')
      : hub('finishInStripe')

  const minimumHtg = fmtCurrency(MONCASH_MIN_WITHDRAWAL_HTG_CENTS, 'HTG', { fromCents: true, decimals: 0 })

  const renderRegionTile = (key: PayoutRegion, title: string, sub: string, summary: { status: string; label: string }) => {
    const on = region === key
    return (
      // Touchable styles its INNER view, so the equal-width flex lives on
      // this wrapper (the tiles were unequal and short of the row).
      <View key={key} style={styles.regionSlot}>
      <Touchable
        scale={0.98}
        style={[styles.regionTile, on && styles.regionTileOn]}
        onPress={() => pickRegion(key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${title}, ${summary.label}`}
      >
        <Text style={[styles.regionTitle, !on && styles.regionTitleOff]} numberOfLines={1}>{title}</Text>
        <Text style={styles.regionSub} numberOfLines={1}>{sub}</Text>
        <View style={{ marginTop: 10 }}>
          <StatusDot status={summary.status} label={summary.label} lines={2} />
        </View>
        {on ? <View style={styles.regionBar} /> : null}
      </Touchable>
      </View>
    )
  }

  const renderHaiti = () => (
    <>
      <View style={styles.sectionGap}>
        <SectionHeader title={hub('methodsTitle')} />
      </View>
      <ListGroup>
        {destinations.map((dest) => {
          const chip = statusChip(dest.verificationStatus)
          const isDefault = dest.id === defaultDestinationId
          return (
            <ListRow
              key={dest.id}
              icon={dest.type === 'bank' ? Landmark : Smartphone}
              title={methodName(dest)}
              subtitle={[`•••• ${methodLast4(dest)}`, isDefault ? hub('default') : null].filter(Boolean).join(' · ')}
              trailing={<StatusDot status={chip.status} label={chip.label} />}
              chevron
              onPress={() => setDetailDest(dest)}
            />
          )
        })}
        <ListRow key="add" icon={Plus} title={t('organizerPayoutSettings.addMethodRow')} onPress={openAddFlow} />
      </ListGroup>

      {/* Instant MonCash opt-in, only while payouts go to MonCash. */}
      {instantState ? (
        <ListGroup style={{ marginTop: 12 }}>
          <ListRow
            key="instant"
            icon={Zap}
            title={hub('instant')}
            subtitle={
              instantState === 'paused'
                ? hub('instantPaused')
                : t('organizerPayoutSettings.instantMoncash.feeLine').replace('{fee}', instantFeeLabel)
            }
            value={instantState === 'not_yet' ? hub('instantSoon') : undefined}
            trailing={
              instantState === 'not_yet' ? undefined : (
                <Switch
                  value={allowInstantMoncash}
                  onValueChange={toggleInstantMoncash}
                  disabled={instantState !== 'available' || savingInstant}
                  accessibilityLabel={hub('instant')}
                />
              )
            }
            chevron={false}
          />
          <ListRow key="min" icon={Receipt} title={hub('minimum')} value={minimumHtg} />
        </ListGroup>
      ) : null}
    </>
  )

  const renderOutside = () => (
    <>
      <View style={styles.sectionGap}>
        <SectionHeader title={hub('stripeTitle')} />
      </View>
      <ListGroup inset={60}>
        <ListRow
          key="stripe"
          icon={Globe}
          title={t('organizerPayoutSettings.stripe.title')}
          trailing={<StatusDot status={outsideSummary.status} label={outsideSummary.label} />}
          chevron
          onPress={stripeAction}
          accessibilityLabel={`${t('organizerPayoutSettings.stripe.title')}, ${outsideSummary.label}, ${stripeActionLabel}`}
        />
        {stripeProfile?.connected ? (
          <ListRow key="country" title={hub('country')} value={countryName(stripeCountry)} leading={<View style={styles.rowSpacer} />} />
        ) : null}
        {stripeProfile?.connected ? (
          <ListRow key="currency" title={hub('currency')} value={stripeCurrency} leading={<View style={styles.rowSpacer} />} />
        ) : null}
      </ListGroup>

      {/* One connected account, fixed country: other markets pay into it. */}
      {mismatchedStripeMarkets.length > 0 ? (
        <Text style={styles.caption}>
          {hub('mismatch')
            .replace('{currency}', stripeCurrency)
            .replace('{markets}', mismatchedStripeMarkets.map((code) => countryName(code)).join(', '))}
        </Text>
      ) : null}

      <WhitePillCTA style={{ marginTop: 20 }} label={stripeActionLabel} onPress={stripeAction} />
    </>
  )

  const marketsValue =
    declaredMarkets.length > 0
      ? declaredMarkets.map((code) => countryName(code)).join(', ')
      : t('organizerPayoutSettings.markets.notSet')

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={inHistory ? t('organizerPayoutSettings.payoutHistory.title') : hub('title')}
        onBack={() => (inHistory ? setActiveTab('methods') : navigation.goBack())}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {/* First-ever load only. After first paint this branch never shows
            again; background refreshes keep the data on screen. */}
        {loading || (!serverLoaded && !hasAnyMethod) ? (
          <View style={{ gap: 12 }}>
            <View style={styles.regionRow}>
              <Skeleton width="49%" height={96} radius={4} />
              <Skeleton width="49%" height={96} radius={4} />
            </View>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={64} radius={4} />
            ))}
          </View>
        ) : !inHistory ? (
          <>
            {/* Identity, only while it still needs doing. */}
            {!identityVerified ? (
              <ListGroup style={{ marginBottom: 16 }}>
                <ListRow
                  icon={ShieldCheck}
                  title={t('organizerPayoutSettings.identityRowLabel')}
                  trailing={
                    <StatusDot
                      status={identitySubmitted ? 'pending' : 'actionneeded'}
                      label={identitySubmitted ? hub('underReview') : hub('actionNeeded')}
                    />
                  }
                  chevron
                  onPress={() => navigation.navigate('OrganizerVerification')}
                />
              </ListGroup>
            ) : null}

            {/* Haiti | Outside Haiti: one region on screen at a time. */}
            <View style={styles.regionRow} accessibilityRole="tablist">
              {renderRegionTile('haiti', hub('haiti'), hub('haitiSub'), haitiSummary)}
              {renderRegionTile('international', hub('outside'), hub('outsideSub'), outsideSummary)}
            </View>

            {region === 'haiti' ? renderHaiti() : renderOutside()}

            {/* Settings that apply to both regions. */}
            <ListGroup style={{ marginTop: 32 }}>
              <ListRow
                key="markets"
                leading={
                  <View style={styles.flagTile}>
                    {declaredMarkets.length > 0 ? (
                      <FlagSquare code={declaredMarkets[0]} size={20} />
                    ) : (
                      <Globe size={18} color={colors.textSecondary} strokeWidth={1.75} />
                    )}
                  </View>
                }
                title={hub('eventsIn')}
                value={marketsValue}
                chevron
                disabled={!marketsLoaded}
                onPress={() => setMarketsSheetOpen(true)}
              />
              <ListRow
                key="history"
                icon={Receipt}
                title={t('organizerPayoutSettings.payoutHistory.title')}
                onPress={() => setActiveTab('history')}
              />
            </ListGroup>
          </>
        ) : payoutsLoading && !refreshing ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={72} radius={RADIUS.lg} />
            ))}
          </View>
        ) : payoutsError ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('organizerPayoutSettings.payoutHistory.errorTitle')}</Text>
            <Text style={styles.metaText}>{t('organizerPayoutSettings.payoutHistory.error')}</Text>
            <Touchable style={[styles.secondaryButton, { marginTop: 12 }]} onPress={loadPayouts}>
              <Text style={styles.secondaryButtonText}>{t('organizerPayoutSettings.payoutHistory.retry')}</Text>
            </Touchable>
          </View>
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t('organizerPayoutSettings.payoutHistory.emptyTitle')}
          />
        ) : (
          payouts.map((p) => {
            const meta = payoutStatusMeta(p.status)
            const label = meta.labelKey ? t(`organizerPayoutSettings.payoutHistory.status.${meta.labelKey}`) : p.status
            return (
              <View key={p.id} style={styles.payoutRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <MoneyText cents={p.amount} currency={(p.currency as any) || 'HTG'} style={styles.payoutAmount} />
                  <Text style={styles.payoutMeta} numberOfLines={1}>
                    {[payoutMethodLabel(p.method), formatDate(p.createdAt)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <StatusDot status={meta.tone} label={label} />
              </View>
            )
          })
        )}
      </ScrollView>

      {modals}
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // ── Guided setup ──
  stepHeader: {
    paddingHorizontal: 20,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
  },
  stepHeaderSide: {
    width: 80,
  },
  stepCount: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.textSecondary,
  },
  stepCancel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  stepSegments: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
  },
  stepSegment: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.surfaceRaised,
  },
  stepSegmentOn: {
    backgroundColor: colors.text,
  },
  stepBody: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
  },
  stepTitle: {
    fontFamily: font.serif,
    fontSize: 34,
    lineHeight: 40,
    color: colors.text,
  },
  // A step title with no lead under it keeps the lead's gap to the content.
  stepTitleSolo: { marginBottom: 24 },
  stepLead: {
    marginTop: 10,
    marginBottom: 24,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  stepStatus: {
    marginTop: -12,
    marginBottom: 18,
  },
  numberedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  rowNumber: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.textTertiary,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  numberedTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  numberedSub: {
    marginTop: 3,
    fontSize: 15,
    color: colors.textSecondary,
  },
  mutedText: {
    color: colors.textSecondary,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 7,
    backgroundColor: colors.textTertiary,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  // The one eyebrow style (ui/Text "eyebrow"); mono is for identifiers only.
  monoLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  monoLabelSmall: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  methodPick: {
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  methodPickOn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  methodPickHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  methodPickTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  methodPickTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  methodPickSub: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  recommended: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Selected radio: solid white with a black dot (same as the team role picker).
  radioOn: {
    backgroundColor: T.white,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: T.onWhite,
  },
  inlineFields: {
    marginTop: 16,
  },
  inlineInput: {
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    fontSize: 15,
  },
  inlineInputMono: {
    fontFamily: font.mono,
    letterSpacing: 1,
  },
  connectLink: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  stepFooter: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  stepFooterNote: {
    textAlign: 'center',
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  stepLater: {
    alignSelf: 'center',
    paddingVertical: 14,
  },
  stepLaterText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // ── Summary ──
  // Haiti | Outside Haiti: two filled tiles side by side; the one on show is a
  // step brighter with a white bar under it (no outline, no pill).
  regionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  regionSlot: { flex: 1 },
  regionTile: {
    flexGrow: 1,
    minHeight: 96,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  regionTileOn: {
    backgroundColor: colors.surfaceRaised,
  },
  regionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  regionTitleOff: {
    color: colors.textSecondary,
  },
  regionSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  regionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: T.white,
  },
  sectionGap: {
    marginTop: 28,
  },
  // Lines up value rows with the icon row above them (32 tile + 12 gap - 12 row gap).
  rowSpacer: {
    width: 32,
  },
  flagTile: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: T.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  fieldEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 10,
  },
  modalTitleDigits: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  // Plain list row (TestFlight #197): hairline between rows, no card.
  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  payoutAmount: {
    fontSize: 17,
  },
  payoutMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  metaText: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  marketsShowAll: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  // Compact inline card action (Manage on Stripe / Verify Now) — replaces the
  // old full-width 48px secondary bar inside method cards.
  secondaryButton: {
    backgroundColor: colors.surfaceRaised,
    // 56 = the system's full-width control height (WhitePillCTA / SecondaryPill).
    // These sit in the same stacks, so 48 was the odd one out.
    minHeight: 56,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: 20,
    paddingTop: 10,
    width: '100%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceRaised,
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
    marginBottom: 18,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
  },
  // Selected = solid white, black label (FilterPill convention), no outline.
  chipActive: {
    backgroundColor: T.white,
  },
  chipText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  chipTextActive: {
    color: T.onWhite,
  },
})
