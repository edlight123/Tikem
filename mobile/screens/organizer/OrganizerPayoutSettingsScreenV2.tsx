import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
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
import { font, radius } from '../../theme/tokens'
import { Skeleton } from '../../components/Skeleton'
import { useAppAlert } from '../../components/AppAlert'
import StatusChip from '../../components/StatusChip'
import SectionHeader from '../../components/SectionHeader'
import EmptyState from '../../components/EmptyState'
import WhitePillCTA from '../../components/WhitePillCTA'
import MoneyText from '../../components/MoneyText'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import SelectField from '../../components/organizer/SelectField'
import MarketsSheet, { FlagSquare, MarketsPicker } from '../../components/organizer/MarketsSheet'
import { HAITI_BANKS, OTHER_BANK } from '../../data/haitiBanks'
import { getDeviceLocationInfo } from '../../utils/deviceLocation'
import { countryName, normalizeSupportedCountry } from '../../lib/countrySupport'
import {
  marketsForRail,
  railsForMarkets,
  shouldShowRail,
  useDeclaredMarkets,
} from '../../lib/organizerMarkets'
import { Receipt, Wallet } from 'lucide-react-native'

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
 * One payout REGION rail. Uses the app's editorial section rail (Instrument
 * Serif, lowercased, with a tight grey subtitle) rather than a bold sans
 * heading, so this screen reads like the rest of Tikèm instead of a settings
 * pane. Status appears ONLY when the region needs attention — every method
 * below already carries its own VERIFIED / CONNECTED chip, so a second "Ready"
 * was noise saying what the rows already said.
 */
function RegionSection({
  colors,
  title,
  blurb,
  status,
  t,
}: {
  colors: ReturnType<typeof useTheme>['colors']
  title: string
  blurb: string
  status: 'ready' | 'pending' | 'none'
  t: (key: string) => string
}) {
  const trailing =
    status === 'ready' ? null : (
      <Text
        style={{
          fontSize: 11,
          letterSpacing: 0.4,
          color: status === 'pending' ? colors.warning ?? '#F5A524' : colors.textSecondary,
        }}
      >
        {status === 'pending'
          ? t('organizerPayoutSettings.regions.statusPending')
          : t('organizerPayoutSettings.regions.statusNone')}
      </Text>
    )

  return (
    <View style={{ marginTop: 18 }}>
      <SectionHeader title={title} subtitle={blurb} trailing={trailing} />
    </View>
  )
}

