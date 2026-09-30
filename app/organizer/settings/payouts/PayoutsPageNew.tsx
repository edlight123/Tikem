'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, AlertCircle, CheckCircle, Clock, Ban, ArrowLeft, Globe, Wallet } from 'lucide-react'
import Link from 'next/link'
import { StatusChip, Chip, type ChipTone } from '@/components/ui/kit'
// Direct path, not the '@/components/organizer/ui' barrel: the barrel drags in
// the whole organizer table/drawer set for one heading.
import { SectionHeader } from '@/components/organizer/ui/PageHeader'
import { updatePayoutProfileConfig } from './actions'
import { useRouter } from 'next/navigation'
import DeclaredMarketsCard from '@/components/organizer/payouts/DeclaredMarketsCard'
import { normalizeDeclaredMarkets, shouldShowRail } from '@/lib/organizer-markets'
import { MONCASH_MIN_WITHDRAWAL_HTG_CENTS } from '@/lib/payouts/moncash-withdrawal-minimum'

// The MonCash floor enforced by /api/organizer/withdraw-moncash, and the English
// fallback for the instant-payouts explainer (localized in organizer.json).
const MONCASH_MIN_LABEL = `${(MONCASH_MIN_WITHDRAWAL_HTG_CENTS / 100).toLocaleString('en-US')} HTG`
const INSTANT_MONCASH_DESC_FALLBACK =
  "On: MonCash withdrawals land within minutes for a 3% fee, whenever platform prefunding is available. Off (or while it is unavailable): every withdrawal goes to manual review by our team first, usually within 24 hours, with no instant fee. Minimum MonCash withdrawal: {{min}} (for a USD event, the USD equivalent at that day's rate)."

// Feature flag: launching MonCash-only — NatCash hidden as a provider choice
// for new payout methods (saved NatCash configs still display). Mirrors the
// NATCASH_ENABLED flags in BuyTicketButton and the mobile app.
const NATCASH_ENABLED = false

type BankDestination = {
  id: string
  bankName: string
  accountName: string
  accountNumberLast4: string
  isPrimary: boolean
  verificationStatus?: 'pending' | 'verified' | 'failed'
  verificationSubmittedAt?: string | null
}

// Types
interface PayoutConfig {
  status?: 'not_setup' | 'pending_verification' | 'active' | 'on_hold'
  accountLocation?: string
  payoutProvider?: 'stripe_connect' | 'moncash' | 'natcash' | 'bank_transfer'
  stripeAccountId?: string
  allowInstantMoncash?: boolean
  method?: 'bank_transfer' | 'mobile_money'
  bankDetails?: {
    accountLocation?: string
    accountName: string
    accountNumber: string
    bankName: string
    routingNumber?: string
    swift?: string
    iban?: string
    accountNumberLast4?: string
  }
  mobileMoneyDetails?: {
    provider: string
    phoneNumber: string
    accountName: string
    phoneNumberLast4?: string
  }
  verificationStatus?: {
    identity?: 'pending' | 'verified' | 'failed'
    bank?: 'pending' | 'verified' | 'failed'
    phone?: 'pending' | 'verified' | 'failed'
  }
}

interface EventPayoutSummary {
  eventId: string
  name: string
  date: string
  ticketsSold: number
  grossSales: number
  fees: number
  netPayout: number
  currency?: 'HTG' | 'USD' | string
  payoutStatus: 'pending' | 'scheduled' | 'paid' | 'on_hold'
}

interface PayoutsPageProps {
  haitiConfig?: PayoutConfig
  stripeConfig?: PayoutConfig
  eventSummaries?: EventPayoutSummary[]
  upcomingPayout?: {
    amount: number
    currency: string
    date: string
    eventCount: number
  }
  organizerId: string
  organizerDefaultCountry?: string
  /** Countries the organizer says they run events in. UI hint only — see
   *  lib/organizer-markets.ts. Empty/undeclared shows every rail. */
  declaredMarkets?: string[]
  initialActiveProfile?: 'haiti' | 'stripe_connect'
}

