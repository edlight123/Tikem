'use client'

import { useState, useEffect } from 'react'
import { 
  ArrowLeft, 
  ArrowRight, 
  Globe, 
  Building2, 
  Smartphone, 
  Check, 
  Loader2,
  CreditCard,
  Shield,
  Wallet,
  MapPin,
  AlertCircle,
  Sparkles
} from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
// Same server actions the advanced payouts page (PayoutsPageNew) saves through.
// There is no /api/organizer/payout-profile-config route: the wizard used to
// POST there and 404'd, so nobody could finish setup from it.
import { updateDeclaredMarkets, updatePayoutProfileConfig } from '@/app/organizer/settings/payouts/actions'
import type { PayoutConfig } from '@/lib/firestore/payout'
import { COUNTRY_SUPPORT } from '@/lib/country-support'
import {
  DECLARABLE_MARKETS,
  normalizeDeclaredMarkets,
  railsForMarkets,
} from '@/lib/organizer-markets'

interface PayoutsSetupWizardProps {
  organizerId: string
  organizerDefaultCountry?: string
  /** Countries already declared, if any. UI hint only — see lib/organizer-markets.ts. */
  declaredMarkets?: string[]
  onComplete: () => void
  onExit: () => void
}

const SUPPORTED_LOCATIONS = [
  { id: 'haiti', name: 'Haiti', flag: 'HT', methods: ['bank_transfer', 'mobile_money'] },
  { id: 'united_states', name: 'United States', flag: 'US', methods: ['stripe'] },
  { id: 'canada', name: 'Canada', flag: 'CA', methods: ['stripe'] },
  // /api/organizer/stripe/connect onboards FR accounts (country 'FR').
  { id: 'france', name: 'France', flag: 'FR', methods: ['stripe'] },
]

/** Locations paid out through Stripe Connect (everything except Haiti). */
const STRIPE_LOCATIONS = new Set(['united_states', 'canada', 'france'])

const HAITI_BANKS = [
  { value: 'unibank', label: 'Unibank' },
  { value: 'sogebank', label: 'Sogebank' },
  { value: 'bnc', label: 'BNC (Banque Nationale de Crédit)' },
  { value: 'capital_bank', label: 'Capital Bank' },
  { value: 'citibank', label: 'Citibank Haiti' },
  { value: 'scotiabank', label: 'Scotiabank' },
  { value: 'other', label: 'Other Bank' }
]

// Haiti payouts are MonCash or bank transfer only (owner decision 2026-10-10).
// NatCash stays behind this flag so the code path still compiles; mirrors
// NATCASH_ENABLED in PayoutsPageNew, BuyTicketButton and the mobile app.
const NATCASH_ENABLED = false

const MOBILE_PROVIDERS = [
  { value: 'moncash', label: 'MonCash', icon: Smartphone },
  ...(NATCASH_ENABLED ? [{ value: 'natcash', label: 'NatCash', icon: CreditCard }] : []),
]

const providerLabel = (value: string) =>
  MOBILE_PROVIDERS.find((p) => p.value === value)?.label || 'MonCash'

/** +509 followed by 8 digits. Accepts "3412 3456", "50934123456", "+509 3412-3456". */
function normalizeHaitiPhone(raw: string): string {
  const compact = String(raw || '').replace(/[\s\-().]/g, '')
  if (!compact) return ''
  if (compact.startsWith('+')) return compact
  if (compact.startsWith('00509')) return `+${compact.slice(2)}`
  if (compact.startsWith('509') && compact.length === 11) return `+${compact}`
  if (/^\d{8}$/.test(compact)) return `+509${compact}`
  return compact
}

const inputClass = (fieldError?: string) =>
  `w-full rounded-xl bg-white/[0.07] px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
    fieldError ? 'ring-1 ring-inset ring-red-500/60' : ''
  }`

type FieldKey = 'bankName' | 'customBankName' | 'accountName' | 'accountNumber' | 'routingNumber' | 'phoneNumber'

type Step = 'welcome' | 'markets' | 'location' | 'method' | 'details' | 'review'

