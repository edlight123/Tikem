import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { getVerificationRequest } from '../../lib/verification'
import { useLocaleFormat } from '../../lib/format'
import { RADIUS } from '../../config/brand'
import { radius } from '../../theme/tokens'
import { Skeleton } from '../../components/Skeleton'
import { useAppAlert } from '../../components/AppAlert'
import StatusChip from '../../components/StatusChip'
import SectionHeader from '../../components/SectionHeader'
import EmptyState from '../../components/EmptyState'
import WhitePillCTA from '../../components/WhitePillCTA'
import MoneyText from '../../components/MoneyText'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import SegmentedTabs from '../../components/organizer/SegmentedTabs'
import SelectField from '../../components/organizer/SelectField'
import MarketsSheet from '../../components/organizer/MarketsSheet'
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
  // Stripe Connect (US/CA/FR) live status. `verified` = onboarding fully
  // complete (charges + payouts enabled); otherwise the card prompts to finish.
  const [stripeProfile, setStripeProfile] = useState<{ connected: boolean; verified: boolean; country?: string } | null>(null)
  const [identityVerified, setIdentityVerified] = useState(false)

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

    const combined: PayoutDestination[] = []

    try {
      // Load bank destinations from backend
      const bankRes = await backendFetch('/api/organizer/payout-destinations/bank')
      if (bankRes.ok) {
        const data = await bankRes.json()
        const list = (data?.destinations || []) as BankDestination[]
        combined.push(...list)
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
        const mm = data?.profile?.mobileMoneyDetails
        if (mm && (mm.phoneNumber || mm.accountName)) {
          const phone = String(mm.phoneNumber || '')
          const digits = phone.replace(/\D/g, '')
          const last4 = (digits || phone).slice(-4)
          combined.push({
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

    setDestinations(combined)
    return combined
  }, [user?.uid])

  const loadIdentityStatus = useCallback(async () => {
    if (!user?.uid) return

    try {
      const req = await getVerificationRequest(user.uid)
      setIdentityVerified(req?.status === 'approved')
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
      await Promise.all([loadDestinations(), loadIdentityStatus()])
      serverLoadedRef.current = true
    } finally {
      setLoading(false)
      loadInFlightRef.current = false
    }
  }, [loadDestinations, loadIdentityStatus])

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

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader title={t('organizerPayoutSettings.headerTitle')} onBack={() => navigation.goBack()} />

      <View style={styles.tabsWrap}>
        <SegmentedTabs
          tabs={[
            { key: 'methods', label: t('organizerPayoutSettings.tabs.methods') },
            { key: 'history', label: t('organizerPayoutSettings.tabs.history') },
          ]}
          value={activeTab}
          onChange={(k) => setActiveTab(k as PayoutTab)}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {/* First-ever load only: header + tabs are already painted above; the
            content area shows method-card-shaped skeletons. After first paint
            this branch never shows again — background refreshes keep the data. */}
        {loading ? (
          <View>
            <View style={styles.sectionHeader}>
              <Skeleton width={130} height={12} radius={5} />
              <Skeleton width={64} height={28} radius={10} />
            </View>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.destinationCard}>
                <View style={styles.destinationHeader}>
                  <Skeleton width={32} height={32} radius={10} />
                  <View style={{ flex: 1, marginLeft: 10, gap: 7 }}>
                    <Skeleton width="52%" height={14} radius={6} />
                    <Skeleton width="38%" height={11} radius={5} />
                  </View>
                  <Skeleton width={72} height={11} radius={5} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <>
        {activeTab === 'methods' && (
          <>
        {/*
          SETUP ROWS, not blocks. Identity used to be an info card stacked on a
          full-width white button, and markets an open form — together they
          pushed the actual payout methods off the first screen. Both are
          one-time decisions, so they read as two rows you tap, and the page
          becomes what its title says: your payout methods.
        */}
        {!identityVerified && (
          <TouchableOpacity
            style={styles.setupRow}
            onPress={() => navigation.navigate('OrganizerVerification')}
            accessibilityRole="button"
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
            <View style={styles.setupRowText}>
              <Text style={styles.setupRowLabel}>
                {t('organizerPayoutSettings.identityRowLabel')}
              </Text>
              <Text style={styles.setupRowHint} numberOfLines={2}>
                {t('organizerPayoutSettings.identityNotice')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        {/* Where you run events. Nothing used to ask, so every organizer was
            shown every rail — a Port-au-Prince organizer was offered Stripe
            Connect they will never use, and a diaspora organizer got no signal
            that Haiti and the US are TWO setups. Answering is optional and
            re-editable; it changes what is OFFERED, never what is allowed.

            A SAVED ANSWER, NOT A FORM. Feedback, repeatedly: "this should be
            something the organizer edit and saved ... not display all the
            countries like that, out in the open." So the page only ever shows
            the answer — one row — and the full country list lives in a sheet
            behind Change, where picking is a draft until Save. Nothing on this
            page lays out every country inline any more, in any state. */}
        <TouchableOpacity
          style={styles.setupRow}
          onPress={() => setMarketsSheetOpen(true)}
          disabled={!marketsLoaded}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`${t('organizerPayoutSettings.markets.title')}: ${marketsSummary}`}
        >
          <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
          <View style={styles.setupRowText}>
            <Text style={styles.setupRowLabel}>{t('organizerPayoutSettings.markets.title')}</Text>
            <Text
              style={[styles.setupRowHint, declaredMarkets.length > 0 && styles.setupRowValue]}
              numberOfLines={1}
            >
              {marketsSummary}
            </Text>
          </View>
          <Text style={styles.setupRowAction}>
            {declaredMarkets.length > 0
              ? t('organizerPayoutSettings.markets.change')
              : t('organizerPayoutSettings.markets.choose')}
          </Text>
        </TouchableOpacity>

        {/* Cross-border advisory: one connected account, fixed country. It
            stays on the page (not in the sheet) because it needs action. */}
        {mismatchedStripeMarkets.length > 0 ? (
          <View style={styles.marketsWarning}>
            <Ionicons name="swap-horizontal-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.marketsWarningText}>
              {t('organizerPayoutSettings.markets.countryMismatch')
                .replace('{account}', countryName(connectedAccountCountry))
                .replace(
                  '{markets}',
                  mismatchedStripeMarkets.map((code) => countryName(code)).join(', ')
                )}
            </Text>
          </View>
        ) : null}

        <View style={{ height: 10 }} />

        {/* Destinations List */}
        {destinations.length === 0 && !stripeProfile?.connected ? (
          <EmptyState
            icon={Wallet}
            title={t('organizerPayoutSettings.emptyMethods.title')}
            subtitle={t('organizerPayoutSettings.emptyMethods.subtitle')}
            actionLabel={t('organizerPayoutSettings.emptyMethods.action')}
            onAction={() => setShowAddModal(true)}
          />
        ) : (
          <>
            {/* The region headings below already say what this list is; a
                third "PAYOUT METHODS" label above them was chrome. Adding a
                method now sits at the END of the list, where you look once you
                have read what you already have. */}

            {/* Two payout REGIONS, not one flat list. Which one an event pays
                through is decided by the event's country
                (getRequiredPayoutProfileIdForEventCountry, enforced server-side
                at publish and withdrawal), so the organizer needs to see that
                split — and who verifies them on each side — before they build
                an event they can't get paid for. */}
            {showStripeRail ? (
            <>
            <RegionSection
              colors={colors}
              title={t('organizerPayoutSettings.regions.internationalTitle')}
              blurb={t('organizerPayoutSettings.regions.internationalBlurb')}
              status={
                stripeProfile?.connected ? (stripeProfile.verified ? 'ready' : 'pending') : 'none'
              }
              t={t}
            />

            {stripeProfile?.connected ? (
              // THE CARD IS THE BUTTON. Inline per-card actions (Manage on
              // Stripe, View Status) made cards different heights depending on
              // which actions applied, and left the card itself dead to touch.
              <TouchableOpacity
                style={styles.destinationCard}
                activeOpacity={0.75}
                accessibilityRole="button"
                onPress={() =>
                  startStripeConnect(
                    stripeProfile.country === 'CA'
                      ? 'canada'
                      : stripeProfile.country === 'FR'
                        ? 'france'
                        : 'united_states'
                  )
                }
              >
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
                          : t('organizerPayoutSettings.countries.united_states')}{' · '}{t('organizerPayoutSettings.stripeCard.cardPayouts')}
                    </Text>
                  </View>
                  {stripeProfile.verified ? (
                    <StatusChip status="verified" label={t('organizerPayoutSettings.stripeCard.connected')} />
                  ) : (
                    <StatusChip status="pending" label={t('organizerPayoutSettings.stripeCard.finishSetup')} />
                  )}
                </View>
              </TouchableOpacity>
            ) : (
              <Text style={styles.regionEmpty}>
                {t('organizerPayoutSettings.regions.emptyInternational')}
              </Text>
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
                      // MonCash activates on identity verification alone; payouts
                      // are then reviewed and released manually by our team.
                      showAlert(
                        t('organizerPayoutSettings.moncashVerify.readyTitle'),
                        t('organizerPayoutSettings.moncashVerify.readyBody')
                      )
                    } else {
                      showAlert(
                        t('organizerPayoutSettings.moncashVerify.title'),
                        t('organizerPayoutSettings.moncashVerify.body'),
                        [
                          { text: t('organizerPayoutSettings.moncashVerify.cancel'), style: 'cancel' },
                          {
                            text: t('organizerPayoutSettings.moncashVerify.verifyCta'),
                            onPress: () => navigation.navigate('OrganizerVerification'),
                          },
                        ]
                      )
                    }
                  }}
                >
                  <View style={styles.destinationHeader}>
                    <View style={styles.methodIconTile}>
                      <Ionicons
                        name={isBank ? 'card-outline' : 'phone-portrait-outline'}
                        size={16}
                        color={colors.text}
                      />
                    </View>
                    <View style={styles.destinationBody}>
                      <Text style={styles.destinationTitle} numberOfLines={1}>
                        {isBank ? (dest as BankDestination).bankName : (dest as MoncashDestination).provider}
                      </Text>
                      <Text style={styles.destinationSubtitle} numberOfLines={1}>
                        {isBank ? (dest as BankDestination).accountName : (dest as MoncashDestination).accountName}
                        <Text style={styles.destinationDigits}>
                          {'   •••• '}
                          {isBank
                            ? (dest as BankDestination).accountNumberLast4
                            : (dest as MoncashDestination).phoneNumberLast4}
                        </Text>
                      </Text>
                    </View>
                    <StatusChip status={chip.status} label={chip.label} />
                  </View>

                </TouchableOpacity>
              )
            })}
            </>
            ) : null}

            {/* Add sits at the END: you look for it after reading what you
                already have, and it no longer competes with the section
                headings for the top of the screen. */}
            <TouchableOpacity
              style={styles.addMethodRow}
              onPress={() => setShowAddModal(true)}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={colors.text} />
              <Text style={styles.addMethodRowText}>
                {t('organizerPayoutSettings.addMethodRow')}
              </Text>
            </TouchableOpacity>

            {/* A declaration narrows what is shown; it must never lock anyone
                out of a rail. The escape hatch sits after the list it widens. */}
            {someRailHidden ? (
              <TouchableOpacity
                onPress={() => setShowAllRails(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ alignSelf: 'center' }}
              >
                <Text style={styles.marketsShowAll}>
                  {t('organizerPayoutSettings.markets.showAllRails')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
          </>
        )}

        {activeTab === 'history' && (
          payoutsLoading && !refreshing ? (
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
              const label = meta.labelKey
                ? t(`organizerPayoutSettings.payoutHistory.status.${meta.labelKey}`)
                : p.status
              return (
                <View key={p.id} style={styles.payoutRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <MoneyText
                      cents={p.amount}
                      currency={(p.currency as any) || 'HTG'}
                      style={styles.payoutAmount}
                    />
                    <Text style={styles.payoutMeta} numberOfLines={1}>
                      {[payoutMethodLabel(p.method), formatDate(p.createdAt)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <StatusChip status={meta.tone} label={label} />
                </View>
              )
            })
          )
        )}
          </>
        )}
      </ScrollView>

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
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabsWrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    paddingTop: 4,
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