export default function PayoutsPageNew({
  haitiConfig,
  stripeConfig,
  eventSummaries,
  upcomingPayout,
  organizerId,
  organizerDefaultCountry,
  declaredMarkets,
  initialActiveProfile,
}: PayoutsPageProps) {
  const router = useRouter()
  const { t } = useTranslation('organizer')

  const normalizedEventSummaries = Array.isArray(eventSummaries) ? eventSummaries : []

  const normalizedOrganizerCountry = String(organizerDefaultCountry || '').toUpperCase()

  // Declared markets — what the organizer told us about where they run events.
  // A HINT for what to show, never an authorisation: `shouldShowRail` returns
  // true for everything when nothing has been declared, and the "show every
  // payout method" escape hatch below can always reveal a hidden rail.
  const normalizedMarkets = normalizeDeclaredMarkets(declaredMarkets)
  const needsHaitiRail = shouldShowRail('haiti', normalizedMarkets)
  const needsStripeRail = shouldShowRail('stripe_connect', normalizedMarkets)
  // Arriving to edit ONE profile (?edit=… or the Stripe return) is an explicit
  // request for that rail — it outranks any declaration.
  const [showAllRails, setShowAllRails] = useState(Boolean(initialActiveProfile))
  // A rail the organizer didn't declare but HAS already configured stays
  // visible — hiding a live payout method would be a lie about their account.
  const showHaitiRail = needsHaitiRail || showAllRails || Boolean(haitiConfig)
  const showStripeRail = needsStripeRail || showAllRails || Boolean(stripeConfig)
  const railIsHidden = !showHaitiRail || !showStripeRail

  const primaryProfile: 'haiti' | 'stripe_connect' = (() => {
    // If only one profile exists, it should be the default.
    if (haitiConfig && !stripeConfig) return 'haiti'
    if (stripeConfig && !haitiConfig) return 'stripe_connect'

    // Otherwise lead with a DECLARED market's rail — the organizer has said
    // outright where they run events, which beats any inference.
    if (needsStripeRail && !needsHaitiRail) return 'stripe_connect'
    if (needsHaitiRail && !needsStripeRail) return 'haiti'

    // Nothing declared (or both declared): fall back to the stated country.
    if (normalizedOrganizerCountry === 'US' || normalizedOrganizerCountry === 'CA') return 'stripe_connect'
    return 'haiti'
  })()

  const [activeProfile, setActiveProfile] = useState<'haiti' | 'stripe_connect'>(() => {
    if (initialActiveProfile) return initialActiveProfile
    return primaryProfile
  })

  const [showAdditionalProfiles, setShowAdditionalProfiles] = useState(() => {
    // Show both profiles by default if both are configured, or if the organizer
    // declared markets on both rails — "Haiti + US" means two setups, and the
    // switcher is how they get to the second one.
    if (needsHaitiRail && needsStripeRail && normalizedMarkets.length > 0) return true
    return Boolean(haitiConfig && stripeConfig)
  })

  // Never strand the organizer on a rail the page has stopped showing.
  useEffect(() => {
    if (activeProfile === 'haiti' && !showHaitiRail) setActiveProfile('stripe_connect')
    else if (activeProfile === 'stripe_connect' && !showStripeRail) setActiveProfile('haiti')
  }, [activeProfile, showHaitiRail, showStripeRail])

  const config = activeProfile === 'haiti' ? haitiConfig : stripeConfig

  // When the organizer arrives to edit one specific profile (?edit=haiti / ?edit=stripe_connect
  // or the Stripe return flow), focus the page on that profile instead of the confusing
  // Haiti vs US/Canada switcher.
  const isFocusedEdit = Boolean(initialActiveProfile)
  const focusedProfileLabel = activeProfile === 'stripe_connect' ? t('payouts_page.profile_us_canada', { defaultValue: 'US & Canada' }) : t('payouts_page.country_haiti', { defaultValue: 'Haiti' })

  const [isEditing, setIsEditing] = useState(!config)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payoutChangeVerificationRequired, setPayoutChangeVerificationRequired] = useState(false)
  const [payoutChangeCode, setPayoutChangeCode] = useState('')
  const [payoutChangeMessage, setPayoutChangeMessage] = useState<string | null>(null)
  const [isSendingPayoutChangeCode, setIsSendingPayoutChangeCode] = useState(false)
  const [isVerifyingPayoutChangeCode, setIsVerifyingPayoutChangeCode] = useState(false)
  const [pendingSensitiveUpdate, setPendingSensitiveUpdate] = useState<
    | { kind: 'profile_update'; updates: any }
    | { kind: 'add_bank_destination'; bankDetails: any }
    | null
  >(null)
  const [period, setPeriod] = useState<'this_month' | 'last_3_months' | 'all_time'>('all_time')
  const [isSendingPhoneCode, setIsSendingPhoneCode] = useState(false)
  const [isSubmittingPhoneCode, setIsSubmittingPhoneCode] = useState(false)
  const [phoneVerificationCode, setPhoneVerificationCode] = useState('')
  const [phoneVerificationMessage, setPhoneVerificationMessage] = useState<string | null>(null)
  const [bankVerificationType, setBankVerificationType] = useState<'bank_statement' | 'void_check' | 'utility_bill'>('bank_statement')
  const [bankVerificationFile, setBankVerificationFile] = useState<File | null>(null)
  const [isSubmittingBankVerification, setIsSubmittingBankVerification] = useState(false)
  const [bankVerificationMessage, setBankVerificationMessage] = useState<string | null>(null)

  const [bankDestinations, setBankDestinations] = useState<BankDestination[] | null>(null)
  const [isLoadingBankDestinations, setIsLoadingBankDestinations] = useState(false)
  const [bankDestinationsError, setBankDestinationsError] = useState<string | null>(null)
  const [selectedBankDestinationId, setSelectedBankDestinationId] = useState<string>('')

  const [showAddBankDestination, setShowAddBankDestination] = useState(false)
  const [isAddingBankDestination, setIsAddingBankDestination] = useState(false)
  const [addBankDestinationMessage, setAddBankDestinationMessage] = useState<string | null>(null)
  const [newBankDestination, setNewBankDestination] = useState({
    bankName: '',
    customBankName: '',
    accountNumber: '',
    accountHolder: '',
    routingNumber: '',
    swiftCode: '',
  })
  const [stripeStatus, setStripeStatus] = useState<any | null>(null)
  const [stripeStatusError, setStripeStatusError] = useState<string | null>(null)
  const [isLoadingStripeStatus, setIsLoadingStripeStatus] = useState(false)
  const [prefunding, setPrefunding] = useState<{ enabled: boolean; available: boolean } | null>(null)
  const [prefundingError, setPrefundingError] = useState<string | null>(null)
  const [isChangingMobileNumber, setIsChangingMobileNumber] = useState(false)
  const [editStep, setEditStep] = useState<'method' | 'verify' | 'done'>('method')
  const [formData, setFormData] = useState(() => ({
    accountLocation:
      activeProfile === 'stripe_connect'
        ? (stripeConfig?.accountLocation || 'united_states')
        : (haitiConfig?.accountLocation || haitiConfig?.bankDetails?.accountLocation || 'haiti'),
    method: config?.method || (activeProfile === 'stripe_connect' ? 'bank_transfer' : 'bank_transfer'),
    bankName: config?.bankDetails?.bankName || 'unibank',
    customBankName: '',
    routingNumber: config?.bankDetails?.routingNumber || '',
    accountName: config?.bankDetails?.accountName || '',
    accountNumber: '',
    swift: config?.bankDetails?.swift || '',
    iban: config?.bankDetails?.iban || '',
    provider: config?.mobileMoneyDetails?.provider || 'moncash',
    phoneNumber: ''
  }))

  const hasPayoutSetup = Boolean(config)
  // Organizer identity verification is shared across profiles (internal KYC).
  const organizerIdentityStatus = haitiConfig?.verificationStatus?.identity || 'pending'
  const identityStatus = config?.verificationStatus?.identity || organizerIdentityStatus
  const bankStatus = config?.verificationStatus?.bank || 'pending'
  const phoneStatus = config?.verificationStatus?.phone || 'pending'

  useEffect(() => {
    setIsEditing(!config)
    setError(null)
    setPayoutChangeVerificationRequired(false)
    setPayoutChangeCode('')
    setPayoutChangeMessage(null)
    setPendingSensitiveUpdate(null)

    setBankVerificationFile(null)
    setBankVerificationMessage(null)
    setAddBankDestinationMessage(null)
    setShowAddBankDestination(false)
    setIsChangingMobileNumber(false)

    setFormData({
      accountLocation:
        activeProfile === 'stripe_connect'
          ? (stripeConfig?.accountLocation || 'united_states')
          : (haitiConfig?.accountLocation || haitiConfig?.bankDetails?.accountLocation || 'haiti'),
      method: config?.method || (activeProfile === 'stripe_connect' ? 'bank_transfer' : 'bank_transfer'),
      bankName: config?.bankDetails?.bankName || 'unibank',
      customBankName: '',
      routingNumber: config?.bankDetails?.routingNumber || '',
      accountName: config?.bankDetails?.accountName || '',
      // Never prefill sensitive values.
      accountNumber: '',
      swift: config?.bankDetails?.swift || '',
      iban: config?.bankDetails?.iban || '',
      provider: config?.mobileMoneyDetails?.provider || 'moncash',
      phoneNumber: '',
    })
    // Note: stripeConfig and haitiConfig are intentionally excluded to prevent infinite loops
    // as they're derived from activeProfile which is already in dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, config])

  useEffect(() => {
    if (!payoutChangeVerificationRequired) return
    // Make sure the step-up prompt is visible even when not editing.
    const el = document.getElementById('payout-change-stepup')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [payoutChangeVerificationRequired])

  const effectiveAccountLocation = (isEditing
    ? formData.accountLocation
    : (config?.accountLocation || config?.bankDetails?.accountLocation || formData.accountLocation))

  const isHaiti = activeProfile === 'haiti'
  const selectedProvider = String((isEditing ? formData.provider : config?.mobileMoneyDetails?.provider) || formData.provider || '').toLowerCase()

  const isStripeConnectSelection =
    activeProfile === 'stripe_connect' ||
    String(effectiveAccountLocation || '').toLowerCase() === 'united_states' ||
    String(effectiveAccountLocation || '').toLowerCase() === 'canada'

  const isStripeConnectAccount =
    activeProfile === 'stripe_connect' ||
    isStripeConnectSelection || String(config?.payoutProvider || '').toLowerCase() === 'stripe_connect'

  const formatLocationLabel = (raw: string | null | undefined) => {
    const value = String(raw || '').trim()
    if (!value) return t('payouts_page.location_not_set', { defaultValue: 'Not set' })
    if (value.toLowerCase() === 'united_states') return t('payouts_page.country_united_states', { defaultValue: 'United States' })
    if (value.toLowerCase() === 'canada') return t('payouts_page.country_canada', { defaultValue: 'Canada' })
    if (value.toLowerCase() === 'haiti') return t('payouts_page.country_haiti', { defaultValue: 'Haiti' })
    return value.replace(/_/g, ' ')
  }

  useEffect(() => {
    let cancelled = false

    const loadStripe = async () => {
      if (activeProfile !== 'stripe_connect') return
      setIsLoadingStripeStatus(true)
      setStripeStatusError(null)
      try {
        const res = await fetch('/api/organizer/stripe/status', { cache: 'no-store' as any })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || data?.message || t('payouts_page.error_stripe_status', { defaultValue: 'Failed to load Stripe status' }))
        if (!cancelled) setStripeStatus(data)
      } catch (e: any) {
        if (!cancelled) setStripeStatusError(e?.message || t('payouts_page.error_stripe_status', { defaultValue: 'Failed to load Stripe status' }))
      } finally {
        if (!cancelled) setIsLoadingStripeStatus(false)
      }
    }

    const loadPrefunding = async () => {
      if (activeProfile !== 'haiti') return
      setPrefundingError(null)
      try {
        const res = await fetch('/api/organizer/payout-prefunding-status', { cache: 'no-store' as any })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || data?.message || t('payouts_page.error_prefunding_status', { defaultValue: 'Failed to load prefunding status' }))
        if (!cancelled) setPrefunding(data?.prefunding || { enabled: false, available: false })
      } catch (e: any) {
        if (!cancelled) setPrefundingError(e?.message || t('payouts_page.error_prefunding_status', { defaultValue: 'Failed to load prefunding status' }))
      }
    }

    void loadStripe()
    void loadPrefunding()

    return () => {
      cancelled = true
    }
  }, [activeProfile])

  useEffect(() => {
    let cancelled = false

    const loadBankDestinations = async () => {
      if (activeProfile !== 'haiti') return
      const effectiveMethod = String((isEditing ? formData.method : config?.method) || '').toLowerCase()
      if (effectiveMethod !== 'bank_transfer') return

      setIsLoadingBankDestinations(true)
      setBankDestinationsError(null)
      try {
        const res = await fetch('/api/organizer/payout-destinations/bank', { cache: 'no-store' as any })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || data?.message || t('payouts_page.error_load_banks', { defaultValue: 'Failed to load bank accounts' }))
        const destinations = (Array.isArray(data?.destinations) ? data.destinations : []) as BankDestination[]
        if (cancelled) return
        setBankDestinations(destinations)

        const stillExists = selectedBankDestinationId && destinations.some((d) => d.id === selectedBankDestinationId)
        if (!stillExists) {
          const primary = destinations.find((d) => d.isPrimary)
          setSelectedBankDestinationId(primary?.id || destinations[0]?.id || '')
        }
      } catch (e: any) {
        if (cancelled) return
        setBankDestinations(null)
        setBankDestinationsError(e?.message || t('payouts_page.error_load_banks', { defaultValue: 'Failed to load bank accounts' }))
        setSelectedBankDestinationId('')
      } finally {
        if (!cancelled) setIsLoadingBankDestinations(false)
      }
    }

    void loadBankDestinations()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, config?.method, isEditing, formData.method])

  const normalizeHaitiPhone = (raw: string) => {
    const compact = String(raw || '').replace(/[\s\-()]/g, '')
    if (!compact) return ''
    if (compact.startsWith('+')) return compact
    if (compact.startsWith('509')) return `+${compact}`
    return compact
  }

  const isValidHaitiPhone = (raw: string) => {
    const phone = normalizeHaitiPhone(raw)
    return /^\+509\d{8}$/.test(phone)
  }

  const getStripeBadge = (): { label: string; tone: ChipTone } => {
    const status = String(stripeStatus?.status || '')
    if (status === 'verified') return { label: t('payouts_page.status_verified', { defaultValue: 'Verified' }), tone: 'success' }
    if (status === 'requires_more_info') return { label: t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' }), tone: 'danger' }
    if (status === 'incomplete') return { label: t('payouts_page.status_incomplete', { defaultValue: 'Incomplete' }), tone: 'warning' }
    if (status === 'in_review') return { label: t('payouts_page.status_in_review', { defaultValue: 'In review' }), tone: 'warning' }
    return { label: t('payouts_page.status_not_connected', { defaultValue: 'Not connected' }), tone: 'neutral' }
  }

  const startStripeOnboarding = async () => {
    setError(null)
    try {
      const res = await fetch('/api/organizer/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountLocation: String(effectiveAccountLocation || '').toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || data?.message || t('payouts_page.error_stripe_onboarding', { defaultValue: 'Failed to start Stripe onboarding' }))
      if (data?.url) {
        window.location.href = data.url
        return
      }
      throw new Error(t('payouts_page.error_stripe_url_missing', { defaultValue: 'Stripe onboarding URL missing' }))
    } catch (e: any) {
      setError(e?.message || t('payouts_page.error_stripe_onboarding', { defaultValue: 'Failed to start Stripe onboarding' }))
    }
  }

  const openStripeDashboard = async () => {
    setError(null)
    try {
      const res = await fetch('/api/organizer/stripe/login-link', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || data?.message || t('payouts_page.error_stripe_dashboard', { defaultValue: 'Failed to open Stripe dashboard' }))
      if (data?.url) {
        window.location.href = data.url
        return
      }
      throw new Error(t('payouts_page.error_stripe_dashboard_url_missing', { defaultValue: 'Stripe dashboard URL missing' }))
    } catch (e: any) {
      setError(e?.message || t('payouts_page.error_stripe_dashboard', { defaultValue: 'Failed to open Stripe dashboard' }))
    }
  }

  const statusIcon = (status: 'pending' | 'verified' | 'failed') => {
    if (status === 'verified') return <CheckCircle className="w-4 h-4 text-emerald-300" />
    if (status === 'failed') return <AlertCircle className="w-4 h-4 text-red-300" />
    return <Clock className="w-4 h-4 text-amber-300" />
  }

  // List of supported banks
  const banks = [
    { value: 'unibank', label: 'Unibank' },
    { value: 'sogebank', label: 'Sogebank' },
    { value: 'bnc', label: 'BNC (Banque Nationale de Crédit)' },
    { value: 'capital_bank', label: 'Capital Bank' },
    { value: 'citibank', label: 'Citibank Haiti' },
    { value: 'scotiabank', label: 'Scotiabank' },
    { value: 'other', label: t('payouts_page.bank_other', { defaultValue: 'Other (add my bank)' }) }
  ]

  const handleSavePayoutDetails = async (onSuccess?: () => void) => {
    setIsSaving(true)
    setError(null)
    setPayoutChangeMessage(null)

    const normalizedLocation = String(formData.accountLocation || '').toLowerCase()
    const wantsStripeConnect = normalizedLocation === 'united_states' || normalizedLocation === 'canada'
    
    // Stripe Connect profile: redirect to Stripe onboarding instead of collecting bank fields here.
    if (activeProfile === 'stripe_connect') {
      try {
        if (!wantsStripeConnect) {
          setError(t('payouts_page.error_stripe_country', { defaultValue: 'Stripe Connect is only available for United States or Canada accounts' }))
          setIsSaving(false)
          return
        }

        const stripeSetupUpdate = {
          accountLocation: normalizedLocation,
          payoutProvider: 'stripe_connect',
          method: 'bank_transfer',
        }
        const updateResult = await updatePayoutProfileConfig('stripe_connect', stripeSetupUpdate as any)
        if (!updateResult?.success) {
          if (updateResult?.requiresVerification) {
            setPendingSensitiveUpdate({ kind: 'profile_update', updates: stripeSetupUpdate })
            setPayoutChangeVerificationRequired(true)
            setPayoutChangeMessage(t('payouts_page.stepup_msg_profile', { defaultValue: 'For your security, confirm this payout change with the code we email you.' }))
            setIsSaving(false)
            return
          }
          throw new Error(updateResult?.error || t('payouts_page.error_save_failed', { defaultValue: 'Failed to save payout details. Please try again.' }))
        }

        const res = await fetch('/api/organizer/stripe/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountLocation: normalizedLocation }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || data?.message || t('payouts_page.error_stripe_onboarding', { defaultValue: 'Failed to start Stripe onboarding' }))
        }
        if (data?.url) {
          window.location.href = data.url
          return
        }
        throw new Error(t('payouts_page.error_stripe_url_missing', { defaultValue: 'Stripe onboarding URL missing' }))
      } catch (err: any) {
        setError(err?.message || t('payouts_page.error_stripe_onboarding', { defaultValue: 'Failed to start Stripe onboarding' }))
        setIsSaving(false)
        return
      }
    }

    if (formData.method === 'bank_transfer') {
      if (!formData.accountLocation) {
        setError(t('payouts_page.error_select_location', { defaultValue: 'Please select an account location' }))
        setIsSaving(false)
        return
      }

      // Haiti bank transfers use saved bank accounts (payout destinations) instead of re-entering details.
      if (activeProfile === 'haiti') {
        const destinations = bankDestinations || []
        const selected = destinations.find((d) => d.id === selectedBankDestinationId) || null
        if (!selected) {
          setError(t('payouts_page.error_add_bank_first', { defaultValue: 'Please add a bank account first, then select it.' }))
          setIsSaving(false)
          const verifyEl = document.getElementById('verify-payouts')
          if (verifyEl) verifyEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
      } else {
        if (!formData.bankName) {
          setError(t('payouts_page.error_select_bank', { defaultValue: 'Please select a bank' }))
          setIsSaving(false)
          return
        }
        if (formData.bankName === 'other' && !formData.customBankName.trim()) {
          setError(t('payouts_page.error_enter_bank_name', { defaultValue: 'Please enter your bank name' }))
          setIsSaving(false)
          return
        }
        if (!formData.routingNumber.trim()) {
          setError(t('payouts_page.error_enter_routing', { defaultValue: 'Please enter a routing number' }))
          setIsSaving(false)
          return
        }
        if (!formData.accountNumber.trim()) {
          setError(t('payouts_page.error_enter_account_number', { defaultValue: 'Please enter an account number' }))
          setIsSaving(false)
          return
        }
        if (!formData.accountName.trim()) {
          setError(t('payouts_page.error_enter_account_holder', { defaultValue: 'Please enter the account holder name' }))
          setIsSaving(false)
          return
        }
      }
    }
    if (formData.method === 'mobile_money') {
      const hasSavedPhone = Boolean(config?.mobileMoneyDetails?.phoneNumberLast4)
      const needsNewPhone = activeProfile === 'haiti' ? (isChangingMobileNumber || !hasSavedPhone) : true
      if (needsNewPhone && !formData.phoneNumber.trim()) {
        setError(t('payouts_page.error_enter_phone', { defaultValue: 'Please enter a phone number' }))
        setIsSaving(false)
        return
      }

      if (needsNewPhone && isHaiti && !isValidHaitiPhone(formData.phoneNumber)) {
        setError(t('payouts_page.error_invalid_haiti_phone', { defaultValue: 'Please enter a valid Haiti phone number (example: +50912345678)' }))
        setIsSaving(false)
        return
      }
    }
    
    try {
      const updates: any = {
        accountLocation: normalizedLocation,
        method: formData.method as 'bank_transfer' | 'mobile_money'
      }

      if (formData.method === 'bank_transfer') {
        if (activeProfile !== 'haiti') {
          const finalBankName = formData.bankName === 'other' ? formData.customBankName : formData.bankName

          updates.bankDetails = {
            accountLocation: formData.accountLocation,
            bankName: finalBankName,
            routingNumber: formData.routingNumber,
            accountName: formData.accountName,
            accountNumber: formData.accountNumber,
            swift: formData.swift || null,
            iban: formData.iban || null,
          }
        }
      } else {
        const hasSavedPhone = Boolean(config?.mobileMoneyDetails?.phoneNumberLast4)
        const needsNewPhone = activeProfile === 'haiti' ? (isChangingMobileNumber || !hasSavedPhone) : true

        updates.mobileMoneyDetails = {
          provider: formData.provider,
        }

        if (needsNewPhone) {
          updates.mobileMoneyDetails.phoneNumber = isHaiti ? normalizeHaitiPhone(formData.phoneNumber) : formData.phoneNumber
          updates.mobileMoneyDetails.accountName = formData.accountName || formData.phoneNumber
        }

        updates.payoutProvider = String(formData.provider || '').toLowerCase() === 'natcash' ? 'natcash' : 'moncash'
      }

      const result = await updatePayoutProfileConfig(activeProfile as any, updates)
      if (!result?.success) {
        if (result?.requiresVerification) {
          setPendingSensitiveUpdate({ kind: 'profile_update', updates })
          setPayoutChangeVerificationRequired(true)
          setPayoutChangeMessage(t('payouts_page.stepup_msg_profile', { defaultValue: 'For your security, confirm this payout change with the code we email you.' }))
          setIsSaving(false)
          return
        }
        throw new Error(result?.error || t('payouts_page.error_save_failed', { defaultValue: 'Failed to save payout details. Please try again.' }))
      }

      setIsEditing(false)
      setIsChangingMobileNumber(false)
      setPayoutChangeVerificationRequired(false)
      setPendingSensitiveUpdate(null)
      setPayoutChangeCode('')
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setError(t('payouts_page.error_save_failed', { defaultValue: 'Failed to save payout details. Please try again.' }))
      console.error('Error saving payout details:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const sendPayoutChangeEmailCode = async () => {
    setPayoutChangeMessage(null)
    setError(null)
    setIsSendingPayoutChangeCode(true)
    try {
      const res = await fetch('/api/organizer/payout-details-change/send-email-code', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || t('payouts_page.error_send_code', { defaultValue: 'Failed to send code' }))

      const devCode = data?.debugCode
      if (process.env.NODE_ENV === 'development' && devCode) {
        setPayoutChangeMessage(t('payouts_page.code_sent_dev', { code: devCode, defaultValue: 'Code sent. Dev code: {{code}}' }))
      } else {
        setPayoutChangeMessage(t('payouts_page.code_sent_email', { defaultValue: 'Code sent. Check your email.' }))
      }
    } catch (e: any) {
      setError(e?.message || t('payouts_page.error_send_code', { defaultValue: 'Failed to send code' }))
    } finally {
      setIsSendingPayoutChangeCode(false)
    }
  }

  const verifyPayoutChangeEmailCode = async () => {
    setPayoutChangeMessage(null)
    setError(null)
    setIsVerifyingPayoutChangeCode(true)
    try {
      const res = await fetch('/api/organizer/payout-details-change/verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: payoutChangeCode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || t('payouts_page.error_verify_code', { defaultValue: 'Failed to verify code' }))

      if (pendingSensitiveUpdate) {
        if (pendingSensitiveUpdate.kind === 'profile_update') {
          setPayoutChangeMessage(t('payouts_page.verified_saving', { defaultValue: 'Verified. Saving your payout details…' }))
          const result = await updatePayoutProfileConfig(activeProfile as any, pendingSensitiveUpdate.updates)
          if (!result?.success) {
            if (result?.requiresVerification) {
              setPayoutChangeMessage(t('payouts_page.verification_expired', { defaultValue: 'Verification expired. Please request a new code.' }))
              return
            }
            throw new Error(result?.error || t('payouts_page.error_save_failed', { defaultValue: 'Failed to save payout details. Please try again.' }))
          }
          setIsEditing(false)
        }

        if (pendingSensitiveUpdate.kind === 'add_bank_destination') {
          setPayoutChangeMessage(t('payouts_page.verified_adding_bank', { defaultValue: 'Verified. Adding your bank account…' }))
          const res = await fetch('/api/organizer/payout-destinations/bank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bankDetails: pendingSensitiveUpdate.bankDetails }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            if (data?.requiresVerification || data?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
              setPayoutChangeMessage(t('payouts_page.verification_expired', { defaultValue: 'Verification expired. Please request a new code.' }))
              return
            }
            throw new Error(data?.error || data?.message || t('payouts_page.error_add_bank', { defaultValue: 'Failed to add bank account' }))
          }

          setAddBankDestinationMessage(t('payouts_page.bank_added', { defaultValue: 'Bank account added. Please submit verification for this account.' }))
          setNewBankDestination({ bankName: '', customBankName: '', accountNumber: '', accountHolder: '', routingNumber: '', swiftCode: '' })
          setShowAddBankDestination(false)
          try {
            const res2 = await fetch('/api/organizer/payout-destinations/bank', { cache: 'no-store' as any })
            const data2 = await res2.json().catch(() => ({}))
            if (res2.ok) setBankDestinations(Array.isArray(data2?.destinations) ? data2.destinations : [])
            const newId = String(data?.destinationId || '')
            if (newId) setSelectedBankDestinationId(newId)
          } catch {
            // ignore
          }
        }

        setPayoutChangeVerificationRequired(false)
        setPendingSensitiveUpdate(null)
        setPayoutChangeCode('')
        router.refresh()
      } else {
        setPayoutChangeMessage(t('payouts_page.verified_short', { defaultValue: 'Verified.' }))
      }
    } catch (e: any) {
      setError(e?.message || t('payouts_page.error_verify_code', { defaultValue: 'Failed to verify code' }))
    } finally {
      setIsVerifyingPayoutChangeCode(false)
    }
  }

  useEffect(() => {
    if (!payoutChangeVerificationRequired) return
    if (isSendingPayoutChangeCode) return
    // Auto-send once when the server requires step-up verification.
    void sendPayoutChangeEmailCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutChangeVerificationRequired])

  const formatCurrency = (amountCents: number, currencyRaw?: string) => {
    const normalized = amountCents / 100
    const currency = String(currencyRaw || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(normalized)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getStatusPill = (status: EventPayoutSummary['payoutStatus']) => {
    const tone = {
      paid: 'success',
      pending: 'warning',
      scheduled: 'warning',
      on_hold: 'danger'
    } as const

    const icons = {
      paid: CheckCircle,
      pending: Clock,
      scheduled: Clock,
      on_hold: Ban
    }

    const labels = {
      paid: t('payouts_page.payout_status_paid', { defaultValue: 'Paid' }),
      pending: t('payouts_page.payout_status_pending', { defaultValue: 'Pending' }),
      scheduled: t('payouts_page.payout_status_scheduled', { defaultValue: 'Scheduled' }),
      on_hold: t('payouts_page.payout_status_on_hold', { defaultValue: 'On hold' })
    }

    return (
      <StatusChip tone={tone[status]} icon={icons[status]}>
        {labels[status]}
      </StatusChip>
    )
  }

  const sendPhoneVerificationCode = async () => {
    setPhoneVerificationMessage(null)
    setError(null)
    setIsSendingPhoneCode(true)
    try {
      const res = await fetch('/api/organizer/send-phone-verification-code', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || t('payouts_page.error_send_code', { defaultValue: 'Failed to send code' }))

      const devCode = data?.debugCode
      if (process.env.NODE_ENV === 'development' && devCode) {
        setPhoneVerificationMessage(t('payouts_page.code_sent_dev', { code: devCode, defaultValue: 'Code sent. Dev code: {{code}}' }))
      } else {
        setPhoneVerificationMessage(t('payouts_page.code_sent_phone', { defaultValue: 'Code sent. Check your phone.' }))
      }
      router.refresh()
    } catch (err: any) {
      setError(err.message || t('payouts_page.error_send_code', { defaultValue: 'Failed to send code' }))
    } finally {
      setIsSendingPhoneCode(false)
    }
  }

  const submitPhoneVerificationCode = async () => {
    setPhoneVerificationMessage(null)
    setError(null)
    setIsSubmittingPhoneCode(true)
    try {
      const res = await fetch('/api/organizer/submit-phone-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationCode: phoneVerificationCode.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || t('payouts_page.error_verify_code', { defaultValue: 'Failed to verify code' }))
      setPhoneVerificationMessage(t('payouts_page.phone_verified_success', { defaultValue: 'Phone verified successfully.' }))
      setPhoneVerificationCode('')
      router.refresh()
    } catch (err: any) {
      setError(err.message || t('payouts_page.error_verify_code', { defaultValue: 'Failed to verify code' }))
    } finally {
      setIsSubmittingPhoneCode(false)
    }
  }

  const submitBankVerification = async () => {
    setBankVerificationMessage(null)
    setError(null)
    if (!bankVerificationFile) {
      setError(t('payouts_page.error_attach_document', { defaultValue: 'Please attach a verification document' }))
      return
    }

    if (activeProfile === 'haiti' && !selectedBankDestinationId) {
      setError(t('payouts_page.error_select_bank_to_verify', { defaultValue: 'Please select a bank account to verify' }))
      return
    }

    setIsSubmittingBankVerification(true)
    try {
      const form = new FormData()
      form.append('proofDocument', bankVerificationFile)
      form.append('verificationType', bankVerificationType)
      if (activeProfile === 'haiti') {
        form.append('destinationId', selectedBankDestinationId)
      }

      const res = await fetch('/api/organizer/submit-bank-verification', {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || t('payouts_page.error_submit_bank_verification', { defaultValue: 'Failed to submit bank verification' }))

      setBankVerificationMessage(t('payouts_page.bank_verification_submitted', { defaultValue: 'Bank verification submitted. Awaiting review.' }))
      setBankVerificationFile(null)

      // Refresh destination list/status.
      if (activeProfile === 'haiti') {
        try {
          const res2 = await fetch('/api/organizer/payout-destinations/bank', { cache: 'no-store' as any })
          const data2 = await res2.json().catch(() => ({}))
          if (res2.ok) setBankDestinations(Array.isArray(data2?.destinations) ? data2.destinations : [])
        } catch {
          // ignore
        }
      }
      router.refresh()
    } catch (err: any) {
      setError(err.message || t('payouts_page.error_submit_bank_verification', { defaultValue: 'Failed to submit bank verification' }))
    } finally {
      setIsSubmittingBankVerification(false)
    }
  }

  const addBankDestination = async () => {
    setAddBankDestinationMessage(null)
    setError(null)

    if (!newBankDestination.bankName.trim()) {
      setError(t('payouts_page.error_choose_bank', { defaultValue: 'Please choose a bank' }))
      return
    }

    if (newBankDestination.bankName === 'other' && !newBankDestination.customBankName.trim()) {
      setError(t('payouts_page.error_enter_bank_name', { defaultValue: 'Please enter your bank name' }))
      return
    }
    if (!newBankDestination.accountNumber.trim()) {
      setError(t('payouts_page.error_enter_account_number', { defaultValue: 'Please enter an account number' }))
      return
    }
    if (!newBankDestination.accountHolder.trim()) {
      setError(t('payouts_page.error_enter_account_holder', { defaultValue: 'Please enter the account holder name' }))
      return
    }

    setIsAddingBankDestination(true)
    try {
      const resolvedBankName =
        newBankDestination.bankName === 'other'
          ? newBankDestination.customBankName.trim()
          : newBankDestination.bankName

      const bankDetails = {
        accountNumber: newBankDestination.accountNumber,
        bankName: resolvedBankName,
        accountHolder: newBankDestination.accountHolder,
        routingNumber: newBankDestination.routingNumber || undefined,
        swiftCode: newBankDestination.swiftCode || undefined,
      }

      const res = await fetch('/api/organizer/payout-destinations/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankDetails }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.requiresVerification || data?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
          setPendingSensitiveUpdate({ kind: 'add_bank_destination', bankDetails })
          setPayoutChangeVerificationRequired(true)
          setPayoutChangeMessage(t('payouts_page.stepup_msg_bank', { defaultValue: 'For your security, confirm this new bank account with the code we email you.' }))
          return
        }
        throw new Error(data?.error || data?.message || t('payouts_page.error_add_bank', { defaultValue: 'Failed to add bank account' }))
      }

      setAddBankDestinationMessage(t('payouts_page.bank_added', { defaultValue: 'Bank account added. Please submit verification for this account.' }))
      setNewBankDestination({ bankName: '', customBankName: '', accountNumber: '', accountHolder: '', routingNumber: '', swiftCode: '' })
      setShowAddBankDestination(false)

      // Refresh list
      try {
        const res2 = await fetch('/api/organizer/payout-destinations/bank', { cache: 'no-store' as any })
        const data2 = await res2.json().catch(() => ({}))
        if (res2.ok) {
          const destinations = (Array.isArray(data2?.destinations) ? data2.destinations : []) as BankDestination[]
          setBankDestinations(destinations)
          const newId = String(data?.destinationId || '')
          if (newId) setSelectedBankDestinationId(newId)
        }
      } catch {
        // ignore
      }
      router.refresh()
    } catch (e: any) {
      setError(e?.message || t('payouts_page.error_add_bank', { defaultValue: 'Failed to add bank account' }))
    } finally {
      setIsAddingBankDestination(false)
    }
  }

  // Filter earnings by period
  const filteredEarnings = normalizedEventSummaries.filter((event) => {
    const eventDate = new Date(event.date)
    const now = new Date()
    
    if (period === 'this_month') {
      return (
        eventDate.getMonth() === now.getMonth() &&
        eventDate.getFullYear() === now.getFullYear()
      )
    } else if (period === 'last_3_months') {
      const threeMonthsAgo = new Date()
      threeMonthsAgo.setMonth(now.getMonth() - 3)
      return eventDate >= threeMonthsAgo
    }
    
    return true // all_time
  })

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header. The `border-b` went with the fill: a hairline a few pixels
          below the organizer nav's own edge reads as a crack across the page,
          and the 3% band already separates the header from the canvas. */}
      <div className="bg-white/[0.03]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
            <Link href="/organizer/settings" className="hover:text-white">
              {t('payouts_page.breadcrumb_settings', { defaultValue: 'Settings' })}
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white font-medium">{t('payouts_page.title', { defaultValue: 'Payouts' })}</span>
          </div>

          {/* Title. `!` on both size and leading: `.mobile-typography h1` is an
              element+class selector (0,1,1) and beat the bare arbitrary size
              (0,1,0), so this rendered at 20px/tight on every phone. */}
          <h1 className="font-display !text-[clamp(28px,4vw,40px)] !leading-[1.04] text-white mb-2">
            {t('payouts_page.title', { defaultValue: 'Payouts' })}
          </h1>
          <p className="text-white/60">
            {t('payouts_page.subtitle_setup_only', { defaultValue: 'Set up where your payouts go.' })}
          </p>

          {/* The shared kit `Chip` rather than three hand-rolled pills: it already
              carries the ladder (chosen = bg-white/text-black, unchosen =
              0.055 → 0.12 hover) and it steps up correctly off this 0.03 band. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip active href="/organizer/settings/payouts">
              {t('payouts_page.tab_payout_profile', { defaultValue: 'Payout profile' })}
            </Chip>
            <Chip href="/organizer/earnings">
              {t('payouts_page.tab_earnings', { defaultValue: 'Earnings' })}
            </Chip>
            <Chip href="/organizer/settings/payouts/history">
              {t('payouts_page.payout_history', { defaultValue: 'Payout history' })}
            </Chip>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isFocusedEdit && payoutChangeVerificationRequired ? (
          <div id="payout-change-stepup" className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-amber-100">{t('payouts_page.stepup_title', { defaultValue: 'Confirm payout details change' })}</p>
                <p className="text-sm text-amber-300 mt-1">
                  {payoutChangeMessage ||
                    t('payouts_page.stepup_desc', { defaultValue: 'For your security, confirm this change with the 6-digit code sent to your email.' })}
                </p>

                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={payoutChangeCode}
                    onChange={(e) => setPayoutChangeCode(e.target.value)}
                    placeholder={t('payouts_page.code_placeholder', { defaultValue: '6-digit code' })}
                    aria-label={t('payouts_page.code_aria', { defaultValue: '6-digit verification code' })}
                    className="w-full rounded-xl bg-white/[0.09] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 sm:w-48"
                  />
                  <button
                    type="button"
                    onClick={verifyPayoutChangeEmailCode}
                    disabled={isVerifyingPayoutChangeCode || !/^\d{6}$/.test(payoutChangeCode)}
                    className="px-4 py-2 bg-brand-700 text-white rounded-lg font-medium hover:bg-brand-800 transition-colors disabled:bg-white/20 disabled:cursor-not-allowed"
                  >
                    {isVerifyingPayoutChangeCode ? t('payouts_page.verifying', { defaultValue: 'Verifying…' }) : t('payouts_page.verify_and_continue', { defaultValue: 'Verify & continue' })}
                  </button>
                  <button
                    type="button"
                    onClick={sendPayoutChangeEmailCode}
                    disabled={isSendingPayoutChangeCode}
                    className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-200 font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSendingPayoutChangeCode ? t('payouts_page.sending', { defaultValue: 'Sending…' }) : t('payouts_page.resend_code', { defaultValue: 'Resend code' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:gap-8">
          
          {/* Left Column - Payout Setup + Fees */}
          <div className="flex flex-col gap-6">

            {isFocusedEdit ? (
              /* ── STEPPER LAYOUT (focused edit: ?edit=haiti or ?edit=stripe_connect) ── */
              <div className="flex flex-col gap-6">
                {/* Profile header */}
                <div className="flex items-start justify-between gap-3 rounded-2xl bg-white/[0.03] p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-brand-300">
                      {activeProfile === 'stripe_connect' ? <Globe className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                    </div>
                    <div>
                      <h2 className="font-display !text-[22px] !leading-tight text-white">{t('payouts_page.profile_payouts_title', { profile: focusedProfileLabel, defaultValue: '{{profile}} payouts' })}</h2>
                      <p className="mt-0.5 text-sm text-white/60">
                        {activeProfile === 'stripe_connect' ? t('payouts_page.profile_stripe_sub', { defaultValue: 'Bank payouts via Stripe Connect.' }) : t('payouts_page.profile_haiti_sub', { defaultValue: 'Bank transfer or mobile money (MonCash / NatCash).' })}
                      </p>
                    </div>
                  </div>
                  <StatusChip tone={config ? 'success' : 'neutral'}>{config ? t('payouts_page.chip_configured', { defaultValue: 'Configured' }) : t('payouts_page.chip_not_set_up', { defaultValue: 'Not set up' })}</StatusChip>
                </div>

                {/* Step progress bar */}
                {(() => {
                  const steps = [{ key: 'method', label: t('payouts_page.payout_method', { defaultValue: 'Payout method' }) }, { key: 'verify', label: t('payouts_page.step_verify', { defaultValue: 'Verify' }) }, { key: 'done', label: t('payouts_page.step_done', { defaultValue: 'Done' }) }] as const
                  const currentIdx = steps.findIndex((s) => s.key === editStep)
                  return (
                    <div className="flex items-center gap-1">
                      {steps.map((step, i) => {
                        const isDone = i < currentIdx
                        const isActive = i === currentIdx
                        return (
                          <div key={step.key} className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : ''}`}>
                            <div className="flex shrink-0 items-center gap-2">
                              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-brand-600 text-white' : 'bg-white/10 text-white/40'}`}>
                                {isDone ? '✓' : i + 1}
                              </div>
                              <span className={`whitespace-nowrap text-sm font-medium ${isActive ? 'text-white' : isDone ? 'text-white/60' : 'text-white/30'}`}>{step.label}</span>
                            </div>
                            {i < steps.length - 1 && <div className={`mx-3 h-px flex-1 ${isDone ? 'bg-emerald-500/40' : 'bg-white/15'}`} />}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {/* Step-up banner inline in stepper */}
                {payoutChangeVerificationRequired ? (
                  <div id="payout-change-stepup" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-amber-100">{t('payouts_page.stepup_title', { defaultValue: 'Confirm payout details change' })}</p>
                        <p className="text-sm text-amber-300 mt-1">{payoutChangeMessage || t('payouts_page.stepup_desc', { defaultValue: 'For your security, confirm this change with the 6-digit code sent to your email.' })}</p>
                        <div className="mt-3 flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={payoutChangeCode}
                            onChange={(e) => setPayoutChangeCode(e.target.value)}
                            placeholder={t('payouts_page.code_placeholder', { defaultValue: '6-digit code' })}
                            aria-label={t('payouts_page.code_aria', { defaultValue: '6-digit verification code' })}
                            className="w-full rounded-xl bg-white/[0.09] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500 sm:w-48"
                          />
                          <button type="button" onClick={verifyPayoutChangeEmailCode} disabled={isVerifyingPayoutChangeCode || !/^\d{6}$/.test(payoutChangeCode)} className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-40">
                            {isVerifyingPayoutChangeCode ? t('payouts_page.verifying', { defaultValue: 'Verifying…' }) : t('payouts_page.verify_and_continue', { defaultValue: 'Verify & continue' })}
                          </button>
                          <button type="button" onClick={sendPayoutChangeEmailCode} disabled={isSendingPayoutChangeCode} className="rounded-xl bg-amber-500/20 px-4 py-2.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-50">
                            {isSendingPayoutChangeCode ? t('payouts_page.sending', { defaultValue: 'Sending…' }) : t('payouts_page.resend_code', { defaultValue: 'Resend code' })}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Step 1 — Payout method */}
                {editStep === 'method' && (
                  <div className="rounded-2xl bg-white/[0.03]">
                    <div className="p-6">
                      <SectionHeader className="mb-4" title={t('payouts_page.payout_method', { defaultValue: 'Payout method' })} />

                      {isStripeConnectSelection ? (
                        <div className="mb-4 rounded-xl bg-white/[0.055] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">Stripe Connect</p>
                              <p className="mt-1 text-sm text-white/60">{t('payouts_page.stripe_connect_desc', { defaultValue: 'Connect your Stripe account to receive payouts to your bank.' })}</p>
                            </div>
                            <StatusChip tone={getStripeBadge().tone}>{getStripeBadge().label}</StatusChip>
                          </div>
                          {stripeStatusError ? <div className="mt-3 text-sm text-red-300">{stripeStatusError}</div> : null}
                          <div className="mt-3 flex gap-2">
                            {!stripeStatus?.connected ? (
                              <button type="button" onClick={startStripeOnboarding} className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800">{t('payouts_page.connect_with_stripe', { defaultValue: 'Connect with Stripe' })}</button>
                            ) : (
                              <>
                                <button type="button" onClick={startStripeOnboarding} className="rounded-xl bg-white/[0.09] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14]">{t('payouts_page.continue_onboarding', { defaultValue: 'Continue onboarding' })}</button>
                                <button type="button" onClick={openStripeDashboard} className="rounded-xl bg-white/[0.09] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14]">{t('payouts_page.manage_in_stripe', { defaultValue: 'Manage in Stripe' })}</button>
                              </>
                            )}
                            {isLoadingStripeStatus ? <span className="self-center text-sm text-white/50">{t('payouts_page.loading', { defaultValue: 'Loading…' })}</span> : null}
                          </div>
                        </div>
                      ) : null}

                      {isHaiti && String(formData.method || '').toLowerCase() === 'mobile_money' && selectedProvider === 'moncash' ? (
                        <div className="mb-4 rounded-xl bg-white/[0.055] p-4">
                          <p className="text-sm font-semibold text-white">{t('payouts_page.instant_moncash_title', { defaultValue: 'Instant MonCash (prefunding)' })}</p>
                          <p className="mt-1 text-sm text-white/60">{t('payouts_page.instant_moncash_desc', { min: MONCASH_MIN_LABEL, defaultValue: INSTANT_MONCASH_DESC_FALLBACK })}</p>
                          {prefundingError ? <div className="mt-2 text-sm text-red-300">{prefundingError}</div> : null}
                          {prefunding ? (
                            <div className="mt-2 text-sm text-white/70">{t('payouts_page.prefunding_status', { status: prefunding.enabled && prefunding.available ? t('payouts_page.prefunding_available', { defaultValue: 'Available' }) : prefunding.enabled ? t('payouts_page.prefunding_unavailable', { defaultValue: 'Temporarily unavailable' }) : t('payouts_page.prefunding_disabled', { defaultValue: 'Disabled' }), defaultValue: 'Status: {{status}}' })}</div>
                          ) : <div className="mt-2 text-sm text-white/50">{t('payouts_page.loading', { defaultValue: 'Loading…' })}</div>}
                          <label className="mt-3 flex items-center gap-2 text-sm text-white">
                            <input type="checkbox" checked={Boolean(config?.allowInstantMoncash)} disabled={!prefunding?.enabled || !prefunding?.available}
                              onChange={async (e) => {
                                try {
                                  const result = await updatePayoutProfileConfig('haiti' as any, { allowInstantMoncash: e.target.checked } as any)
                                  if (!result?.success) {
                                    if (result?.requiresVerification) { setPendingSensitiveUpdate({ kind: 'profile_update', updates: { allowInstantMoncash: e.target.checked } }); setPayoutChangeVerificationRequired(true); setPayoutChangeMessage(t('payouts_page.stepup_msg_profile', { defaultValue: 'For your security, confirm this payout change with the code we email you.' })); return }
                                    throw new Error(result?.error || t('payouts_page.error_update_setting', { defaultValue: 'Failed to update setting' }))
                                  }
                                  router.refresh()
                                } catch { setError(t('payouts_page.error_update_prefunding', { defaultValue: 'Failed to update prefunding preference' })) }
                              }}
                              className="h-4 w-4 accent-brand-500"
                            />
                            {t('payouts_page.allow_instant_moncash', { defaultValue: 'Allow instant MonCash withdrawals when available' })}
                          </label>
                        </div>
                      ) : null}

                      <div className="space-y-4">
                        <div>
                          <label htmlFor="step-location" className="mb-2 block text-sm font-medium text-white/70">{t('payouts_page.account_location', { defaultValue: 'Account location' })} <span className="text-red-500">*</span></label>
                          <select id="step-location" value={formData.accountLocation}
                            onChange={(e) => {
                              const nextLocation = e.target.value
                              if (activeProfile === 'haiti') { setFormData({ ...formData, accountLocation: 'haiti' }); return }
                              const wantsStripe = nextLocation === 'united_states' || nextLocation === 'canada'
                              setFormData({ ...formData, accountLocation: wantsStripe ? nextLocation : 'united_states', method: 'bank_transfer' })
                            }}
                            className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                          >
                            {activeProfile === 'haiti' ? <option value="haiti">{t('payouts_page.country_haiti', { defaultValue: 'Haiti' })}</option> : (<><option value="united_states">{t('payouts_page.country_united_states', { defaultValue: 'United States' })}</option><option value="canada">{t('payouts_page.country_canada', { defaultValue: 'Canada' })}</option></>)}
                          </select>
                          {activeProfile === 'stripe_connect' ? <p className="mt-1 !text-xs text-white/50">{t('payouts_page.stripe_handles_us_ca', { defaultValue: 'US/Canada payouts are handled via Stripe Connect.' })}</p> : null}
                        </div>

                        {activeProfile === 'haiti' ? (
                          <div>
                            <label className="mb-2 block text-sm font-medium text-white/70">{t('payouts_page.payout_method', { defaultValue: 'Payout method' })} <span className="text-red-500">*</span></label>
                            {/* Selection changes the FILL and adds the teal ring;
                                these were an unfilled box with a 4% hover, so the
                                chosen method differed from the other by nothing. */}
                            <div className="space-y-2">
                              <label className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors ${formData.method === 'bank_transfer' ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50' : 'bg-white/[0.055] hover:bg-white/[0.12]'}`}>
                                <input type="radio" name="step-method" value="bank_transfer" checked={formData.method === 'bank_transfer'} onChange={(e) => setFormData({ ...formData, method: e.target.value as any })} className="h-4 w-4 accent-brand-500" />
                                <span className="text-sm font-medium text-white">{t('payouts_page.bank_transfer', { defaultValue: 'Bank transfer' })}</span>
                              </label>
                              <label className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors ${formData.method === 'mobile_money' ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50' : 'bg-white/[0.055] hover:bg-white/[0.12]'}`}>
                                <input type="radio" name="step-method" value="mobile_money" checked={formData.method === 'mobile_money'} onChange={(e) => setFormData({ ...formData, method: e.target.value as any })} className="h-4 w-4 accent-brand-500" />
                                <span className="text-sm font-medium text-white">{t('payouts_page.mobile_money', { defaultValue: 'Mobile money' })}</span>
                              </label>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white/70">{t('payouts_page.stripe_collects_bank_short', { defaultValue: 'Stripe Connect collects your bank details securely. No bank info required here.' })}</div>
                        )}

                        {activeProfile === 'haiti' && formData.method === 'bank_transfer' ? (
                          <div>
                            <label className="mb-2 block text-sm font-medium text-white/70">{t('payouts_page.bank_account', { defaultValue: 'Bank account' })} <span className="text-red-500">*</span></label>
                            {isLoadingBankDestinations ? <div className="text-sm text-white/50">{t('payouts_page.loading_saved_banks', { defaultValue: 'Loading saved bank accounts…' })}</div> : null}
                            {bankDestinations && bankDestinations.length ? (
                              <select aria-label={t('payouts_page.select_bank_account', { defaultValue: 'Select bank account' })} value={selectedBankDestinationId} onChange={(e) => setSelectedBankDestinationId(e.target.value)} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500">
                                {bankDestinations.map((d) => (<option key={d.id} value={d.id}>{d.bankName} • ****{d.accountNumberLast4}{d.isPrimary ? t('payouts_page.primary_suffix', { defaultValue: ' (Primary)' }) : ''}</option>))}
                              </select>
                            ) : <div className="text-sm text-white/60">{t('payouts_page.no_banks_step2', { defaultValue: 'No bank accounts saved yet. Add one in step 2 (Verify).' })}</div>}
                            {bankDestinationsError ? <div className="text-xs text-red-300 mt-1">{bankDestinationsError}</div> : null}
                          </div>
                        ) : null}

                        {formData.method === 'mobile_money' && activeProfile === 'haiti' && (
                          <>
                            <div>
                              <label htmlFor="step-provider" className="mb-2 block text-sm font-medium text-white/70">{t('payouts_page.provider', { defaultValue: 'Provider' })}</label>
                              <select id="step-provider" value={formData.provider} onChange={(e) => setFormData({ ...formData, provider: e.target.value })} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500">
                                <option value="moncash">MonCash</option>
                                {NATCASH_ENABLED && <option value="natcash">Natcash</option>}
                              </select>
                            </div>
                            {Boolean(config?.mobileMoneyDetails?.phoneNumberLast4) && !isChangingMobileNumber ? (
                              <div className="rounded-xl bg-white/[0.055] p-4">
                                <div className="text-sm font-medium text-white">{t('payouts_page.saved_phone_number', { defaultValue: 'Saved phone number' })}</div>
                                <div className="mt-1 text-sm text-white/70">****{config?.mobileMoneyDetails?.phoneNumberLast4}</div>
                                <button type="button" onClick={() => setIsChangingMobileNumber(true)} className="mt-2 text-sm font-medium text-brand-300">{t('payouts_page.change_number', { defaultValue: 'Change number' })}</button>
                              </div>
                            ) : (
                              <div>
                                <label htmlFor="step-phone" className="mb-2 block text-sm font-medium text-white/70">{t('payouts_page.phone_number', { defaultValue: 'Phone number' })}</label>
                                <input id="step-phone" type="tel" value={formData.phoneNumber} onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })} placeholder="+50912345678" className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                {Boolean(config?.mobileMoneyDetails?.phoneNumberLast4) ? (
                                  <button type="button" onClick={() => { setIsChangingMobileNumber(false); setFormData((p) => ({ ...p, phoneNumber: '' })) }} className="mt-2 text-sm font-medium text-white/60 hover:text-white/70">{t('payouts_page.use_saved_number', { defaultValue: 'Use saved number instead' })}</button>
                                ) : null}
                              </div>
                            )}
                          </>
                        )}

                        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

                        <button type="button" onClick={() => handleSavePayoutDetails(() => setEditStep('verify'))} disabled={isSaving || payoutChangeVerificationRequired} className="w-full rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-40">
                          {isSaving ? (activeProfile === 'stripe_connect' ? t('payouts_page.opening_stripe', { defaultValue: 'Opening Stripe…' }) : t('payouts_page.saving', { defaultValue: 'Saving…' })) : (activeProfile === 'stripe_connect' ? t('payouts_page.continue_to_stripe', { defaultValue: 'Continue to Stripe' }) : t('payouts_page.save_and_continue', { defaultValue: 'Save & continue' }))}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2 — Verify */}
                {editStep === 'verify' && (
                  <div className="rounded-2xl bg-white/[0.03]">
                    <div className="p-6">
                      <div id="verify-payouts" />
                      <SectionHeader
                        className="mb-4"
                        title={t('payouts_page.verify_payouts', { defaultValue: 'Verify payouts' })}
                        description={t('payouts_page.verify_payouts_desc_step', { defaultValue: 'Complete identity and account verification to receive payouts.' })}
                      />

                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">{t('payouts_page.organizer_identity', { defaultValue: 'Organizer identity' })}</div>
                            <div className="text-sm text-white/60">{organizerIdentityStatus === 'verified' ? t('payouts_page.status_verified', { defaultValue: 'Verified' }) : organizerIdentityStatus === 'failed' ? t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' }) : t('payouts_page.status_pending', { defaultValue: 'Pending' })}</div>
                          </div>
                          <Link href="/organizer/verify" className="text-sm font-medium text-brand-300">{t('payouts_page.view', { defaultValue: 'View' })}</Link>
                        </div>

                        {!isStripeConnectAccount && config?.method === 'bank_transfer' && hasPayoutSetup && (
                          <div className="border-t border-white/10 pt-3">
                            <div className="mb-3">
                              <div className="text-sm font-medium text-white">{t('payouts_page.bank_account', { defaultValue: 'Bank account' })}</div>
                              <div className="text-sm text-white/60">{bankStatus === 'verified' ? t('payouts_page.status_verified', { defaultValue: 'Verified' }) : bankStatus === 'failed' ? t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' }) : t('payouts_page.status_pending', { defaultValue: 'Pending' })}</div>
                            </div>
                            <div className="space-y-3">
                              {isHaiti ? (
                                <div>
                                  <label htmlFor="step2-bank-select" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.select_bank_account', { defaultValue: 'Select bank account' })}</label>
                                  <select id="step2-bank-select" value={selectedBankDestinationId} onChange={(e) => setSelectedBankDestinationId(e.target.value)} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500">
                                    {(bankDestinations || []).map((d) => (<option key={d.id} value={d.id}>{d.bankName} • ****{d.accountNumberLast4}{d.isPrimary ? t('payouts_page.primary_suffix', { defaultValue: ' (Primary)' }) : ''} ({d.verificationStatus ? t(`payouts_page.dest_status_${d.verificationStatus}`, { defaultValue: d.verificationStatus }) : t('payouts_page.dest_status_not_submitted', { defaultValue: 'not submitted' })})</option>))}
                                  </select>
                                  {isLoadingBankDestinations ? <div className="mt-1 text-xs text-white/50">{t('payouts_page.loading_bank_accounts', { defaultValue: 'Loading bank accounts…' })}</div> : null}
                                  {bankDestinationsError ? <div className="mt-1 text-xs text-red-300">{bankDestinationsError}</div> : null}
                                </div>
                              ) : null}
                              {(() => {
                                const selected = (bankDestinations || []).find((d) => d.id === selectedBankDestinationId) || null
                                const status = (selected?.verificationStatus || null) as 'pending' | 'verified' | 'failed' | null
                                if (isHaiti && status === 'pending') return <div className="text-sm text-white/60">{selected?.verificationSubmittedAt ? t('payouts_page.verification_submitted_on', { date: new Date(selected.verificationSubmittedAt).toLocaleDateString(), defaultValue: 'Verification submitted on {{date}}. Awaiting review.' }) : t('payouts_page.verification_submitted', { defaultValue: 'Verification submitted. Awaiting review.' })}</div>
                                if (!isHaiti) { if (bankStatus === 'verified') return null } else { if (!selectedBankDestinationId) return null; if (status === 'verified') return null }
                                return (
                                  <>
                                    {isHaiti && status === 'failed' ? <div className="text-sm text-red-300">{t('payouts_page.verification_rejected', { defaultValue: 'Verification was rejected. Please upload a new document.' })}</div> : null}
                                    <div>
                                      <label htmlFor="step2-doc-type" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.document_type', { defaultValue: 'Document type' })}</label>
                                      <select id="step2-doc-type" value={bankVerificationType} onChange={(e) => setBankVerificationType(e.target.value as any)} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500">
                                        <option value="bank_statement">{t('payouts_page.doc_bank_statement', { defaultValue: 'Bank statement' })}</option>
                                        <option value="void_check">{t('payouts_page.doc_void_check', { defaultValue: 'Void check' })}</option>
                                        <option value="utility_bill">{t('payouts_page.doc_utility_bill', { defaultValue: 'Utility bill' })}</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.upload_document', { defaultValue: 'Upload document' })}</label>
                                      <input type="file" accept="image/*,application/pdf" aria-label={t('payouts_page.upload_document', { defaultValue: 'Upload document' })} onChange={(e) => setBankVerificationFile(e.target.files?.[0] || null)} className="w-full text-sm text-white" />
                                    </div>
                                    <button type="button" onClick={submitBankVerification} disabled={isSubmittingBankVerification} className="w-full rounded-xl bg-white/[0.055] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.12] disabled:opacity-50">
                                      {isSubmittingBankVerification ? t('payouts_page.submitting', { defaultValue: 'Submitting…' }) : t('payouts_page.submit_bank_verification', { defaultValue: 'Submit bank verification' })}
                                    </button>
                                    {bankVerificationMessage && <div className="text-sm text-white/60">{bankVerificationMessage}</div>}
                                  </>
                                )
                              })()}
                              {isHaiti ? (
                                <div className="border-t border-white/10 pt-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium text-white">{t('payouts_page.additional_bank_accounts', { defaultValue: 'Additional bank accounts' })}</div>
                                    <button type="button" onClick={() => setShowAddBankDestination((v) => !v)} className="text-sm font-medium text-brand-300">{showAddBankDestination ? t('payouts_page.cancel', { defaultValue: 'Cancel' }) : t('payouts_page.add_bank_account', { defaultValue: 'Add bank account' })}</button>
                                  </div>
                                  {addBankDestinationMessage ? <div className="mt-2 text-sm text-white/60">{addBankDestinationMessage}</div> : null}
                                  {showAddBankDestination ? (
                                    <div className="mt-3 space-y-3">
                                      <div>
                                        <label htmlFor="step2-add-bank" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.bank', { defaultValue: 'Bank' })}</label>
                                        <select id="step2-add-bank" value={newBankDestination.bankName} onChange={(e) => setNewBankDestination((p) => ({ ...p, bankName: e.target.value, customBankName: e.target.value === 'other' ? p.customBankName : '' }))} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500">
                                          <option value="">{t('payouts_page.select_a_bank', { defaultValue: 'Select a bank' })}</option>
                                          {banks.map((bank) => (<option key={bank.value} value={bank.value}>{bank.label}</option>))}
                                        </select>
                                      </div>
                                      {newBankDestination.bankName === 'other' ? (
                                        <div>
                                          <label htmlFor="step2-custom-bank" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.bank_name', { defaultValue: 'Bank name' })}</label>
                                          <input id="step2-custom-bank" type="text" value={newBankDestination.customBankName} onChange={(e) => setNewBankDestination((p) => ({ ...p, customBankName: e.target.value }))} placeholder={t('payouts_page.bank_name_placeholder', { defaultValue: 'Enter your bank name' })} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                        </div>
                                      ) : null}
                                      <div>
                                        <label htmlFor="step2-acct-num" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.account_number', { defaultValue: 'Account number' })}</label>
                                        <input id="step2-acct-num" type="text" value={newBankDestination.accountNumber} onChange={(e) => setNewBankDestination((p) => ({ ...p, accountNumber: e.target.value }))} placeholder="1234567890" className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                      </div>
                                      <div>
                                        <label htmlFor="step2-acct-holder" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.account_holder_name', { defaultValue: 'Account holder name' })}</label>
                                        <input id="step2-acct-holder" type="text" value={newBankDestination.accountHolder} onChange={(e) => setNewBankDestination((p) => ({ ...p, accountHolder: e.target.value }))} placeholder={t('payouts_page.account_holder_placeholder', { defaultValue: 'Your legal name' })} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                      </div>
                                      <div>
                                        <label htmlFor="step2-routing" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.routing_number_optional', { defaultValue: 'Routing number (optional)' })}</label>
                                        <input id="step2-routing" type="text" value={newBankDestination.routingNumber} onChange={(e) => setNewBankDestination((p) => ({ ...p, routingNumber: e.target.value }))} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                      </div>
                                      <div>
                                        <label htmlFor="step2-swift" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.swift_code_optional', { defaultValue: 'SWIFT code (optional)' })}</label>
                                        <input id="step2-swift" type="text" value={newBankDestination.swiftCode} onChange={(e) => setNewBankDestination((p) => ({ ...p, swiftCode: e.target.value }))} className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                      </div>
                                      <button type="button" onClick={addBankDestination} disabled={isAddingBankDestination} className="w-full rounded-xl bg-white/[0.055] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.12] disabled:opacity-50">
                                        {isAddingBankDestination ? t('payouts_page.adding', { defaultValue: 'Adding…' }) : t('payouts_page.add_bank_account', { defaultValue: 'Add bank account' })}
                                      </button>
                                      <p className="!text-xs text-white/50">{t('payouts_page.bank_doc_note', { defaultValue: "You'll need to submit a bank statement or void check for each bank account." })}</p>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}

                        {!isStripeConnectAccount && config?.method === 'mobile_money' && hasPayoutSetup && (
                          <div className="border-t border-white/10 pt-3">
                            <div className="mb-3">
                              <div className="text-sm font-medium text-white">{t('payouts_page.phone_number', { defaultValue: 'Phone number' })}</div>
                              <div className="text-sm text-white/60">{phoneStatus === 'verified' ? t('payouts_page.status_verified', { defaultValue: 'Verified' }) : phoneStatus === 'failed' ? t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' }) : t('payouts_page.status_pending', { defaultValue: 'Pending' })}</div>
                            </div>
                            {phoneStatus !== 'verified' && (
                              <div className="space-y-3">
                                <button type="button" onClick={sendPhoneVerificationCode} disabled={isSendingPhoneCode} className="w-full rounded-xl bg-white/[0.055] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.12] disabled:opacity-50">
                                  {isSendingPhoneCode ? t('payouts_page.sending', { defaultValue: 'Sending…' }) : t('payouts_page.send_verification_code', { defaultValue: 'Send verification code' })}
                                </button>
                                <div>
                                  <label htmlFor="step2-phone-code" className="mb-1 block text-sm font-medium text-white/70">{t('payouts_page.enter_6_digit_code', { defaultValue: 'Enter 6-digit code' })}</label>
                                  <input id="step2-phone-code" type="text" inputMode="numeric" value={phoneVerificationCode} onChange={(e) => setPhoneVerificationCode(e.target.value)} placeholder="123456" className="w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500" />
                                </div>
                                <button type="button" onClick={submitPhoneVerificationCode} disabled={isSubmittingPhoneCode} className="w-full rounded-xl bg-white/[0.055] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.12] disabled:opacity-50">
                                  {isSubmittingPhoneCode ? t('payouts_page.verifying', { defaultValue: 'Verifying…' }) : t('payouts_page.verify_phone', { defaultValue: 'Verify phone' })}
                                </button>
                                {phoneVerificationMessage && <div className="text-sm text-white/60">{phoneVerificationMessage}</div>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <p className="mt-4 !text-xs text-white/50">{t('payouts_page.verification_required_note', { defaultValue: 'Verification is required to receive payouts and publish paid events.' })}</p>
                      <button type="button" onClick={() => setEditStep('done')} className="mt-4 w-full rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800">
                        {t('payouts_page.done_back_to_overview', { defaultValue: 'Done, back to overview' })}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3 — Done */}
                {editStep === 'done' && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20">
                      <CheckCircle className="h-7 w-7 text-emerald-300" />
                    </div>
                    <h2 className="font-display !text-2xl !leading-tight text-white">{t('payouts_page.all_set_title', { defaultValue: "You're all set!" })}</h2>
                    <p className="mt-2 text-sm text-white/60">{t('payouts_page.all_set_desc', { defaultValue: 'Your payout details have been saved. Verification may take 1 to 2 business days.' })}</p>
                    <Link href="/organizer/settings/payouts" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      {t('payouts_page.back_to_payouts', { defaultValue: 'Back to payouts' })}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
            /* ── NON-FOCUSED: existing multi-card layout ── */
            <>
            <div className="contents">
            {/* Where you run events — declared markets. Answering this is what
                stops a Haiti-only organizer being shown Stripe Connect at all,
                and what tells a Haiti + US organizer they need BOTH setups. */}
            <DeclaredMarketsCard
              className="order-none"
              initialMarkets={normalizedMarkets}
              haitiConfigured={Boolean(haitiConfig)}
              stripeConfigured={Boolean(stripeConfig)}
            />

            {/* Payout Profile Selector */}
            <div className="order-1 overflow-hidden rounded-2xl bg-white/[0.03]">
              <div className="p-6">
                <SectionHeader
                  className="mb-4"
                  title={t('payouts_page.payout_profiles', { defaultValue: 'Payout profiles' })}
                  description={t('payouts_page.payout_profiles_desc', { defaultValue: "Each region pays out through its own profile. An event's country decides which one gets paid. Completing one does not cover the other." })}
                />

                {/* One descriptive card per region: which events, which rail, who
                    verifies, and its own status, the dual-profile model made
                    visible (tester feedback, 2026-08-12/29). */}
                <div className="space-y-2">
                  {(
                    [
                      showHaitiRail && {
                        id: 'haiti' as const,
                        title: t('payouts_page.profile_haiti_title', { defaultValue: 'Haiti events' }),
                        detail: t('payouts_page.profile_haiti_detail', { defaultValue: 'MonCash & bank transfer · verified by Tikèm' }),
                        configured: Boolean(haitiConfig),
                      },
                      showStripeRail && {
                        id: 'stripe_connect' as const,
                        title: t('payouts_page.profile_stripe_title', { defaultValue: 'US · Canada · France events' }),
                        detail: t('payouts_page.profile_stripe_detail', { defaultValue: 'Card payouts via Stripe · verified by Stripe' }),
                        configured: Boolean(stripeConfig),
                      },
                    ].filter(Boolean) as Array<{
                      id: 'haiti' | 'stripe_connect'
                      title: string
                      detail: string
                      configured: boolean
                    }>
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActiveProfile(p.id)
                        setShowAdditionalProfiles(true)
                      }}
                      /* The nesting trap: an unchosen row was bg-white/[0.03] inside
                         a bg-white/[0.03] card — literally the same colour — with a
                         hover that repeated the base value, so it had no hover at
                         all. Rows step up to 0.055, and the chosen one to 0.08 plus
                         the teal ring. */
                      className={`w-full rounded-lg px-4 py-3 text-left transition-colors ${
                        activeProfile === p.id
                          ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50'
                          : 'bg-white/[0.055] hover:bg-white/[0.12]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-white">{p.title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/50">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${p.configured ? 'bg-emerald-400' : 'bg-amber-400'}`}
                          />
                          {p.configured ? t('payouts_page.chip_set_up', { defaultValue: 'Set up' }) : t('payouts_page.chip_needs_setup', { defaultValue: 'Needs setup' })}
                        </span>
                      </div>
                      <p className="mt-0.5 !text-xs text-white/50">{p.detail}</p>
                    </button>
                  ))}
                </div>

                {/* Escape hatch. A declaration narrows the UI; it must never be
                    able to lock someone out of a rail they turn out to need. */}
                {railIsHidden ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllRails(true)
                      setShowAdditionalProfiles(true)
                    }}
                    className="mt-3 text-xs font-medium text-white/50 underline underline-offset-2 hover:text-white/80"
                  >
                    {t('payouts_page.show_all_rails', { defaultValue: 'Show every payout method anyway' })}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Verification Card */}
            <div className="order-3 overflow-hidden rounded-2xl bg-white/[0.03]">
              <div className="p-6">
                <div id="verify-payouts" />
                <SectionHeader
                  className="mb-4"
                  title={t('payouts_page.verify_payouts', { defaultValue: 'Verify payouts' })}
                  description={t('payouts_page.verify_payouts_desc', { defaultValue: 'After setting up your payout method, complete verification below.' })}
                />

                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{t('payouts_page.organizer_identity', { defaultValue: 'Organizer identity' })}</div>
                      <div className="text-sm text-white/60">
                        {organizerIdentityStatus === 'verified'
                          ? t('payouts_page.status_verified', { defaultValue: 'Verified' })
                          : organizerIdentityStatus === 'failed'
                            ? t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' })
                            : t('payouts_page.status_pending', { defaultValue: 'Pending' })}
                      </div>
                    </div>
                    <Link
                      href="/organizer/verify"
                      className="text-sm font-medium text-brand-300 transition-colors hover:text-brand-200"
                    >
                      {t('payouts_page.view', { defaultValue: 'View' })}
                    </Link>
                  </div>

                  {!isStripeConnectAccount && config?.method === 'bank_transfer' && hasPayoutSetup && (
                    <div className="pt-3 border-t border-white/10">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="text-sm font-medium text-white">{t('payouts_page.bank_account', { defaultValue: 'Bank account' })}</div>
                          <div className="text-sm text-white/60">
                            {bankStatus === 'verified'
                              ? t('payouts_page.status_verified', { defaultValue: 'Verified' })
                              : bankStatus === 'failed'
                                ? t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' })
                                : t('payouts_page.status_pending', { defaultValue: 'Pending' })}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {isHaiti ? (
                          <div>
                            <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.select_bank_account', { defaultValue: 'Select bank account' })}</label>
                            <select
                              aria-label={t('payouts_page.select_bank_account', { defaultValue: 'Select bank account' })}
                              value={selectedBankDestinationId}
                              onChange={(e) => setSelectedBankDestinationId(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                            >
                              {(bankDestinations || []).map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.bankName} • ****{d.accountNumberLast4}{d.isPrimary ? t('payouts_page.primary_suffix', { defaultValue: ' (Primary)' }) : ''} ({d.verificationStatus ? t(`payouts_page.dest_status_${d.verificationStatus}`, { defaultValue: d.verificationStatus }) : t('payouts_page.dest_status_not_submitted', { defaultValue: 'not submitted' })})
                                </option>
                              ))}
                            </select>
                            {isLoadingBankDestinations ? (
                              <div className="text-xs text-white/50 mt-1">{t('payouts_page.loading_bank_accounts', { defaultValue: 'Loading bank accounts…' })}</div>
                            ) : null}
                            {bankDestinationsError ? (
                              <div className="text-xs text-red-300 mt-1">{bankDestinationsError}</div>
                            ) : null}
                          </div>
                        ) : null}

                        {(() => {
                          const selected = (bankDestinations || []).find((d) => d.id === selectedBankDestinationId) || null
                          const status = (selected?.verificationStatus || null) as
                            | 'pending'
                            | 'verified'
                            | 'failed'
                            | null

                          if (isHaiti && status === 'pending') {
                            return (
                              <div className="text-sm text-white/60">
                                {selected?.verificationSubmittedAt ? t('payouts_page.verification_submitted_on', { date: new Date(selected.verificationSubmittedAt).toLocaleDateString(), defaultValue: 'Verification submitted on {{date}}. Awaiting review.' }) : t('payouts_page.verification_submitted', { defaultValue: 'Verification submitted. Awaiting review.' })}
                              </div>
                            )
                          }

                          if (!isHaiti) {
                            // Non-Haiti legacy flow still uses the profile-level bank verification.
                            if (bankStatus === 'verified') return null
                          } else {
                            if (!selectedBankDestinationId) return null
                            if (status === 'verified') return null
                          }

                          return (
                            <>
                              {isHaiti && status === 'failed' ? (
                                <div className="text-sm text-red-300">
                                  {t('payouts_page.verification_rejected', { defaultValue: 'Verification was rejected. Please upload a new document.' })}
                                </div>
                              ) : null}

                              <div>
                                <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.document_type', { defaultValue: 'Document type' })}</label>
                                <select
                                  aria-label={t('payouts_page.document_type', { defaultValue: 'Document type' })}
                                  value={bankVerificationType}
                                  onChange={(e) => setBankVerificationType(e.target.value as any)}
                                  className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                >
                                  <option value="bank_statement">{t('payouts_page.doc_bank_statement', { defaultValue: 'Bank statement' })}</option>
                                  <option value="void_check">{t('payouts_page.doc_void_check', { defaultValue: 'Void check' })}</option>
                                  <option value="utility_bill">{t('payouts_page.doc_utility_bill', { defaultValue: 'Utility bill' })}</option>
                                </select>
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.upload_document', { defaultValue: 'Upload document' })}</label>
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  aria-label={t('payouts_page.upload_document', { defaultValue: 'Upload document' })}
                                  onChange={(e) => setBankVerificationFile(e.target.files?.[0] || null)}
                                  className="w-full text-sm"
                                />
                              </div>

                              <button
                                type="button"
                                onClick={submitBankVerification}
                                disabled={isSubmittingBankVerification}
                                className="w-full px-4 py-2 rounded-lg bg-white/[0.055] text-white/80 font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isSubmittingBankVerification ? t('payouts_page.submitting', { defaultValue: 'Submitting…' }) : t('payouts_page.submit_bank_verification', { defaultValue: 'Submit bank verification' })}
                              </button>

                              {bankVerificationMessage && (
                                <div className="text-sm text-white/60">{bankVerificationMessage}</div>
                              )}
                            </>
                          )
                        })()}

                        {isHaiti ? (
                          <div className="pt-3 border-t border-white/10">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-white">{t('payouts_page.additional_bank_accounts', { defaultValue: 'Additional bank accounts' })}</div>
                              <button
                                type="button"
                                onClick={() => setShowAddBankDestination((v) => !v)}
                                className="text-sm font-medium text-brand-300 transition-colors hover:text-brand-200"
                              >
                                {showAddBankDestination ? t('payouts_page.cancel', { defaultValue: 'Cancel' }) : t('payouts_page.add_bank_account', { defaultValue: 'Add bank account' })}
                              </button>
                            </div>

                            {addBankDestinationMessage ? (
                              <div className="text-sm text-white/60 mt-2">{addBankDestinationMessage}</div>
                            ) : null}

                            {showAddBankDestination ? (
                              <div className="mt-3 space-y-3">
                                <div>
                                  <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.bank', { defaultValue: 'Bank' })}</label>
                                  <select
                                    aria-label={t('payouts_page.bank', { defaultValue: 'Bank' })}
                                    value={newBankDestination.bankName}
                                    onChange={(e) =>
                                      setNewBankDestination((p) => ({
                                        ...p,
                                        bankName: e.target.value,
                                        customBankName: e.target.value === 'other' ? p.customBankName : '',
                                      }))
                                    }
                                    className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                  >
                                    <option value="">{t('payouts_page.select_a_bank', { defaultValue: 'Select a bank' })}</option>
                                    {banks.map((bank) => (
                                      <option key={bank.value} value={bank.value}>
                                        {bank.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {newBankDestination.bankName === 'other' ? (
                                  <div>
                                    <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.bank_name', { defaultValue: 'Bank name' })}</label>
                                    <input
                                      type="text"
                                      value={newBankDestination.customBankName}
                                      onChange={(e) =>
                                        setNewBankDestination((p) => ({ ...p, customBankName: e.target.value }))
                                      }
                                      className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                      placeholder={t('payouts_page.bank_name_placeholder', { defaultValue: 'Enter your bank name' })}
                                    />
                                  </div>
                                ) : null}

                                <div>
                                  <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.account_number', { defaultValue: 'Account number' })}</label>
                                  <input
                                    type="text"
                                    value={newBankDestination.accountNumber}
                                    onChange={(e) => setNewBankDestination((p) => ({ ...p, accountNumber: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                    placeholder="1234567890"
                                  />
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.account_holder_name', { defaultValue: 'Account holder name' })}</label>
                                  <input
                                    type="text"
                                    value={newBankDestination.accountHolder}
                                    onChange={(e) => setNewBankDestination((p) => ({ ...p, accountHolder: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                    placeholder={t('payouts_page.account_holder_placeholder', { defaultValue: 'Your legal name' })}
                                  />
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.routing_number_optional', { defaultValue: 'Routing number (optional)' })}</label>
                                  <input
                                    type="text"
                                    aria-label={t('payouts_page.routing_number', { defaultValue: 'Routing number' })}
                                    value={newBankDestination.routingNumber}
                                    onChange={(e) => setNewBankDestination((p) => ({ ...p, routingNumber: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                    placeholder=""
                                  />
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.swift_code_optional', { defaultValue: 'SWIFT code (optional)' })}</label>
                                  <input
                                    type="text"
                                    aria-label={t('payouts_page.swift_code', { defaultValue: 'SWIFT code' })}
                                    value={newBankDestination.swiftCode}
                                    onChange={(e) => setNewBankDestination((p) => ({ ...p, swiftCode: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                                    placeholder=""
                                  />
                                </div>

                                <button
                                  type="button"
                                  onClick={addBankDestination}
                                  disabled={isAddingBankDestination}
                                  className="w-full px-4 py-2 rounded-lg bg-white/[0.055] text-white/80 font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isAddingBankDestination ? t('payouts_page.adding', { defaultValue: 'Adding…' }) : t('payouts_page.add_bank_account', { defaultValue: 'Add bank account' })}
                                </button>

                                <p className="!text-xs text-white/50">
                                  {t('payouts_page.bank_doc_note', { defaultValue: "You'll need to submit a bank statement or void check for each bank account." })}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {!isStripeConnectAccount && config?.method === 'mobile_money' && hasPayoutSetup && (
                    <div className="pt-3 border-t border-white/10">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="text-sm font-medium text-white">{t('payouts_page.phone_number', { defaultValue: 'Phone number' })}</div>
                          <div className="text-sm text-white/60">
                            {phoneStatus === 'verified'
                              ? t('payouts_page.status_verified', { defaultValue: 'Verified' })
                              : phoneStatus === 'failed'
                                ? t('payouts_page.status_needs_attention', { defaultValue: 'Needs attention' })
                                : t('payouts_page.status_pending', { defaultValue: 'Pending' })}
                          </div>
                        </div>
                      </div>

                      {phoneStatus !== 'verified' && (
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={sendPhoneVerificationCode}
                            disabled={isSendingPhoneCode}
                            className="w-full px-4 py-2 rounded-lg bg-white/[0.055] text-white/80 font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSendingPhoneCode ? t('payouts_page.sending', { defaultValue: 'Sending…' }) : t('payouts_page.send_verification_code', { defaultValue: 'Send verification code' })}
                          </button>

                          <div>
                            <label className="block text-sm font-medium text-white/70 mb-1">{t('payouts_page.enter_6_digit_code', { defaultValue: 'Enter 6-digit code' })}</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={phoneVerificationCode}
                              onChange={(e) => setPhoneVerificationCode(e.target.value)}
                              placeholder="123456"
                              className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={submitPhoneVerificationCode}
                            disabled={isSubmittingPhoneCode}
                            className="w-full px-4 py-2 rounded-lg bg-white/[0.055] text-white/80 font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSubmittingPhoneCode ? t('payouts_page.verifying', { defaultValue: 'Verifying…' }) : t('payouts_page.verify_phone', { defaultValue: 'Verify phone' })}
                          </button>

                          {phoneVerificationMessage && (
                            <div className="text-sm text-white/60">{phoneVerificationMessage}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <p className="!text-xs text-white/50 mt-4">
                  {t('payouts_page.verification_required_note', { defaultValue: 'Verification is required to receive payouts and publish paid events.' })}
                </p>
              </div>
            </div>

            </div>
            
            {/* Payout Setup Card */}
            <div className="order-2 overflow-hidden rounded-2xl bg-white/[0.03]">
              <div className="p-6">
                <SectionHeader
                  className="mb-4"
                  title={t('payouts_page.payout_setup', { defaultValue: 'Payout setup' })}
                />

                {/* 0.055, not 0.03: an inset repeating the card's own fill is the
                    page colour twice over and renders as nothing. */}
                {isStripeConnectSelection ? (
                  <div className="mb-4 rounded-lg p-3 sm:p-4 bg-white/[0.055]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Stripe Connect</p>
                        <p className="!text-[12px] sm:!text-sm text-white/60 mt-1">
                          {t('payouts_page.stripe_connect_desc', { defaultValue: 'Connect your Stripe account to receive payouts to your bank.' })}
                        </p>
                      </div>
                      <StatusChip tone={getStripeBadge().tone}>{getStripeBadge().label}</StatusChip>
                    </div>

                    {stripeStatusError ? (
                      <div className="mt-3 text-sm text-red-300">{stripeStatusError}</div>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      {!stripeStatus?.connected ? (
                        <button
                          type="button"
                          onClick={startStripeOnboarding}
                          className="px-3 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800"
                        >
                          {t('payouts_page.connect_with_stripe', { defaultValue: 'Connect with Stripe' })}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={startStripeOnboarding}
                            className="px-3 py-2 rounded-lg bg-white/[0.09] text-white/80 text-sm font-medium transition-colors hover:bg-white/[0.14]"
                          >
                            {t('payouts_page.continue_onboarding', { defaultValue: 'Continue onboarding' })}
                          </button>
                          <button
                            type="button"
                            onClick={openStripeDashboard}
                            className="px-3 py-2 rounded-lg bg-white/[0.09] text-white/80 text-sm font-medium transition-colors hover:bg-white/[0.14]"
                          >
                            {t('payouts_page.manage_in_stripe', { defaultValue: 'Manage in Stripe' })}
                          </button>
                        </>
                      )}

                      {isLoadingStripeStatus ? (
                        <span className="text-sm text-white/50 self-center">{t('payouts_page.loading', { defaultValue: 'Loading…' })}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {isHaiti &&
                String(formData.method || '').toLowerCase() === 'mobile_money' &&
                selectedProvider === 'moncash' ? (
                  <div className="mb-4 rounded-lg p-3 sm:p-4 bg-white/[0.055]">
                    <p className="text-sm font-semibold text-white">{t('payouts_page.instant_moncash_title', { defaultValue: 'Instant MonCash (prefunding)' })}</p>
                    <p className="!text-[12px] sm:!text-sm text-white/60 mt-1">
                      {t('payouts_page.instant_moncash_desc', { min: MONCASH_MIN_LABEL, defaultValue: INSTANT_MONCASH_DESC_FALLBACK })}
                    </p>

                    {prefundingError ? (
                      <div className="mt-2 text-sm text-red-300">{prefundingError}</div>
                    ) : null}

                    {prefunding ? (
                      <div className="mt-2 text-[12px] sm:text-sm text-white/70">
                        {t('payouts_page.prefunding_status', { status: prefunding.enabled && prefunding.available ? t('payouts_page.prefunding_available', { defaultValue: 'Available' }) : prefunding.enabled ? t('payouts_page.prefunding_unavailable', { defaultValue: 'Temporarily unavailable' }) : t('payouts_page.prefunding_disabled', { defaultValue: 'Disabled' }), defaultValue: 'Status: {{status}}' })}
                      </div>
                    ) : (
                      <div className="mt-2 text-[12px] sm:text-sm text-white/50">{t('payouts_page.loading', { defaultValue: 'Loading…' })}</div>
                    )}

                    <label className="mt-3 flex items-center gap-2 text-sm text-white">
                      <input
                        type="checkbox"
                        checked={Boolean(config?.allowInstantMoncash)}
                        disabled={!prefunding?.enabled || !prefunding?.available}
                        onChange={async (e) => {
                          try {
                            const result = await updatePayoutProfileConfig('haiti' as any, { allowInstantMoncash: e.target.checked } as any)
                            if (!result?.success) {
                              if (result?.requiresVerification) {
                                setPendingSensitiveUpdate({
                                  kind: 'profile_update',
                                  updates: { allowInstantMoncash: e.target.checked },
                                })
                                setPayoutChangeVerificationRequired(true)
                                setPayoutChangeMessage(t('payouts_page.stepup_msg_profile', { defaultValue: 'For your security, confirm this payout change with the code we email you.' }))
                                return
                              }
                              throw new Error(result?.error || t('payouts_page.error_update_setting', { defaultValue: 'Failed to update setting' }))
                            }
                            router.refresh()
                          } catch {
                            setError(t('payouts_page.error_update_prefunding', { defaultValue: 'Failed to update prefunding preference' }))
                          }
                        }}
                        className="h-4 w-4 accent-brand-500"
                      />
                      {t('payouts_page.allow_instant_moncash', { defaultValue: 'Allow instant MonCash withdrawals when available' })}
                    </label>
                  </div>
                ) : null}

                {/* Checklist + Setup Guidance */}


                {!isEditing && hasPayoutSetup ? (
                  // Summary View
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-medium text-white/50 mb-1">{t('payouts_page.location', { defaultValue: 'Location' })}</div>
                      <div className="text-base text-white">
                        {formatLocationLabel(
                          config?.accountLocation || 
                          config?.bankDetails?.accountLocation || 
                          (activeProfile === 'stripe_connect' ? 'united_states' : 'haiti')
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium text-white/50 mb-1">{t('payouts_page.method', { defaultValue: 'Method' })}</div>
                      <div className="text-base text-white">
                        {isStripeConnectAccount ? (
                          <>Stripe Connect</>
                        ) : config?.method === 'bank_transfer' ? (
                          (() => {
                            if (isHaiti) {
                              const destinations = bankDestinations || []
                              const primary = destinations.find((d) => d.isPrimary) || destinations[0] || null
                              if (primary) {
                                return (
                                  <>
                                    {t('payouts_page.bank_transfer', { defaultValue: 'Bank transfer' })} · {primary.bankName} · <span className="font-mono">****{primary.accountNumberLast4}</span>
                                  </>
                                )
                              }
                            }

                            return (
                              <>
                                {t('payouts_page.bank_transfer', { defaultValue: 'Bank transfer' })} · {config?.bankDetails?.bankName || t('payouts_page.bank', { defaultValue: 'Bank' })} ·{' '}
                                <span className="font-mono">
                                  ****{config?.bankDetails?.accountNumberLast4 || config?.bankDetails?.accountNumber?.slice(-4) || '----'}
                                </span>
                              </>
                            )
                          })()
                        ) : (
                          <>
                            {t('payouts_page.mobile_money', { defaultValue: 'Mobile money' })} · {config?.mobileMoneyDetails?.provider || t('payouts_page.provider', { defaultValue: 'Provider' })} ·{' '}
                            <span className="font-mono">
                              ****{config?.mobileMoneyDetails?.phoneNumberLast4 || config?.mobileMoneyDetails?.phoneNumber?.slice(-4) || '----'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-white/60 pt-2">
                      {isStripeConnectAccount
                        ? t('payouts_page.payouts_via_stripe', { defaultValue: 'Your payouts are handled through Stripe Connect.' })
                        : t('payouts_page.payouts_to_this_account', { defaultValue: 'Your payouts will be sent to this account.' })}
                    </p>

                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="w-full px-4 py-2 rounded-lg bg-white/[0.055] text-white/80 font-medium hover:bg-white/[0.12] transition-colors"
                    >
                      {t('payouts_page.edit_payout_details', { defaultValue: 'Edit payout details' })}
                    </button>
                  </div>
                ) : (
                  // Form View
                  <div className="space-y-4">
                    {/* Account Location */}
                    <div>
                      <label className="block text-sm font-medium text-white/70 mb-2">
                        {t('payouts_page.account_location', { defaultValue: 'Account location' })} <span className="text-red-500">*</span>
                      </label>
                      <select
                        aria-label={t('payouts_page.account_location', { defaultValue: 'Account location' })}
                        value={formData.accountLocation}
                        onChange={(e) => {
                          const nextLocation = e.target.value
                          if (activeProfile === 'haiti') {
                            setFormData({
                              ...formData,
                              accountLocation: 'haiti',
                            })
                            return
                          }

                          const wantsStripe = nextLocation === 'united_states' || nextLocation === 'canada'
                          setFormData({
                            ...formData,
                            accountLocation: wantsStripe ? nextLocation : 'united_states',
                            method: 'bank_transfer',
                          })
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                      >
                        {activeProfile === 'haiti' ? (
                          <option value="haiti">{t('payouts_page.country_haiti', { defaultValue: 'Haiti' })}</option>
                        ) : (
                          <>
                            <option value="united_states">{t('payouts_page.country_united_states', { defaultValue: 'United States' })}</option>
                            <option value="canada">{t('payouts_page.country_canada', { defaultValue: 'Canada' })}</option>
                          </>
                        )}
                      </select>

                      {activeProfile === 'stripe_connect' ? (
                        <p className="mt-1 !text-xs text-white/50">
                          {t('payouts_page.stripe_handles_us_ca_long', { defaultValue: 'US/Canada payouts are handled via Stripe Connect (no bank details required here).' })}
                        </p>
                      ) : null}
                    </div>

                    {/* Payout Method */}
                    {activeProfile === 'haiti' ? (
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">
                          {t('payouts_page.payout_method', { defaultValue: 'Payout method' })} <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-2">
                          <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${formData.method === 'bank_transfer' ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50' : 'bg-white/[0.055] hover:bg-white/[0.12]'}`}>
                            <input
                              type="radio"
                              name="method"
                              value="bank_transfer"
                              checked={formData.method === 'bank_transfer'}
                              onChange={(e) => setFormData({ ...formData, method: e.target.value as any })}
                              className="h-4 w-4 accent-brand-500"
                            />
                            <span className="text-sm font-medium text-white">{t('payouts_page.bank_transfer', { defaultValue: 'Bank transfer' })}</span>
                          </label>
                          <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${formData.method === 'mobile_money' ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50' : 'bg-white/[0.055] hover:bg-white/[0.12]'}`}>
                            <input
                              type="radio"
                              name="method"
                              value="mobile_money"
                              checked={formData.method === 'mobile_money'}
                              onChange={(e) => setFormData({ ...formData, method: e.target.value as any })}
                              className="h-4 w-4 accent-brand-500"
                            />
                            <span className="text-sm font-medium text-white">{t('payouts_page.mobile_money', { defaultValue: 'Mobile money' })}</span>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-white/[0.055] rounded-lg text-sm text-white/70">
                        {t('payouts_page.stripe_collects_bank_long', { defaultValue: "Stripe Connect will collect your bank details securely. You don't need to enter any bank information on Tikèm." })}
                      </div>
                    )}

                    {/* Bank Transfer Fields */}
                    {activeProfile === 'haiti' && formData.method === 'bank_transfer' ? (
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">
                          {t('payouts_page.bank_account', { defaultValue: 'Bank account' })} <span className="text-red-500">*</span>
                        </label>

                        {isLoadingBankDestinations ? (
                          <div className="text-sm text-white/50">{t('payouts_page.loading_saved_banks', { defaultValue: 'Loading saved bank accounts…' })}</div>
                        ) : null}

                        {bankDestinations && bankDestinations.length ? (
                          <select
                            aria-label={t('payouts_page.select_bank_account', { defaultValue: 'Select bank account' })}
                            value={selectedBankDestinationId}
                            onChange={(e) => setSelectedBankDestinationId(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                          >
                            {bankDestinations.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.bankName} • ****{d.accountNumberLast4}{d.isPrimary ? t('payouts_page.primary_suffix', { defaultValue: ' (Primary)' }) : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-sm text-white/60">
                            {t('payouts_page.no_banks_verification_section', { defaultValue: 'No bank accounts saved yet. Add one in the verification section.' })}
                          </div>
                        )}

                        {bankDestinationsError ? (
                          <div className="text-xs text-red-300 mt-1">{bankDestinationsError}</div>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById('verify-payouts')
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                          className="mt-2 text-sm font-medium text-brand-300 transition-colors hover:text-brand-200"
                        >
                          {t('payouts_page.manage_bank_accounts', { defaultValue: 'Add / manage bank accounts' })}
                        </button>
                      </div>
                    ) : null}

                    {/* Mobile Money Fields */}
                    {formData.method === 'mobile_money' && activeProfile === 'haiti' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-white/70 mb-2">
                            {t('payouts_page.provider', { defaultValue: 'Provider' })}
                          </label>
                          <select
                            aria-label={t('payouts_page.provider', { defaultValue: 'Provider' })}
                            value={formData.provider}
                            onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                          >
                            <option value="moncash">MonCash</option>
                            {NATCASH_ENABLED && <option value="natcash">Natcash</option>}
                          </select>
                        </div>

                        {Boolean(config?.mobileMoneyDetails?.phoneNumberLast4) && !isChangingMobileNumber ? (
                          <div className="rounded-lg p-3 bg-white/[0.055]">
                            <div className="text-sm text-white font-medium">{t('payouts_page.saved_phone_number', { defaultValue: 'Saved phone number' })}</div>
                            <div className="text-sm text-white/70 mt-1">
                              ****{config?.mobileMoneyDetails?.phoneNumberLast4}
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsChangingMobileNumber(true)}
                              className="mt-2 text-sm font-medium text-brand-300 transition-colors hover:text-brand-200"
                            >
                              {t('payouts_page.change_number', { defaultValue: 'Change number' })}
                            </button>
                          </div>
                        ) : (
                          <div>
                            <label className="block text-sm font-medium text-white/70 mb-2">{t('payouts_page.phone_number', { defaultValue: 'Phone number' })}</label>
                            <input
                              type="tel"
                              value={formData.phoneNumber}
                              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                              placeholder="+50912345678"
                              className="w-full px-3 py-2 rounded-lg bg-white/[0.055] text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
                            />
                            {Boolean(config?.mobileMoneyDetails?.phoneNumberLast4) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsChangingMobileNumber(false)
                                  setFormData((p) => ({ ...p, phoneNumber: '' }))
                                }}
                                className="mt-2 text-sm font-medium text-white/60 hover:text-white/70"
                              >
                                {t('payouts_page.use_saved_number', { defaultValue: 'Use saved number instead' })}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}

                    {error && (
                      <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
                        {error}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => handleSavePayoutDetails()}
                        disabled={isSaving || payoutChangeVerificationRequired}
                        className="flex-1 px-4 py-2 bg-brand-700 text-white rounded-lg font-medium hover:bg-brand-800 transition-colors disabled:bg-white/20 disabled:cursor-not-allowed"
                      >
                        {isSaving
                          ? (activeProfile === 'stripe_connect' ? t('payouts_page.opening_stripe', { defaultValue: 'Opening Stripe…' }) : t('payouts_page.saving', { defaultValue: 'Saving…' }))
                          : (activeProfile === 'stripe_connect' ? t('payouts_page.continue_to_stripe', { defaultValue: 'Continue to Stripe' }) : t('payouts_page.save_payout_details', { defaultValue: 'Save payout details' }))}
                      </button>
                      {hasPayoutSetup && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditing(false)
                            setError(null)
                            setPayoutChangeVerificationRequired(false)
                            setPendingSensitiveUpdate(null)
                            setPayoutChangeCode('')
                            setPayoutChangeMessage(null)
                          }}
                          disabled={isSaving}
                          className="px-4 py-2 rounded-lg bg-white/[0.055] text-white/80 font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('payouts_page.cancel', { defaultValue: 'Cancel' })}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            </>
          )}

          </div>

          {/* The "Earnings + Payouts" right column was here — 185 lines of an
              earnings-by-event table and a payouts summary. It was already
              dead: both call sites pass showEarningsAndPayouts={false}, so it
              had not rendered in a long time, and /organizer/finance now owns
              that view properly (against the balance a withdrawal is actually
              judged against). Removed rather than left as a second, drifting
              copy of the same numbers; the link below goes to the real one. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
            <p className="!text-[13px] text-white/45">
              {t('payouts_page.earnings_moved', {
                defaultValue: 'Looking for what you’ve earned and what’s been paid out?',
              })}
            </p>
            <Link
              href="/organizer/finance"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/80 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white"
            >
              {t('payouts_page.go_to_finance', { defaultValue: 'Go to Finance' })}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