export default function PayoutsSetupWizard({
  organizerId,
  organizerDefaultCountry,
  declaredMarkets,
  onComplete,
  onExit,
}: PayoutsSetupWizardProps) {
  const { t } = useTranslation('organizer')
  const [currentStep, setCurrentStep] = useState<Step>('welcome')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Per-field messages for the details step, shown under each input.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  // Changing an EXISTING payout method needs an emailed code (payout step-up).
  // The wizard has no code UI, so it hands off to the advanced page, which does.
  const [needsStepUp, setNeedsStepUp] = useState(false)

  // Where the organizer says they'll run events. Asked FIRST, because it is what
  // decides whether Stripe is ever mentioned to them at all. Saving it is
  // best-effort: a failed write must not block them from setting up a payout.
  const [markets, setMarkets] = useState<string[]>(() => normalizeDeclaredMarkets(declaredMarkets))
  const [savingMarkets, setSavingMarkets] = useState(false)
  const declaredRails = railsForMarkets(markets)
  const showStripeLocations = declaredRails.length === 0 || declaredRails.includes('stripe_connect')
  const showHaitiLocation = declaredRails.length === 0 || declaredRails.includes('haiti')
  const availableLocations = SUPPORTED_LOCATIONS.filter((location) =>
    location.id === 'haiti' ? showHaitiLocation : showStripeLocations
  )

  // Form state
  const [selectedLocation, setSelectedLocation] = useState(() => {
    const country = organizerDefaultCountry?.toLowerCase()
    if (country === 'us' || country === 'united_states') return 'united_states'
    if (country === 'ca' || country === 'canada') return 'canada'
    if (country === 'fr' || country === 'france') return 'france'
    return 'haiti'
  })
  const [selectedMethod, setSelectedMethod] = useState<'bank_transfer' | 'mobile_money' | 'stripe'>('bank_transfer')
  
  // Bank details
  const [bankForm, setBankForm] = useState({
    bankName: 'unibank',
    customBankName: '',
    accountName: '',
    accountNumber: '',
    routingNumber: '',
  })
  
  // Mobile money details
  const [mobileForm, setMobileForm] = useState({
    provider: 'moncash',
    phoneNumber: '',
    accountName: '',
  })

  const locationData = SUPPORTED_LOCATIONS.find(l => l.id === selectedLocation)
  const isStripeLocation = STRIPE_LOCATIONS.has(selectedLocation)

  // Auto-set method when location changes
  useEffect(() => {
    if (isStripeLocation) {
      setSelectedMethod('stripe')
    } else {
      setSelectedMethod('bank_transfer')
    }
  }, [selectedLocation, isStripeLocation])

  const steps: { id: Step; title: string }[] = [
    { id: 'welcome', title: 'Welcome' },
    { id: 'markets', title: 'Markets' },
    { id: 'location', title: 'Location' },
    { id: 'method', title: 'Method' },
    { id: 'details', title: 'Details' },
    { id: 'review', title: 'Review' },
  ]

  const currentStepIndex = steps.findIndex(s => s.id === currentStep)
  const progressPercentage = ((currentStepIndex + 1) / steps.length) * 100

  const goToStep = (step: Step) => {
    setError('')
    setCurrentStep(step)
  }

  const handleNext = () => {
    setError('')
    // Validate the step being left, so a bad field is caught where it was
    // typed, not three screens later on Review.
    if (!validateStep(currentStep)) return
    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id)
    }
  }

  const handleBack = () => {
    setError('')
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id)
    }
  }

  const handleMarketsContinue = async () => {
    setSavingMarkets(true)
    try {
      await updateDeclaredMarkets(markets)
    } catch {
      // Best effort. The declaration shapes the UI; it is never a prerequisite
      // for setting up a payout method, so a failed write must not stop them.
    } finally {
      setSavingMarkets(false)
    }

    // Never leave them parked on a location the declaration just stopped showing.
    const stillAvailable = SUPPORTED_LOCATIONS.filter((location) => {
      const rails = railsForMarkets(markets)
      if (rails.length === 0) return true
      return location.id === 'haiti' ? rails.includes('haiti') : rails.includes('stripe_connect')
    })
    if (!stillAvailable.some((l) => l.id === selectedLocation)) {
      setSelectedLocation(stillAvailable[0]?.id || 'haiti')
    }

    handleNext()
  }

  const clearFieldError = (key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  /** Haiti bank / MonCash field errors for the current form, without side effects. */
  const computeMethodErrors = (): Partial<Record<FieldKey, string>> => {
    const errs: Partial<Record<FieldKey, string>> = {}
    if (selectedMethod === 'bank_transfer') {
      if (!bankForm.bankName) {
        errs.bankName = t('onboarding.payouts.errors.select_bank', { defaultValue: 'Please select a bank' })
      }
      if (bankForm.bankName === 'other' && bankForm.customBankName.trim().length < 2) {
        errs.customBankName = t('onboarding.payouts.errors.bank_name_required', { defaultValue: 'Please enter your bank name' })
      }
      if (bankForm.accountName.trim().length < 2) {
        errs.accountName = t('onboarding.payouts.errors.account_holder_required', { defaultValue: 'Please enter the account holder name' })
      }
      const accountNumber = bankForm.accountNumber.replace(/[\s-]/g, '')
      if (!accountNumber) {
        errs.accountNumber = t('onboarding.payouts.errors.account_number_required', { defaultValue: 'Please enter your account number' })
      } else if (!/^[A-Za-z0-9]{4,34}$/.test(accountNumber)) {
        errs.accountNumber = t('onboarding.payouts.errors.account_number_invalid', { defaultValue: 'Enter a valid account number (letters and digits only, 4 to 34 characters)' })
      }
      const routing = bankForm.routingNumber.trim()
      if (routing && !/^[A-Za-z0-9\s-]{3,20}$/.test(routing)) {
        errs.routingNumber = t('onboarding.payouts.errors.routing_invalid', { defaultValue: 'Enter a valid routing number, or leave it empty' })
      }
    } else if (selectedMethod === 'mobile_money') {
      if (!mobileForm.phoneNumber.trim()) {
        errs.phoneNumber = t('onboarding.payouts.errors.phone_required', { defaultValue: 'Please enter your phone number' })
      } else if (!/^\+509\d{8}$/.test(normalizeHaitiPhone(mobileForm.phoneNumber))) {
        errs.phoneNumber = t('onboarding.payouts.errors.phone_invalid', { defaultValue: 'Please enter a valid Haiti phone number (e.g., +509 1234 5678)' })
      }
    }
    return errs
  }

  /** On blur: check just the field they left, so untouched fields stay quiet. */
  const validateField = (key: FieldKey) => {
    const message = computeMethodErrors()[key]
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }

  /** All Haiti bank / MonCash fields. Sets per-field messages; returns validity. */
  const validateMethod = (): boolean => {
    const errs = computeMethodErrors()
    setFieldErrors(errs)
    const first = Object.values(errs)[0]
    if (first) {
      setError(first)
      return false
    }
    return true
  }

  const validateStep = (step: Step): boolean => {
    if (step === 'location') {
      if (!availableLocations.some((l) => l.id === selectedLocation)) {
        setError(t('onboarding.payouts.errors.select_location', { defaultValue: 'Please choose where your bank is located' }))
        return false
      }
      return true
    }
    if (step === 'method') {
      const ok = isStripeLocation ? selectedMethod === 'stripe' : selectedMethod === 'bank_transfer' || selectedMethod === 'mobile_money'
      if (!ok) {
        setError(t('onboarding.payouts.errors.select_method', { defaultValue: 'Please choose how you want to be paid' }))
        return false
      }
      return true
    }
    if (step === 'details' && !isStripeLocation) {
      return validateMethod()
    }
    return true
  }

  /** A failed save from the server action, mapped to what the organizer can do. */
  const failSave = (result: { error?: string; requiresVerification?: boolean } | undefined, fallback: string): never => {
    if (result?.requiresVerification) {
      setNeedsStepUp(true)
      throw new Error(t('onboarding.payouts.errors.step_up_required', { defaultValue: 'For your security, changing an existing payout method needs a code we email you. Finish this change in advanced payout settings.' }))
    }
    throw new Error(result?.error || fallback)
  }

  const handleSubmit = async () => {
    setNeedsStepUp(false)
    if (!isStripeLocation && !validateMethod()) {
      // Send them back to the screen with the bad field.
      setCurrentStep('details')
      return
    }

    try {
      setSaving(true)
      setError('')

      // US / Canada / France: record the Stripe profile, then hand off to Stripe
      // onboarding. Same two calls the advanced page makes (PayoutsPageNew).
      if (isStripeLocation) {
        const stripeSetupUpdate: Partial<PayoutConfig> = {
          accountLocation: selectedLocation,
          payoutProvider: 'stripe_connect',
          method: 'bank_transfer',
        }
        const configResult = await updatePayoutProfileConfig('stripe_connect', stripeSetupUpdate)
        if (!configResult?.success) {
          failSave(configResult, t('onboarding.payouts.errors.save_config_failed', { defaultValue: 'Failed to save configuration' }))
        }

        const stripeRes = await fetch('/api/organizer/stripe/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountLocation: selectedLocation }),
        })

        const stripeData = await stripeRes.json().catch(() => ({}))
        if (!stripeRes.ok) {
          throw new Error(stripeData?.error || stripeData?.message || t('onboarding.payouts.errors.stripe_start_failed', { defaultValue: 'Failed to start Stripe setup' }))
        }

        if (stripeData?.url) {
          window.location.href = stripeData.url
          return
        }
        throw new Error(t('onboarding.payouts.errors.stripe_url_missing', { defaultValue: 'Missing Stripe onboarding URL' }))
      }

      // Haiti: bank transfer or MonCash, saved on the 'haiti' payout profile.
      const updates: Partial<PayoutConfig> = {
        accountLocation: 'haiti',
        method: selectedMethod === 'mobile_money' ? 'mobile_money' : 'bank_transfer',
      }

      if (selectedMethod === 'bank_transfer') {
        updates.bankDetails = {
          accountLocation: 'haiti',
          bankName: bankForm.bankName === 'other' ? bankForm.customBankName.trim() : bankForm.bankName,
          accountName: bankForm.accountName.trim(),
          accountNumber: bankForm.accountNumber.replace(/[\s-]/g, ''),
          routingNumber: bankForm.routingNumber.trim(),
        }
      } else {
        const phoneNumber = normalizeHaitiPhone(mobileForm.phoneNumber)
        const provider = NATCASH_ENABLED && mobileForm.provider === 'natcash' ? 'natcash' : 'moncash'
        updates.mobileMoneyDetails = {
          provider,
          phoneNumber,
          accountName: mobileForm.accountName.trim() || phoneNumber,
        }
        updates.payoutProvider = provider
      }

      const result = await updatePayoutProfileConfig('haiti', updates)
      if (!result?.success) {
        failSave(result, t('onboarding.payouts.errors.save_payout_failed', { defaultValue: 'Failed to save payout details' }))
      }

      onComplete()
    } catch (err: any) {
      setError(err?.message || t('onboarding.payouts.errors.generic', { defaultValue: 'Something went wrong. Please try again.' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-[80vh]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        {currentStep !== 'welcome' && (
          <div className="mb-8">
            <button
              onClick={onExit}
              className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('onboarding.payouts.save_exit', { defaultValue: 'Save & Exit' })}
            </button>

            {/* Progress Bar */}
            <div className="bg-white/[0.055] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-white">
                  {t('onboarding.payouts.progress_title', { defaultValue: 'Setting up payouts' })}
                </span>
                <span className="text-xs text-white/50">
                  {t('onboarding.payouts.step_of', {
                    defaultValue: 'Step {{current}} of {{total}}',
                    current: currentStepIndex + 1,
                    total: steps.length,
                  })}
                </span>
              </div>
              <div className="flex gap-2">
                {steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`flex-1 h-2 rounded-full transition-colors ${
                      idx <= currentStepIndex ? 'bg-white' : 'bg-white/[0.08]'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-200">
              <p>{error}</p>
              {needsStepUp ? (
                <Link
                  href={`/organizer/settings/payouts?view=advanced&edit=${isStripeLocation ? 'stripe_connect' : 'haiti'}`}
                  className="mt-2 inline-flex items-center gap-1 font-semibold text-white underline underline-offset-2"
                >
                  {t('onboarding.payouts.errors.step_up_cta', { defaultValue: 'Open advanced payout settings' })}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              ) : null}
            </div>
          </div>
        )}

        {/* Welcome Step */}
        {currentStep === 'welcome' && (
          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/[0.07] flex items-center justify-center">
              <Wallet className="w-10 h-10 text-white" />
            </div>
            <h1 className="font-display lowercase italic !text-[32px] !leading-tight text-white mb-3">
              {t('onboarding.payouts.welcome.title', { defaultValue: 'Get paid for your events' })}
            </h1>
            <p className="text-lg text-white/60 mb-8 max-w-md mx-auto">
              {t('onboarding.payouts.welcome.subtitle', { defaultValue: 'Set up your payout method to receive earnings from ticket sales quickly and securely.' })}
            </p>

            {/* Benefits */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white/[0.055] rounded-2xl p-4 text-left">
                <div className="w-10 h-10 rounded-xl bg-white/[0.07] flex items-center justify-center mb-3">
                  <Shield className="w-5 h-5 text-white/80" />
                </div>
                <h3 className="font-semibold text-white mb-1">{t('onboarding.payouts.welcome.secure_title', { defaultValue: 'Secure' })}</h3>
                <p className="text-sm text-white/60">{t('onboarding.payouts.welcome.secure_desc', { defaultValue: 'Bank-level encryption protects your data' })}</p>
              </div>
              <div className="bg-white/[0.055] rounded-2xl p-4 text-left">
                <div className="w-10 h-10 rounded-xl bg-white/[0.07] flex items-center justify-center mb-3">
                  <Sparkles className="w-5 h-5 text-white/80" />
                </div>
                <h3 className="font-semibold text-white mb-1">{t('onboarding.payouts.welcome.fast_title', { defaultValue: 'Fast' })}</h3>
                <p className="text-sm text-white/60">{t('onboarding.payouts.welcome.fast_desc', { defaultValue: 'Funds become available to withdraw 72 hours after your event ends (24 hours once you’ve run 3 events or sold $1,000).' })}</p>
              </div>
              <div className="bg-white/[0.055] rounded-2xl p-4 text-left">
                <div className="w-10 h-10 rounded-xl bg-white/[0.07] flex items-center justify-center mb-3">
                  <Globe className="w-5 h-5 text-white/80" />
                </div>
                <h3 className="font-semibold text-white mb-1">{t('onboarding.payouts.welcome.flexible_title', { defaultValue: 'Flexible' })}</h3>
                <p className="text-sm text-white/60">{t('onboarding.payouts.welcome.flexible_desc', { defaultValue: 'Multiple payout methods available' })}</p>
              </div>
            </div>

            <button
              onClick={handleNext}
              className="px-8 py-3.5 bg-white text-black rounded-full font-semibold hover:bg-white/90 transition-all"
            >
              {t('onboarding.payouts.welcome.cta', { defaultValue: 'Set Up Payouts' })}
            </button>
          </div>
        )}

        {/* Markets Step — asked BEFORE anything about banks, because the answer
            decides whether Stripe is ever mentioned to this organizer at all.
            Skippable, and re-editable later from payout settings. */}
        {currentStep === 'markets' && (
          <div>
            <div className="text-center mb-8">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/[0.07] flex items-center justify-center">
                <Globe className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-display lowercase italic !text-[26px] !leading-snug text-white mb-2">{t('onboarding.payouts.markets.title', { defaultValue: 'Where will you run events?' })}</h2>
              <p className="text-white/60">
                {t('onboarding.payouts.markets.subtitle', { defaultValue: 'Pick every country you plan to hold events in. We’ll only set up the payout methods those countries use, and you can change this any time.' })}
              </p>
            </div>

            <div className="space-y-3 mb-6">
              {DECLARABLE_MARKETS.map((code) => {
                const isOn = markets.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() =>
                      setMarkets((current) =>
                        current.includes(code)
                          ? current.filter((c) => c !== code)
                          : [...current, code]
                      )
                    }
                    className={`w-full p-4 rounded-2xl transition-all flex items-center gap-4 ${
                      isOn ? 'ring-1 ring-inset ring-brand-400/50 bg-white/[0.08]' : 'bg-white/[0.055] hover:bg-white/[0.08]'
                    }`}
                  >
                    <div className="flex-1 text-left">
                      <div className="font-semibold text-white">
                        {COUNTRY_SUPPORT[code]?.name || code}
                      </div>
                      <div className="text-sm text-white/50">
                        {COUNTRY_SUPPORT[code]?.requiredProfile === 'stripe_connect'
                          ? t('onboarding.payouts.markets.rail_stripe', { defaultValue: 'Paid out through Stripe Connect' })
                          : COUNTRY_SUPPORT[code]?.requiredProfile === 'haiti'
                            ? t('onboarding.payouts.markets.rail_haiti', { defaultValue: 'Paid out by bank transfer or MonCash' })
                            : t('onboarding.payouts.markets.rail_none', { defaultValue: 'Free and RSVP events for now. Paid tickets coming soon' })}
                      </div>
                    </div>
                    {isOn && <Check className="w-5 h-5 text-brand-300" />}
                  </button>
                )
              })}
            </div>

            {declaredRails.length > 1 ? (
              <div className="mb-6 rounded-xl bg-white/[0.055] px-4 py-3 text-sm text-white/60">
                {t('onboarding.payouts.markets.two_rails_note', { defaultValue: 'Those markets use two different payout systems, so you’ll set up two separate methods. We’ll do one now. You can add the other straight after.' })}
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                className="px-4 py-2.5 text-white/70 hover:text-white hover:bg-white/[0.07] rounded-full transition-colors"
              >
                {t('onboarding.payouts.nav.back', { defaultValue: 'Back' })}
              </button>
              <button
                onClick={handleMarketsContinue}
                disabled={savingMarkets}
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full font-semibold hover:bg-white/90 transition-all disabled:opacity-60"
              >
                {savingMarkets ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {markets.length === 0
                  ? t('onboarding.payouts.nav.skip_for_now', { defaultValue: 'Skip for now' })
                  : t('onboarding.payouts.nav.continue', { defaultValue: 'Continue' })}
                {savingMarkets ? null : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Location Step */}
        {currentStep === 'location' && (
          <div>
            <div className="text-center mb-8">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/[0.07] flex items-center justify-center">
                <MapPin className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-display lowercase italic !text-[26px] !leading-snug text-white mb-2">{t('onboarding.payouts.location.title', { defaultValue: 'Where is your bank located?' })}</h2>
              <p className="text-white/60">{t('onboarding.payouts.location.subtitle', { defaultValue: 'This determines the payment methods available to you' })}</p>
            </div>

            <div className="space-y-3 mb-8">
              {availableLocations.map((location) => (
                <button
                  key={location.id}
                  onClick={() => setSelectedLocation(location.id)}
                  className={`w-full p-4 rounded-2xl transition-all flex items-center gap-4 ${
                    selectedLocation === location.id
                      ? 'ring-1 ring-inset ring-brand-400/50 bg-white/[0.08]'
                      : 'bg-white/[0.055] hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.08] text-xs font-semibold tracking-wide text-white/80">{location.flag}</span>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-white">{t(`onboarding.payouts.location.${location.id}`, { defaultValue: location.name })}</div>
                    <div className="text-sm text-white/50">
                      {location.methods.includes('stripe')
                        ? t('onboarding.payouts.location.method_stripe', { defaultValue: 'Bank transfers via Stripe' })
                        : t('onboarding.payouts.location.method_haiti', { defaultValue: 'Bank transfer or mobile money' })}
                    </div>
                  </div>
                  {selectedLocation === location.id && (
                    <Check className="w-5 h-5 text-brand-300" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                className="px-4 py-2.5 text-white/70 hover:text-white hover:bg-white/[0.07] rounded-full transition-colors"
              >
                {t('onboarding.payouts.nav.back', { defaultValue: 'Back' })}
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full font-semibold hover:bg-white/90 transition-all"
              >
                {t('onboarding.payouts.nav.continue', { defaultValue: 'Continue' })}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Method Step (only for Haiti) */}
        {currentStep === 'method' && (
          <div>
            <div className="text-center mb-8">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/[0.07] flex items-center justify-center">
                <CreditCard className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-display lowercase italic !text-[26px] !leading-snug text-white mb-2">
                {isStripeLocation
                  ? t('onboarding.payouts.method.title_stripe', { defaultValue: 'Payment Method' })
                  : t('onboarding.payouts.method.title_haiti', { defaultValue: 'How would you like to receive payouts?' })}
              </h2>
              <p className="text-white/60">
                {isStripeLocation
                  ? t('onboarding.payouts.method.subtitle_stripe', { defaultValue: 'Stripe Connect handles payouts for the US, Canada and France' })
                  : t('onboarding.payouts.method.subtitle_haiti', { defaultValue: 'Choose your preferred payout method' })}
              </p>
            </div>

            {isStripeLocation ? (
              <div className="bg-white/[0.055] rounded-2xl p-6 mb-8">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      <path d="M13.976 9.15c-2.172-.806-3.234-1.354-3.234-2.31 0-.788.636-1.262 1.885-1.262 2.217 0 3.614.964 3.614.964l.667-2.524s-1.397-.89-4.238-.89c-2.888 0-4.822 1.567-4.822 3.8 0 1.973 1.419 3.178 3.586 3.938 1.85.66 2.634 1.18 2.634 2.094 0 .888-.67 1.433-1.948 1.433-2.218 0-4.08-1.18-4.08-1.18l-.69 2.547s1.866 1.28 4.72 1.28c3.044 0 4.93-1.504 4.93-3.908 0-2.016-1.51-3.17-3.024-3.982z" fill="#635BFF"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white mb-1">Stripe Connect</h3>
                    <p className="text-white/60 text-sm mb-3">
                      {t('onboarding.payouts.method.stripe_connect_desc', { defaultValue: 'Stripe handles payouts for US, Canadian and French bank accounts. You’ll be redirected to complete setup.' })}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-emerald-300">
                      <Check className="w-4 h-4" />
                      <span>{t('onboarding.payouts.method.stripe_direct_deposits', { defaultValue: 'Direct bank deposits' })}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 mb-8">
                <button
                  onClick={() => setSelectedMethod('bank_transfer')}
                  className={`w-full p-4 rounded-2xl transition-all flex items-center gap-4 ${
                    selectedMethod === 'bank_transfer'
                      ? 'ring-1 ring-inset ring-brand-400/50 bg-white/[0.08]'
                      : 'bg-white/[0.055] hover:bg-white/[0.08]'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-white/[0.07] flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-white/80" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-white">{t('onboarding.payouts.method.bank_transfer', { defaultValue: 'Bank Transfer' })}</div>
                    <div className="text-sm text-white/50">{t('onboarding.payouts.method.bank_transfer_desc', { defaultValue: 'Direct deposit to your bank account' })}</div>
                  </div>
                  {selectedMethod === 'bank_transfer' && (
                    <Check className="w-5 h-5 text-brand-300" />
                  )}
                </button>

                <button
                  onClick={() => setSelectedMethod('mobile_money')}
                  className={`w-full p-4 rounded-2xl transition-all flex items-center gap-4 ${
                    selectedMethod === 'mobile_money'
                      ? 'ring-1 ring-inset ring-brand-400/50 bg-white/[0.08]'
                      : 'bg-white/[0.055] hover:bg-white/[0.08]'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-white/[0.07] flex items-center justify-center">
                    <Smartphone className="w-6 h-6 text-white/80" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-white">{t('onboarding.payouts.method.mobile_money', { defaultValue: 'Mobile Money' })}</div>
                    <div className="text-sm text-white/50">{t('onboarding.payouts.method.mobile_money_desc', { defaultValue: 'MonCash' })}</div>
                  </div>
                  {selectedMethod === 'mobile_money' && (
                    <Check className="w-5 h-5 text-brand-300" />
                  )}
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                className="px-4 py-2.5 text-white/70 hover:text-white hover:bg-white/[0.07] rounded-full transition-colors"
              >
                {t('onboarding.payouts.nav.back', { defaultValue: 'Back' })}
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full font-semibold hover:bg-white/90 transition-all"
              >
                {t('onboarding.payouts.nav.continue', { defaultValue: 'Continue' })}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Details Step */}
        {currentStep === 'details' && (
          <div>
            <div className="text-center mb-8">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/[0.07] flex items-center justify-center">
                {selectedMethod === 'bank_transfer' ? (
                  <Building2 className="w-7 h-7 text-white" />
                ) : (
                  <Smartphone className="w-7 h-7 text-white" />
                )}
              </div>
              <h2 className="font-display lowercase italic !text-[26px] !leading-snug text-white mb-2">
                {isStripeLocation
                  ? t('onboarding.payouts.details.title_stripe', { defaultValue: 'Ready for Stripe' })
                  : selectedMethod === 'bank_transfer'
                    ? t('onboarding.payouts.details.title_bank', { defaultValue: 'Bank Account Details' })
                    : t('onboarding.payouts.details.title_mobile', { defaultValue: 'Mobile Money Details' })}
              </h2>
              <p className="text-white/60">
                {isStripeLocation
                  ? t('onboarding.payouts.details.subtitle_stripe', { defaultValue: 'You’ll complete the setup on Stripe’s secure platform' })
                  : t('onboarding.payouts.details.subtitle_haiti', { defaultValue: 'Enter your account information' })}
              </p>
            </div>

            {isStripeLocation ? (
              <div className="bg-white/[0.055] rounded-2xl p-6 mb-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/[0.08] flex items-center justify-center">
                  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                    <path d="M13.976 9.15c-2.172-.806-3.234-1.354-3.234-2.31 0-.788.636-1.262 1.885-1.262 2.217 0 3.614.964 3.614.964l.667-2.524s-1.397-.89-4.238-.89c-2.888 0-4.822 1.567-4.822 3.8 0 1.973 1.419 3.178 3.586 3.938 1.85.66 2.634 1.18 2.634 2.094 0 .888-.67 1.433-1.948 1.433-2.218 0-4.08-1.18-4.08-1.18l-.69 2.547s1.866 1.28 4.72 1.28c3.044 0 4.93-1.504 4.93-3.908 0-2.016-1.51-3.17-3.024-3.982z" fill="#635BFF"/>
                  </svg>
                </div>
                <p className="text-white/70 mb-2">
                  {t('onboarding.payouts.details.stripe_note', { defaultValue: 'Click continue to complete your setup on Stripe’s secure platform.' })}
                </p>
                <p className="text-sm text-white/50">
                  {t('onboarding.payouts.details.stripe_note_2', { defaultValue: 'You’ll be able to add your bank account and verify your identity.' })}
                </p>
              </div>
            ) : selectedMethod === 'bank_transfer' ? (
              <div className="bg-white/[0.055] rounded-2xl p-5 space-y-4 mb-8">
                {/* Bank Selection */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.bank', { defaultValue: 'Bank' })} <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={bankForm.bankName}
                    onChange={(e) => { clearFieldError('bankName'); clearFieldError('customBankName'); setBankForm(prev => ({ ...prev, bankName: e.target.value })) }}
                    aria-invalid={Boolean(fieldErrors.bankName)}
                    className={inputClass(fieldErrors.bankName)}
                  >
                    {HAITI_BANKS.map((bank) => (
                      <option key={bank.value} value={bank.value}>{t(`onboarding.payouts.banks.${bank.value}`, { defaultValue: bank.label })}</option>
                    ))}
                  </select>
                </div>

                {bankForm.bankName === 'other' && (
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      {t('onboarding.payouts.field.bank_name', { defaultValue: 'Bank Name' })} <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={bankForm.customBankName}
                      onChange={(e) => { clearFieldError('customBankName'); setBankForm(prev => ({ ...prev, customBankName: e.target.value })) }}
                      onBlur={() => { if (bankForm.customBankName.trim()) validateField('customBankName') }}
                      aria-invalid={Boolean(fieldErrors.customBankName)}
                      aria-describedby={fieldErrors.customBankName ? 'err-customBankName' : undefined}
                      placeholder={t('onboarding.payouts.field.bank_name_placeholder', { defaultValue: 'Enter your bank name' })}
                      className={inputClass(fieldErrors.customBankName)}
                    />
                    {fieldErrors.customBankName ? <p id="err-customBankName" className="mt-1.5 text-xs text-red-300">{fieldErrors.customBankName}</p> : null}
                  </div>
                )}

                {/* Account Holder Name */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.account_holder_name', { defaultValue: 'Account Holder Name' })} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={bankForm.accountName}
                    onChange={(e) => { clearFieldError('accountName'); setBankForm(prev => ({ ...prev, accountName: e.target.value })) }}
                    onBlur={() => { if (bankForm.accountName.trim()) validateField('accountName') }}
                    aria-invalid={Boolean(fieldErrors.accountName)}
                    aria-describedby={fieldErrors.accountName ? 'err-accountName' : undefined}
                    placeholder={t('onboarding.payouts.field.account_holder_name_placeholder', { defaultValue: 'Name as it appears on account' })}
                    className={inputClass(fieldErrors.accountName)}
                  />
                  {fieldErrors.accountName ? <p id="err-accountName" className="mt-1.5 text-xs text-red-300">{fieldErrors.accountName}</p> : null}
                </div>

                {/* Account Number */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.account_number', { defaultValue: 'Account Number' })} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={bankForm.accountNumber}
                    onChange={(e) => { clearFieldError('accountNumber'); setBankForm(prev => ({ ...prev, accountNumber: e.target.value })) }}
                    onBlur={() => { if (bankForm.accountNumber.trim()) validateField('accountNumber') }}
                    aria-invalid={Boolean(fieldErrors.accountNumber)}
                    aria-describedby={fieldErrors.accountNumber ? 'err-accountNumber' : undefined}
                    placeholder={t('onboarding.payouts.field.account_number_placeholder', { defaultValue: 'Your bank account number' })}
                    className={inputClass(fieldErrors.accountNumber)}
                  />
                  {fieldErrors.accountNumber ? <p id="err-accountNumber" className="mt-1.5 text-xs text-red-300">{fieldErrors.accountNumber}</p> : null}
                </div>

                {/* Routing Number (Optional) */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.routing_number', { defaultValue: 'Routing/Transit Number' })} <span className="text-white/40 text-xs">{t('onboarding.payouts.optional', { defaultValue: '(Optional)' })}</span>
                  </label>
                  <input
                    type="text"
                    value={bankForm.routingNumber}
                    onChange={(e) => { clearFieldError('routingNumber'); setBankForm(prev => ({ ...prev, routingNumber: e.target.value })) }}
                    onBlur={() => { if (bankForm.routingNumber.trim()) validateField('routingNumber') }}
                    aria-invalid={Boolean(fieldErrors.routingNumber)}
                    aria-describedby={fieldErrors.routingNumber ? 'err-routingNumber' : undefined}
                    placeholder={t('onboarding.payouts.field.routing_number_placeholder', { defaultValue: 'If applicable' })}
                    className={inputClass(fieldErrors.routingNumber)}
                  />
                  {fieldErrors.routingNumber ? <p id="err-routingNumber" className="mt-1.5 text-xs text-red-300">{fieldErrors.routingNumber}</p> : null}
                </div>
              </div>
            ) : (
              <div className="bg-white/[0.055] rounded-2xl p-5 space-y-4 mb-8">
                {/* Provider Selection */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.provider', { defaultValue: 'Provider' })} <span className="text-red-400">*</span>
                  </label>
                  <div className={`grid gap-3 ${MOBILE_PROVIDERS.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {MOBILE_PROVIDERS.map((provider) => (
                      <button
                        key={provider.value}
                        type="button"
                        onClick={() => setMobileForm(prev => ({ ...prev, provider: provider.value }))}
                        className={`p-4 rounded-2xl transition-all ${
                          mobileForm.provider === provider.value
                            ? 'ring-1 ring-inset ring-brand-400/50 bg-white/[0.1]'
                            : 'bg-white/[0.07] hover:bg-white/[0.1]'
                        }`}
                      >
                        <provider.icon className="mx-auto mb-1.5 h-6 w-6 text-white/80" aria-hidden="true" />
                        <span className="font-medium text-white">{provider.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.phone_number', { defaultValue: 'Phone Number' })} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="tel"
                    value={mobileForm.phoneNumber}
                    onChange={(e) => { clearFieldError('phoneNumber'); setMobileForm(prev => ({ ...prev, phoneNumber: e.target.value })) }}
                    onBlur={() => { if (mobileForm.phoneNumber.trim()) validateField('phoneNumber') }}
                    aria-invalid={Boolean(fieldErrors.phoneNumber)}
                    aria-describedby={fieldErrors.phoneNumber ? 'err-phoneNumber' : undefined}
                    placeholder={t('onboarding.payouts.field.phone_number_placeholder', { defaultValue: '+509 1234 5678' })}
                    className={inputClass(fieldErrors.phoneNumber)}
                  />
                  {fieldErrors.phoneNumber ? <p id="err-phoneNumber" className="mt-1.5 text-xs text-red-300">{fieldErrors.phoneNumber}</p> : null}
                  <p className="mt-1.5 text-xs text-white/50">
                    {t('onboarding.payouts.field.phone_hint', {
                      defaultValue: 'Enter the phone number linked to your {{provider}} account',
                      provider: providerLabel(mobileForm.provider),
                    })}
                  </p>
                </div>

                {/* Account Name (Optional) */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.payouts.field.account_name', { defaultValue: 'Account Name' })} <span className="text-white/40 text-xs">{t('onboarding.payouts.optional', { defaultValue: '(Optional)' })}</span>
                  </label>
                  <input
                    type="text"
                    value={mobileForm.accountName}
                    onChange={(e) => setMobileForm(prev => ({ ...prev, accountName: e.target.value }))}
                    placeholder={t('onboarding.payouts.field.account_name_placeholder', { defaultValue: 'Name on account' })}
                    className={inputClass()}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                className="px-4 py-2.5 text-white/70 hover:text-white hover:bg-white/[0.07] rounded-full transition-colors"
              >
                {t('onboarding.payouts.nav.back', { defaultValue: 'Back' })}
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full font-semibold hover:bg-white/90 transition-all"
              >
                {t('onboarding.payouts.nav.continue', { defaultValue: 'Continue' })}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Review Step */}
        {currentStep === 'review' && (
          <div>
            <div className="text-center mb-8">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <Check className="w-7 h-7 text-emerald-300" />
              </div>
              <h2 className="font-display lowercase italic !text-[26px] !leading-snug text-white mb-2">{t('onboarding.payouts.review.title', { defaultValue: 'Review Your Setup' })}</h2>
              <p className="text-white/60">{t('onboarding.payouts.review.subtitle', { defaultValue: 'Confirm your payout details before finishing' })}</p>
            </div>

            <div className="bg-white/[0.055] rounded-2xl overflow-hidden mb-8">
              {/* Location */}
              <div className="p-4 border-b border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/50">{t('onboarding.payouts.review.location', { defaultValue: 'Location' })}</span>
                  <span className="font-medium text-white flex items-center gap-2">
                    <span className="text-xs font-semibold tracking-wide text-white/50">{locationData?.flag}</span>
                    {locationData ? t(`onboarding.payouts.location.${locationData.id}`, { defaultValue: locationData.name }) : null}
                  </span>
                </div>
              </div>

              {/* Method */}
              <div className="p-4 border-b border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/50">{t('onboarding.payouts.review.payout_method', { defaultValue: 'Payout Method' })}</span>
                  <span className="font-medium text-white">
                    {isStripeLocation
                      ? 'Stripe Connect'
                      : selectedMethod === 'bank_transfer'
                        ? t('onboarding.payouts.method.bank_transfer', { defaultValue: 'Bank Transfer' })
                        : t('onboarding.payouts.method.mobile_money', { defaultValue: 'Mobile Money' })}
                  </span>
                </div>
              </div>

              {/* Details */}
              {!isStripeLocation && selectedMethod === 'bank_transfer' && (
                <>
                  <div className="p-4 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/50">{t('onboarding.payouts.review.bank', { defaultValue: 'Bank' })}</span>
                      <span className="font-medium text-white">
                        {bankForm.bankName === 'other'
                          ? bankForm.customBankName
                          : t(`onboarding.payouts.banks.${bankForm.bankName}`, { defaultValue: HAITI_BANKS.find(b => b.value === bankForm.bankName)?.label })}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/50">{t('onboarding.payouts.review.account_holder', { defaultValue: 'Account Holder' })}</span>
                      <span className="font-medium text-white">{bankForm.accountName}</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/50">{t('onboarding.payouts.review.account_number', { defaultValue: 'Account Number' })}</span>
                      <span className="font-medium text-white">
                        ****{bankForm.accountNumber.slice(-4)}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {!isStripeLocation && selectedMethod === 'mobile_money' && (
                <>
                  <div className="p-4 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/50">{t('onboarding.payouts.review.provider', { defaultValue: 'Provider' })}</span>
                      <span className="font-medium text-white">
                        {providerLabel(mobileForm.provider)}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/50">{t('onboarding.payouts.review.phone_number', { defaultValue: 'Phone Number' })}</span>
                      <span className="font-medium text-white">
                        {normalizeHaitiPhone(mobileForm.phoneNumber)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Saving a method never needed identity; WITHDRAWING does (the
                withdraw routes require an `active` profile). Say so up front. */}
            {!isStripeLocation && (
              <div className="mb-8 rounded-xl bg-white/[0.055] p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-white/60 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-white/70">
                  <p className="font-semibold text-white">
                    {t('verify_to_withdraw.title', { defaultValue: 'Verify your identity to withdraw' })}
                  </p>
                  <p className="mt-1">
                    {t('onboarding.payouts.review.identity_note', { defaultValue: 'You can save this payout method now. Withdrawals open once your identity is verified. Our team reviews it usually within 1–2 business days.' })}
                  </p>
                  <Link href="/organizer/verify" className="mt-2 inline-flex items-center gap-1 font-semibold text-brand-300 hover:text-white">
                    {t('verify_to_withdraw.cta', { defaultValue: 'Verify your identity' })}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={saving}
                className="px-4 py-2.5 text-white/70 hover:text-white hover:bg-white/[0.07] rounded-full transition-colors disabled:opacity-50"
              >
                {t('onboarding.payouts.nav.back', { defaultValue: 'Back' })}
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-full font-semibold hover:bg-white/90 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('onboarding.payouts.nav.setting_up', { defaultValue: 'Setting up...' })}
                  </>
                ) : isStripeLocation ? (
                  <>
                    {t('onboarding.payouts.nav.continue_to_stripe', { defaultValue: 'Continue to Stripe' })}
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {t('onboarding.payouts.nav.complete_setup', { defaultValue: 'Complete Setup' })}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