export default function OrganizerPayoutSettingsScreenV2() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const navigation = useNavigation<any>()
  const insets = useSafeAreaInsets()
  const { t } = useI18n()
  const { formatDate } = useLocaleFormat()
  const { user, userProfile } = useAuth()
  const showAlert = useAppAlert()

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

  // Add method modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedMethodType, setSelectedMethodType] = useState<'bank' | 'moncash' | null>(null)

  // Bank form
  const [showBankForm, setShowBankForm] = useState(false)
  const [savingBank, setSavingBank] = useState(false)
  const [bankForm, setBankForm] = useState({
    accountName: '',
    bankName: '',
    accountNumber: '',
    routingNumber: '',
    swift: '',
  })
  // Tracks the bank-name DROPDOWN selection (one of HAITI_BANKS). When it is
  // 'Other', a free-text field is revealed and the typed value is what lands in
  // bankForm.bankName. For a listed bank, the dropdown value IS bankForm.bankName.
  const [bankNameChoice, setBankNameChoice] = useState('')

  // MonCash form
  const [showMoncashForm, setShowMoncashForm] = useState(false)
  const [savingMoncash, setSavingMoncash] = useState(false)
  const [moncashForm, setMoncashForm] = useState({
    provider: 'moncash',
    accountName: '',
    // Pre-fill the Haiti country code so organizers only type the local digits.
    phoneNumber: '+509 ',
  })

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

  // Phone verification (for MonCash)
  const [phoneCode, setPhoneCode] = useState('')
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false)
  const [verifyingPhoneCode, setVerifyingPhoneCode] = useState(false)

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

  const handleAddMethodSelect = useCallback((type: 'bank' | 'moncash') => {
    if (!identityVerified) {
      showAlert(
        t('organizerPayoutSettings.identityRequired.title'),
        t('organizerPayoutSettings.identityRequired.body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('organizerPayoutSettings.verifyIdentity'), onPress: () => navigation.navigate('OrganizerVerification') },
        ]
      )
      return
    }

    setSelectedMethodType(type)
    setShowAddModal(false)

    if (type === 'bank') {
      setBankNameChoice('')
      setShowBankForm(true)
    } else {
      setMoncashForm({ provider: 'moncash', accountName: '', phoneNumber: '+509 ' })
      setShowMoncashForm(true)
    }
  }, [identityVerified, navigation, t])

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

  // The two payout REGIONS as pickable options. Which region an organizer
  // belongs to decides which rails can ever pay them, so the picker leads with
  // their own region and names the actual institutions — "Bank Account" alone
  // reads as universal, and a US organizer would reasonably fill in a form
  // wired to Sogebank/Unibank.
  const ownRegion = useMemo(() => {
    // A DECLARATION outranks any inference — the organizer said outright where
    // they run events, and the first market they named leads.
    const rails = railsForMarkets(declaredMarkets)
    if (rails.length > 0) return rails[0] === 'stripe_connect' ? 'international' : 'haiti'

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
  }, [declaredMarkets, userProfile])

  const haitiGroup = useMemo(
    () => ({
      key: 'haiti',
      isOwn: ownRegion === 'haiti',
      heading: t('organizerPayoutSettings.regions.haitiTitle'),
      options: [
        {
          key: 'bank',
          icon: 'card-outline',
          title: t('organizerPayoutSettings.methodOptions.bankTitle'),
          description: t('organizerPayoutSettings.methodOptions.bankDescription'),
          onPress: () => handleAddMethodSelect('bank'),
        },
        {
          key: 'moncash',
          icon: 'phone-portrait-outline',
          title: t('organizerPayoutSettings.methodOptions.moncashTitle'),
          description: t('organizerPayoutSettings.methodOptions.moncashDescription'),
          onPress: () => handleAddMethodSelect('moncash'),
        },
      ],
    }),
    [ownRegion, t, handleAddMethodSelect]
  )

  const handleAddStripe = useCallback(() => {
    if (!identityVerified) {
      showAlert(
        t('organizerPayoutSettings.identityRequired.title'),
        t('organizerPayoutSettings.identityRequired.body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('organizerPayoutSettings.verifyIdentity'), onPress: () => navigation.navigate('OrganizerVerification') },
        ]
      )
      return
    }
    setShowAddModal(false)
    showAlert(t('organizerPayoutSettings.stripeSetup.title'), t('organizerPayoutSettings.stripeSetup.question'), [
      { text: t('organizerPayoutSettings.countries.united_states'), onPress: () => startStripeConnect('united_states') },
      { text: t('organizerPayoutSettings.countries.canada'), onPress: () => startStripeConnect('canada') },
      { text: t('organizerPayoutSettings.countries.france'), onPress: () => startStripeConnect('france') },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }, [identityVerified, navigation, startStripeConnect, t])

  const internationalGroup = useMemo(
    () => ({
      key: 'international',
      isOwn: ownRegion === 'international',
      heading: t('organizerPayoutSettings.regions.internationalTitle'),
      options: [
        {
          key: 'stripe',
          icon: 'globe-outline',
          title: t('organizerPayoutSettings.methodOptions.stripeTitle'),
          description: t('organizerPayoutSettings.methodOptions.stripeDescription'),
          onPress: handleAddStripe,
        },
      ],
    }),
    [ownRegion, t, handleAddStripe]
  )

  const handleSaveBank = useCallback(async () => {
    if (!bankForm.accountName || !bankForm.bankName || !bankForm.accountNumber) {
      showAlert(t('organizerPayoutSettings.alerts.missingInfoTitle'), t('organizerPayoutSettings.alerts.missingBankBody'))
      return
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
        // Handle verification requirement
        if (data?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
          showAlert(
            t('organizerPayoutSettings.alerts.securityTitle'),
            data.message || t('organizerPayoutSettings.alerts.securityBody'),
            [{ text: t('common.ok') }]
          )
          setShowBankForm(false)
          return
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
          if (
            profileData?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED' ||
            msg.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
          ) {
            showAlert(
              t('organizerPayoutSettings.alerts.securityTitle'),
              t('organizerPayoutSettings.alerts.securityBody'),
              [{ text: t('common.ok') }]
            )
            setShowBankForm(false)
            await loadDestinations()
            return
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
              setShowBankForm(false)
              // Use the freshly-loaded list (not the stale `destinations` closure).
              loadDestinations().then((fresh) => {
                const newDest = (fresh || []).find((d) => d.id === data.destinationId)
                if (newDest) {
                  setSelectedDestination(newDest)
                  setShowVerificationModal(true)
                }
              })
            },
          },
          { text: t('organizerPayoutSettings.alerts.later'), onPress: () => setShowBankForm(false) },
        ]
      )

      setBankForm({ accountName: '', bankName: '', accountNumber: '', routingNumber: '', swift: '' })
      await loadDestinations()
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerPayoutSettings.alerts.failedSaveBank'))
    } finally {
      setSavingBank(false)
    }
  }, [bankForm, loadDestinations, t])

  const handleSaveMoncash = useCallback(async () => {
    if (!moncashForm.accountName.trim() || !moncashForm.phoneNumber.trim()) {
      showAlert(t('organizerPayoutSettings.alerts.missingInfoTitle'), t('organizerPayoutSettings.alerts.missingMoncashBody'))
      return
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
          showAlert(t('organizerPayoutSettings.alerts.securityTitle'), t('organizerPayoutSettings.alerts.securityBody'))
          return
        }
        throw new Error(data?.error || data?.message || t('organizerPayoutSettings.alerts.failedSaveMoncash'))
      }

      showAlert(t('organizerPayoutSettings.alerts.moncashSavedTitle'), t('organizerPayoutSettings.alerts.moncashSavedBody'))
      setMoncashForm({ provider: 'moncash', accountName: '', phoneNumber: '+509 ' })
      setShowMoncashForm(false)
      await loadDestinations()
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerPayoutSettings.alerts.failedSaveMoncash'))
    } finally {
      setSavingMoncash(false)
    }
  }, [moncashForm, loadDestinations, t])

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
  const instantMinimumLine = t('organizerPayoutSettings.instantMoncash.minimum')
    .replace('{htg}', fmtCurrency(MONCASH_MIN_WITHDRAWAL_HTG_CENTS, 'HTG', { fromCents: true, decimals: 0 }))
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

  const modals = (
    <>
      {/* Add Method Modal */}
      {/* A bottom sheet, like the markets and location pickers — not a card
          floating mid-screen — so every chooser on this page behaves alike. */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAddModal(false)} />
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>{t('organizerPayoutSettings.addModal.title')}</Text>
            <Text style={styles.modalSubtitle}>{t('organizerPayoutSettings.addModal.subtitle')}</Text>

            {/* Grouped by REGION, and the organizer's own region leads. A flat
                list made "Bank Account" a trap: every US organizer has a bank
                account, but that rail is Sogebank/Unibank — Haiti only. The
                region heading plus the named institutions in each row is what
                stops someone filling in the wrong section entirely. */}
            {[haitiGroup, internationalGroup]
              .filter((group) => (group.key === 'haiti' ? showHaitiRail : showStripeRail))
              .sort((a, b) => Number(b.isOwn) - Number(a.isOwn))
              .map((group) => (
                <View key={group.key}>
                  <Text style={styles.methodGroupHeading}>{group.heading}</Text>
                  {group.options.map((opt) => (
                    <TouchableOpacity
                      key={opt.key}
                      style={styles.methodOption}
                      onPress={opt.onPress}
                      activeOpacity={0.75}
                    >
                      <View style={styles.methodIcon}>
                        <Ionicons name={opt.icon as any} size={22} color={colors.text} />
                      </View>
                      <View style={styles.methodText}>
                        <Text style={styles.methodTitle}>{opt.title}</Text>
                        <Text style={styles.methodDescription} numberOfLines={2}>{opt.description}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}

            <TouchableOpacity style={[styles.secondaryButton, { marginTop: 8 }]} onPress={() => setShowAddModal(false)}>
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Bank Form Modal */}
      <Modal visible={showBankForm} animationType="slide" onRequestClose={() => setShowBankForm(false)}>
        <View style={styles.container}>
          <OrganizerScreenHeader title={t('organizerPayoutSettings.bankForm.headerTitle')} onBack={() => setShowBankForm(false)} />

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <Text style={styles.label}>{t('organizerPayoutSettings.bankForm.accountHolder')}</Text>
            <TextInput
              style={styles.input}
              value={bankForm.accountName}
              onChangeText={(v) => setBankForm((s) => ({ ...s, accountName: v }))}
              placeholder={t('organizerPayoutSettings.bankForm.fullNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
            />

            <SelectField
              label={t('organizerPayoutSettings.bankForm.bankName')}
              value={bankNameChoice}
              options={HAITI_BANKS}
              onSelect={(v) => {
                setBankNameChoice(v)
                // A listed bank writes straight into bankForm.bankName; 'Other'
                // clears it so the revealed free-text field supplies the value.
                setBankForm((s) => ({ ...s, bankName: v === OTHER_BANK ? '' : v }))
              }}
              placeholder={t('organizerPayoutSettings.bankForm.selectBank')}
              sheetTitle={t('organizerPayoutSettings.bankForm.selectBank')}
            />
            {bankNameChoice === OTHER_BANK && (
              <TextInput
                style={[styles.input, { marginTop: 12 }]}
                value={bankForm.bankName}
                onChangeText={(v) => setBankForm((s) => ({ ...s, bankName: v }))}
                placeholder={t('organizerPayoutSettings.bankForm.otherBankPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
              />
            )}

            <Text style={styles.label}>{t('organizerPayoutSettings.bankForm.accountNumber')}</Text>
            <TextInput
              style={styles.input}
              value={bankForm.accountNumber}
              onChangeText={(v) => setBankForm((s) => ({ ...s, accountNumber: v }))}
              placeholder={t('organizerPayoutSettings.bankForm.accountNumberPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              keyboardType="number-pad"
            />

            <Text style={styles.label}>{t('organizerPayoutSettings.bankForm.routingNumber')}</Text>
            <TextInput
              style={styles.input}
              value={bankForm.routingNumber}
              onChangeText={(v) => setBankForm((s) => ({ ...s, routingNumber: v }))}
              placeholder={t('organizerPayoutSettings.bankForm.routingNumberPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
            />

            <Text style={styles.label}>{t('organizerPayoutSettings.bankForm.swift')}</Text>
            <TextInput
              style={styles.input}
              value={bankForm.swift}
              onChangeText={(v) => setBankForm((s) => ({ ...s, swift: v }))}
              placeholder={t('organizerPayoutSettings.bankForm.swiftPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              autoCapitalize="characters"
            />

            <WhitePillCTA
              style={{ marginTop: 24 }}
              label={t('organizerPayoutSettings.bankForm.save')}
              onPress={handleSaveBank}
              loading={savingBank}
              disabled={savingBank}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* MonCash Form Modal */}
      <Modal visible={showMoncashForm} animationType="slide" onRequestClose={() => setShowMoncashForm(false)}>
        <View style={styles.container}>
          <OrganizerScreenHeader title={t('organizerPayoutSettings.moncashForm.headerTitle')} onBack={() => setShowMoncashForm(false)} />

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <Text style={styles.label}>{t('organizerPayoutSettings.moncashForm.provider')}</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.chip, moncashForm.provider === 'moncash' && styles.chipActive]}
                onPress={() => setMoncashForm((s) => ({ ...s, provider: 'moncash' }))}
              >
                <Text style={[styles.chipText, moncashForm.provider === 'moncash' && styles.chipTextActive]}>
                  MonCash
                </Text>
              </TouchableOpacity>
              {/* NatCash hidden for launch (MonCash-only). A previously saved
                  NatCash destination still renders in the list; only the
                  option to pick it for NEW methods is gated. */}
              {NATCASH_ENABLED && (
                <TouchableOpacity
                  style={[styles.chip, moncashForm.provider === 'natcash' && styles.chipActive]}
                  onPress={() => setMoncashForm((s) => ({ ...s, provider: 'natcash' }))}
                >
                  <Text style={[styles.chipText, moncashForm.provider === 'natcash' && styles.chipTextActive]}>
                    NatCash
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>{t('organizerPayoutSettings.moncashForm.accountName')}</Text>
            <TextInput
              style={styles.input}
              value={moncashForm.accountName}
              onChangeText={(v) => setMoncashForm((s) => ({ ...s, accountName: v }))}
              placeholder={t('organizerPayoutSettings.bankForm.fullNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
            />

            <Text style={styles.label}>{t('organizerPayoutSettings.moncashForm.phoneNumber')}</Text>
            <TextInput
              style={styles.input}
              value={moncashForm.phoneNumber}
              onChangeText={(v) => setMoncashForm((s) => ({ ...s, phoneNumber: v }))}
              placeholder="+509..."
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              keyboardType="phone-pad"
            />

            <WhitePillCTA
              style={{ marginTop: 24 }}
              label={t('organizerPayoutSettings.moncashForm.save')}
              onPress={handleSaveMoncash}
              loading={savingMoncash}
              disabled={savingMoncash}
            />
          </ScrollView>
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
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('organizerPayoutSettings.verifyModal.requiredTitle')}</Text>
              <Text style={styles.metaText}>
                {t('organizerPayoutSettings.verifyModal.requiredBody')}
              </Text>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.bulletPoint}>• {t('organizerPayoutSettings.verifyModal.bulletAccount')}</Text>
                <Text style={styles.bulletPoint}>• {t('organizerPayoutSettings.verifyModal.bulletName')}</Text>
                <Text style={styles.bulletPoint}>• {t('organizerPayoutSettings.verifyModal.bulletBank')}</Text>
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 16 }]}>{t('organizerPayoutSettings.verifyModal.documentType')}</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.chip, verificationType === 'bank_statement' && styles.chipActive]}
                onPress={() => setVerificationType('bank_statement')}
              >
                <Text style={[styles.chipText, verificationType === 'bank_statement' && styles.chipTextActive]}>
                  {t('organizerPayoutSettings.verifyModal.bankStatement')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, verificationType === 'void_check' && styles.chipActive]}
                onPress={() => setVerificationType('void_check')}
              >
                <Text style={[styles.chipText, verificationType === 'void_check' && styles.chipTextActive]}>
                  {t('organizerPayoutSettings.verifyModal.voidCheck')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, verificationType === 'utility_bill' && styles.chipActive]}
                onPress={() => setVerificationType('utility_bill')}
              >
                <Text style={[styles.chipText, verificationType === 'utility_bill' && styles.chipTextActive]}>
                  {t('organizerPayoutSettings.verifyModal.utilityBill')}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 16 }]}
              onPress={pickVerificationDocument}
            >
              <Ionicons name="document-attach-outline" size={20} color={colors.text} />
              <Text style={styles.secondaryButtonText}>
                {verificationAsset ? t('organizerPayoutSettings.verifyModal.changeDocument') : t('organizerPayoutSettings.verifyModal.chooseDocument')}
              </Text>
            </TouchableOpacity>

            {verificationAsset && (
              <View style={[styles.card, { marginTop: 12, backgroundColor: `${colors.success}10` }]}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={[styles.metaText, { marginLeft: 10, color: colors.success }]}>
                  {t('organizerPayoutSettings.verifyModal.documentSelected')}: {verificationAsset.fileName || t('organizerPayoutSettings.verifyModal.imageFallback')}
                </Text>
              </View>
            )}

            <WhitePillCTA
              style={{ marginTop: 24 }}
              label={t('organizerPayoutSettings.verifyModal.submit')}
              onPress={handleSubmitVerification}
              loading={submittingVerification}
              disabled={submittingVerification || !verificationAsset}
            />

            <Text style={[styles.metaHint, { marginTop: 16, textAlign: 'center' }]}>
              {t('organizerPayoutSettings.verifyModal.hint')}
            </Text>
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
        { text: t('organizerPayoutSettings.verifyIdentity'), onPress: () => setSetupStep(1) },
      ]
    )
    return false
  }, [identityVerified, showAlert, t])

  const finishSetup = useCallback(async () => {
    if (setupMethod === 'moncash') {
      if (!requireIdentity()) return
      await handleSaveMoncash()
      return
    }
    if (setupMethod === 'bank') {
      if (!requireIdentity()) return
      setBankNameChoice('')
      setShowBankForm(true)
      return
    }
    setSetupDone(true)
  }, [setupMethod, requireIdentity, handleSaveMoncash])

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
        <TouchableOpacity
          onPress={setupBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('organizerPayoutSettings.setup.back')}
          style={styles.stepHeaderSide}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.stepCount}>
          {t('organizerPayoutSettings.setup.stepOf').replace('{n}', String(step)).replace('{total}', '3')}
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          style={[styles.stepHeaderSide, { alignItems: 'flex-end' }]}
        >
          <Text style={styles.stepCancel}>{t('organizerPayoutSettings.setup.cancel')}</Text>
        </TouchableOpacity>
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
    if (status === 'complete') return <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
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
                <StatusChip status="verified" label={t('organizerPayoutSettings.status.verified')} />
              </View>
            ) : identitySubmitted ? (
              <View style={styles.stepStatus}>
                <StatusChip status="pending" label={t('organizerPayoutSettings.status.underReview')} />
              </View>
            ) : null}
            {identityStepRows.map((row, i) => {
              const status = identityVerified ? 'complete' : identitySteps?.[row.id]
              const isNext = !identityVerified && row.id === nextId
              const muted = !identityVerified && status !== 'complete' && !isNext
              return (
                <TouchableOpacity
                  key={row.id}
                  style={styles.numberedRow}
                  activeOpacity={0.75}
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
                </TouchableOpacity>
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
            <Text style={styles.stepTitle}>{t('organizerPayoutSettings.setup.markets.title')}</Text>
            <Text style={styles.stepLead}>{t('organizerPayoutSettings.setup.markets.lead')}</Text>
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
          <Text style={styles.stepTitle}>{t('organizerPayoutSettings.setup.method.title')}</Text>
          <Text style={styles.stepLead}>{t('organizerPayoutSettings.setup.method.lead')}</Text>

          {showHaitiRail ? (
            <>
              <Text style={styles.monoLabel}>{t('organizerPayoutSettings.setup.method.haitiLabel')}</Text>
              <TouchableOpacity
                style={[styles.methodPick, setupMethod === 'moncash' && styles.methodPickOn]}
                activeOpacity={0.85}
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
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.methodPick, setupMethod === 'bank' && styles.methodPickOn]}
                activeOpacity={0.85}
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
              </TouchableOpacity>
            </>
          ) : null}

          {showStripeRail ? (
            <>
              <Text style={[styles.monoLabel, showHaitiRail && { marginTop: 24 }]}>
                {t('organizerPayoutSettings.setup.method.stripeLabel').replace('{countries}', stripeLabel)}
              </Text>
              <TouchableOpacity style={styles.methodPick} activeOpacity={0.85} onPress={handleAddStripe} accessibilityRole="button">
                <View style={styles.methodPickHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodPickTitle}>Stripe</Text>
                    <Text style={styles.methodPickSub}>{t('organizerPayoutSettings.setup.method.stripeSub')}</Text>
                  </View>
                  <Text style={styles.connectLink}>{t('organizerPayoutSettings.setup.method.connect')}</Text>
                </View>
              </TouchableOpacity>
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
          note: t('organizerPayoutSettings.setup.method.addMoreLater'),
        })}
      </>
    )
  }

  const openChangeMethod = (dest: PayoutDestination) => {
    if (!requireIdentity()) return
    if (dest.type === 'moncash') {
      const m = dest as MoncashDestination
      setMoncashForm({ provider: m.provider || 'moncash', accountName: m.accountName || '', phoneNumber: m.phoneNumber || '+509 ' })
      setShowMoncashForm(true)
    } else {
      setBankNameChoice('')
      setShowBankForm(true)
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

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={inHistory ? t('organizerPayoutSettings.payoutHistory.title') : t('organizerPayoutSettings.headerTitle')}
        onBack={() => (inHistory ? setActiveTab('methods') : navigation.goBack())}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {/* First-ever load only. After first paint this branch never shows
            again; background refreshes keep the data on screen. */}
        {loading || (!serverLoaded && !hasAnyMethod) ? (
          <View>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.destinationCard}>
                <View style={styles.destinationHeader}>
                  <Skeleton width={32} height={32} radius={10} />
                  <View style={{ flex: 1, marginLeft: 10, gap: 7 }}>
                    <Skeleton width="52%" height={14} radius={6} />
                    <Skeleton width="38%" height={11} radius={5} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : !inHistory ? (
          <>
            {/* Identity, only while it still needs doing. */}
            {!identityVerified && (
              <TouchableOpacity
                style={styles.setupRow}
                onPress={() => navigation.navigate('OrganizerVerification')}
                accessibilityRole="button"
              >
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
                <View style={styles.setupRowText}>
                  <Text style={styles.setupRowLabel}>{t('organizerPayoutSettings.identityRowLabel')}</Text>
                  <StatusChip
                    status={identitySubmitted ? 'pending' : 'actionneeded'}
                    label={identitySubmitted ? t('organizerPayoutSettings.status.underReview') : t('organizerPayoutSettings.summary.actionNeeded')}
                  />
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            )}

            {/* Where you run events: the saved answer as one row. */}
            <View style={{ marginTop: 8 }}>
              <SectionHeader title={t('organizerPayoutSettings.markets.title')} />
            </View>
            <View style={styles.setupRow}>
              <View style={styles.flagStack}>
                {declaredMarkets.length > 0 ? (
                  declaredMarkets.slice(0, 3).map((code) => <FlagSquare key={code} code={code} size={20} />)
                ) : (
                  <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
                )}
              </View>
              <Text
                style={[styles.setupRowHint, { flex: 1 }, declaredMarkets.length > 0 && styles.setupRowValue]}
                numberOfLines={1}
              >
                {marketsSummary}
              </Text>
              <TouchableOpacity
                onPress={() => setMarketsSheetOpen(true)}
                disabled={!marketsLoaded}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`${t('organizerPayoutSettings.markets.title')}: ${marketsSummary}`}
              >
                <Text style={styles.changeLink}>
                  {declaredMarkets.length > 0
                    ? t('organizerPayoutSettings.markets.change')
                    : t('organizerPayoutSettings.markets.choose')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Cross-border advisory: one connected account, fixed country. */}
            {mismatchedStripeMarkets.length > 0 ? (
              <View style={styles.marketsWarning}>
                <Ionicons name="swap-horizontal-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.marketsWarningText}>
                  {t('organizerPayoutSettings.markets.countryMismatch')
                    .replace('{account}', countryName(connectedAccountCountry))
                    .replace('{markets}', mismatchedStripeMarkets.map((code) => countryName(code)).join(', '))}
                </Text>
              </View>
            ) : null}

            {/* The payout methods, by region: which one an event pays through
                is decided by the event's country, server-side. */}
            {showStripeRail ? (
              <>
                <RegionSection
                  colors={colors}
                  title={t('organizerPayoutSettings.regions.internationalTitle')}
                  blurb={t('organizerPayoutSettings.regions.internationalBlurb')}
                  status={stripeProfile?.connected ? (stripeProfile.verified ? 'ready' : 'pending') : 'none'}
                  t={t}
                />
                {stripeProfile?.connected ? (
                  <View style={styles.destinationCard}>
                    <View style={styles.destinationHeader}>
                      <View style={styles.methodIconTile}>
                        <Ionicons name="globe-outline" size={16} color={colors.text} />
                      </View>
                      <View style={styles.destinationBody}>
                        <Text style={styles.destinationTitle} numberOfLines={1}>{t('organizerPayoutSettings.stripe.title')}</Text>
                        <Text style={styles.destinationSubtitle} numberOfLines={1}>
                          {stripeProfile.country === 'CA'
                            ? t('organizerPayoutSettings.countries.canada')
                            : stripeProfile.country === 'FR'
                              ? t('organizerPayoutSettings.countries.france')
                              : t('organizerPayoutSettings.countries.united_states')}
                        </Text>
                        <View style={styles.destinationStatus}>
                          {stripeProfile.verified ? (
                            <StatusChip status="verified" label={t('organizerPayoutSettings.stripeCard.connected')} />
                          ) : (
                            <StatusChip status="pending" label={t('organizerPayoutSettings.stripeCard.finishSetup')} />
                          )}
                        </View>
                      </View>
                      <TouchableOpacity
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        onPress={() =>
                          startStripeConnect(
                            stripeProfile.country === 'CA' ? 'canada' : stripeProfile.country === 'FR' ? 'france' : 'united_states'
                          )
                        }
                      >
                        <Text style={styles.changeLink}>
                          {stripeProfile.verified ? t('organizerPayoutSettings.summary.manage') : t('organizerPayoutSettings.summary.finish')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.setupRow} onPress={handleAddStripe} accessibilityRole="button">
                    <Text style={[styles.setupRowHint, { flex: 1 }]}>{t('organizerPayoutSettings.regions.emptyInternational')}</Text>
                    <Text style={styles.changeLink}>{t('organizerPayoutSettings.setup.method.connect')}</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : null}

            {showHaitiRail ? (
              <>
                <RegionSection
                  colors={colors}
                  title={t('organizerPayoutSettings.regions.haitiTitle')}
                  blurb={t('organizerPayoutSettings.regions.haitiBlurb')}
                  status={
                    destinations.length === 0
                      ? 'none'
                      : destinations.some((d) => d.verificationStatus === 'verified')
                        ? 'ready'
                        : 'pending'
                  }
                  t={t}
                />
                {destinations.length === 0 ? (
                  <Text style={styles.regionEmpty}>{t('organizerPayoutSettings.regions.emptyHaiti')}</Text>
                ) : null}

                {destinations.map((dest) => {
                  const chip = statusChip(dest.verificationStatus)
                  const isBank = dest.type === 'bank'
                  return (
                    <TouchableOpacity
                      key={dest.id}
                      style={styles.destinationCard}
                      activeOpacity={dest.verificationStatus !== 'verified' ? 0.75 : 1}
                      disabled={dest.verificationStatus === 'verified'}
                      accessibilityRole="button"
                      onPress={() => {
                        setSelectedDestination(dest)
                        if (isBank) {
                          setShowVerificationModal(true)
                        } else if (identityVerified) {
                          showAlert(
                            t('organizerPayoutSettings.moncashVerify.readyTitle'),
                            t('organizerPayoutSettings.moncashVerify.readyBody')
                          )
                        } else {
                          showAlert(t('organizerPayoutSettings.moncashVerify.title'), t('organizerPayoutSettings.moncashVerify.body'), [
                            { text: t('organizerPayoutSettings.moncashVerify.cancel'), style: 'cancel' },
                            {
                              text: t('organizerPayoutSettings.moncashVerify.verifyCta'),
                              onPress: () => navigation.navigate('OrganizerVerification'),
                            },
                          ])
                        }
                      }}
                    >
                      <View style={styles.destinationHeader}>
                        <View style={styles.methodIconTile}>
                          <Ionicons name={isBank ? 'card-outline' : 'phone-portrait-outline'} size={16} color={colors.text} />
                        </View>
                        <View style={styles.destinationBody}>
                          <Text style={styles.destinationTitle} numberOfLines={1}>
                            {isBank ? (dest as BankDestination).bankName : (dest as MoncashDestination).provider === 'natcash' ? 'NatCash' : 'MonCash'}
                            <Text style={styles.destinationDigits}>
                              {'  •••• '}
                              {isBank ? (dest as BankDestination).accountNumberLast4 : (dest as MoncashDestination).phoneNumberLast4}
                            </Text>
                          </Text>
                          <Text style={styles.destinationSubtitle} numberOfLines={1}>
                            {isBank ? (dest as BankDestination).accountName : (dest as MoncashDestination).accountName}
                          </Text>
                          <View style={styles.destinationStatus}>
                            <StatusChip status={chip.status} label={chip.label} />
                          </View>
                        </View>
                        <TouchableOpacity
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityRole="button"
                          onPress={() => openChangeMethod(dest)}
                        >
                          <Text style={styles.changeLink}>{t('organizerPayoutSettings.markets.change')}</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  )
                })}

                {/* Instant MonCash opt-in, under the MonCash method it applies to. */}
                {instantState ? (
                  <View style={styles.instantCard}>
                    <View style={styles.destinationHeader}>
                      <View style={styles.methodIconTile}>
                        <Ionicons name="flash-outline" size={16} color={colors.text} />
                      </View>
                      <View style={styles.destinationBody}>
                        <Text style={styles.destinationTitle}>{t('organizerPayoutSettings.instantMoncash.title')}</Text>
                        <Text style={styles.destinationSubtitle}>
                          {t('organizerPayoutSettings.instantMoncash.feeLine').replace('{fee}', instantFeeLabel)}
                        </Text>
                      </View>
                      {instantState === 'not_yet' ? (
                        <Text style={styles.instantStateLabel}>{t('organizerPayoutSettings.instantMoncash.stateNotYet')}</Text>
                      ) : (
                        <Switch
                          value={allowInstantMoncash}
                          onValueChange={toggleInstantMoncash}
                          disabled={instantState !== 'available' || savingInstant}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          thumbColor={colors.white}
                          ios_backgroundColor={colors.border}
                          accessibilityLabel={t('organizerPayoutSettings.instantMoncash.title')}
                        />
                      )}
                    </View>
                    <Text style={styles.instantBody}>
                      {instantState === 'available'
                        ? t('organizerPayoutSettings.instantMoncash.bodyAvailable').replace('{fee}', instantFeeLabel)
                        : instantState === 'paused'
                          ? t('organizerPayoutSettings.instantMoncash.bodyPaused')
                          : t('organizerPayoutSettings.instantMoncash.bodyNotYet')}
                    </Text>
                    <Text style={styles.instantBody}>{instantMinimumLine}</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {/* Adding a method is its own sub-flow (the sheet below). */}
            <TouchableOpacity style={styles.addMethodRow} onPress={() => setShowAddModal(true)} accessibilityRole="button">
              <Ionicons name="add" size={18} color={colors.text} />
              <Text style={styles.addMethodRowText}>{t('organizerPayoutSettings.addMethodRow')}</Text>
            </TouchableOpacity>

            {/* History is a row now, not a tab. */}
            <TouchableOpacity style={[styles.setupRow, { marginTop: 10 }]} onPress={() => setActiveTab('history')} accessibilityRole="button">
              <Ionicons name="receipt-outline" size={20} color={colors.textSecondary} />
              <View style={styles.setupRowText}>
                <Text style={styles.setupRowLabel}>{t('organizerPayoutSettings.payoutHistory.title')}</Text>
                <Text style={styles.setupRowHint}>{t('organizerPayoutSettings.summary.historySub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>

            {someRailHidden ? (
              <TouchableOpacity onPress={() => setShowAllRails(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ alignSelf: 'center' }}>
                <Text style={styles.marketsShowAll}>{t('organizerPayoutSettings.markets.showAllRails')}</Text>
              </TouchableOpacity>
            ) : null}
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
            <TouchableOpacity style={[styles.secondaryButton, { marginTop: 12 }]} onPress={loadPayouts}>
              <Text style={styles.secondaryButtonText}>{t('organizerPayoutSettings.payoutHistory.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t('organizerPayoutSettings.payoutHistory.emptyTitle')}
            subtitle={t('organizerPayoutSettings.payoutHistory.empty')}
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
                <StatusChip status={meta.tone} label={label} />
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
    fontFamily: font.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.textSecondary,
  },
  stepCancel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
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
    fontFamily: font.mono,
    fontSize: 12,
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
    fontSize: 14,
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
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  monoLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  monoLabelSmall: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 6,
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
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  recommended: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    backgroundColor: 'rgba(20,184,166,0.18)',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
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
    fontSize: 16,
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
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  stepLater: {
    alignSelf: 'center',
    paddingVertical: 14,
  },
  stepLaterText: {
    fontFamily: font.mono,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  // ── Summary ──
  flagStack: {
    flexDirection: 'row',
    gap: 4,
  },
  changeLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  destinationStatus: {
    marginTop: 6,
  },
  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 10,
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
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  metaText: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 14,
  },
  metaHint: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  bulletPoint: {
    color: colors.textSecondary,
    fontSize: 14,
    marginLeft: 8,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  methodGroupHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginTop: 14,
    marginBottom: 8,
  },
  regionEmpty: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingVertical: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  setupRowText: { flex: 1, gap: 2 },
  setupRowLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  setupRowHint: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  setupRowValue: { fontSize: 13, color: colors.text },
  setupRowAction: { fontSize: 13, fontWeight: '600', color: colors.primary },
  instantCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    padding: 13,
    marginBottom: 10,
    gap: 8,
  },
  instantBody: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  instantStateLabel: { fontSize: 11, letterSpacing: 0.4, color: colors.textSecondary },
  addMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
  },
  addMethodRowText: { fontSize: 15, fontWeight: '600', color: colors.text },
  marketsWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    marginBottom: 10,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
  },
  marketsWarningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  marketsShowAll: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  // Every method is one row of the same height: same padding, same content
  // shape, no per-card action to stretch it.
  destinationCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    padding: 13,
    marginBottom: 10,
    justifyContent: 'center',
    minHeight: 68,
  },
  destinationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Compact 32px icon container so the row reads tight (was a bare 24px icon
  // with loose margins).
  methodIconTile: {
    width: 32,
    height: 32,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationBody: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  destinationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  destinationSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  destinationDigits: {
    fontSize: 12,
    color: colors.textTertiary,
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
    fontSize: 14,
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
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: 6,
    marginBottom: 22,
  },
  methodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: colors.surfaceRaised,
    marginBottom: 10,
  },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  methodText: {
    flex: 1,
  },
  methodTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
  methodDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 3,
  },
  label: {
    marginTop: 16,
    marginBottom: 8,
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  input: {
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    fontSize: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  chipTextActive: {
    color: colors.text,
  },
})
