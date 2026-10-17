'use client'

import { useTranslation } from 'react-i18next'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PayoutsSetupWizard from '@/components/organizer/payouts/PayoutsSetupWizard'
import PayoutsSummaryDashboard from '@/components/organizer/payouts/PayoutsSummaryDashboard'
import DeclaredMarketsCard from '@/components/organizer/payouts/DeclaredMarketsCard'
import { ArrowRight } from 'lucide-react'

// Types matching the existing PayoutsPageNew
type PayoutConfig = {
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

interface PayoutsPageWrapperProps {
  haitiConfig?: PayoutConfig
  stripeConfig?: PayoutConfig
  organizerId: string
  organizerDefaultCountry?: string
  /** Countries the organizer says they run events in — UI hint only. */
  declaredMarkets?: string[]
  initialActiveProfile?: 'haiti' | 'stripe_connect'
}

export default function PayoutsPageWrapper({
  haitiConfig,
  stripeConfig,
  organizerId,
  organizerDefaultCountry,
  declaredMarkets,
  initialActiveProfile,
}: PayoutsPageWrapperProps) {
  const { t } = useTranslation('organizer')

  const router = useRouter()
  const [viewMode, setViewMode] = useState<'dashboard' | 'setup' | 'edit'>('dashboard')
  const [editingProfile, setEditingProfile] = useState<'haiti' | 'stripe_connect' | null>(null)

  // Determine if user needs setup
  const hasHaitiSetup = Boolean(haitiConfig?.method || haitiConfig?.bankDetails || haitiConfig?.mobileMoneyDetails)
  const hasStripeSetup = Boolean(stripeConfig?.stripeAccountId || stripeConfig?.payoutProvider === 'stripe_connect')
  const hasAnySetup = hasHaitiSetup || hasStripeSetup

  // Start in setup mode if no payout methods configured
  useEffect(() => {
    if (!hasAnySetup) {
      setViewMode('setup')
    }
  }, [hasAnySetup])

  // Convert config to PayoutMethod format for dashboard
  const convertToPayoutMethod = (config: PayoutConfig | undefined, type: 'haiti' | 'stripe') => {
    if (!config) return null
    
    if (type === 'stripe' && config.stripeAccountId) {
      return {
        type: 'stripe' as const,
        status: config.status === 'active' ? 'active' as const : 
                config.status === 'pending_verification' ? 'pending' as const : 
                'needs_attention' as const,
        details: {
          name: 'Stripe Connect',
          maskedNumber: config.stripeAccountId?.slice(-4),
        },
        verificationStatus: config.verificationStatus,
      }
    }

    if (type === 'haiti') {
      if (config.method === 'bank_transfer' && config.bankDetails) {
        return {
          type: 'bank_transfer' as const,
          status: config.status === 'active' ? 'active' as const : 
                  config.status === 'pending_verification' ? 'pending' as const : 
                  'needs_attention' as const,
          details: {
            name: config.bankDetails.accountName || 'Bank Account',
            maskedNumber: config.bankDetails.accountNumberLast4 || config.bankDetails.accountNumber?.slice(-4),
            bankName: config.bankDetails.bankName,
          },
          verificationStatus: config.verificationStatus,
        }
      }

      if (config.method === 'mobile_money' && config.mobileMoneyDetails) {
        return {
          type: 'mobile_money' as const,
          status: config.status === 'active' ? 'active' as const : 
                  config.status === 'pending_verification' ? 'pending' as const : 
                  'needs_attention' as const,
          details: {
            name: config.mobileMoneyDetails.accountName || 'Mobile Money',
            maskedNumber: config.mobileMoneyDetails.phoneNumberLast4 || config.mobileMoneyDetails.phoneNumber?.slice(-4),
            provider: config.mobileMoneyDetails.provider === 'moncash' ? 'MonCash' : 'NatCash',
          },
          verificationStatus: config.verificationStatus,
        }
      }
    }

    return null
  }

  const haitiMethod = convertToPayoutMethod(haitiConfig, 'haiti')
  const stripeMethod = convertToPayoutMethod(stripeConfig, 'stripe')

  const handleSetupComplete = () => {
    router.refresh()
    setViewMode('dashboard')
  }

  const handleEditProfile = (profile: 'haiti' | 'stripe_connect') => {
    setEditingProfile(profile)
    // For now, redirect to the full page for editing
    // In the future, this could open an edit modal
    router.push(`/organizer/settings/payouts?edit=${profile}`)
  }

  const handleSetupNew = () => {
    setViewMode('setup')
  }

  // Setup wizard view
  if (viewMode === 'setup') {
    return (
      <PayoutsSetupWizard
        organizerId={organizerId}
        organizerDefaultCountry={organizerDefaultCountry}
        declaredMarkets={declaredMarkets}
        onComplete={handleSetupComplete}
        onExit={() => {
          if (hasAnySetup) {
            setViewMode('dashboard')
          } else {
            router.push('/organizer')
          }
        }}
      />
    )
  }

  // Dashboard view
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-white/60 mb-2">
            <Link href="/organizer/settings" className="hover:text-white">
              {t('actions.settings')}
            </Link>
            <span className="text-white/40">/</span>
            <span className="text-white font-medium">{t('actions.payouts')}</span>
          </div>
          <h1 className="font-display lowercase italic !text-[28px] sm:!text-[32px] !leading-tight text-white">{t('actions.payouts')}</h1>
          <p className="text-white/60 mt-1">
            {t('payouts_wrapper.manage_earnings')}
          </p>
        </div>

        {/* Where you run events. Kept on the DEFAULT payouts view, not buried
            in advanced settings: it decides which rails the organizer is asked
            to set up, and it has to stay easy to revisit as they expand. */}
        <DeclaredMarketsCard
          className="mb-6"
          initialMarkets={declaredMarkets}
          haitiConfigured={hasHaitiSetup}
          stripeConfigured={hasStripeSetup}
        />

        {/* Dashboard */}
        <PayoutsSummaryDashboard
          organizerId={organizerId}
          haitiMethod={haitiMethod}
          stripeMethod={stripeMethod}
          onEdit={handleEditProfile}
          onSetupNew={handleSetupNew}
        />

        {/* Link to advanced settings */}
        {hasAnySetup && (
          <div className="mt-8 pt-6">
            <Link 
              href="/organizer/settings/payouts?view=advanced"
              className="inline-flex items-center gap-1 text-sm font-medium text-white/50 hover:text-white/70"
            >
              {t('payouts_wrapper.advanced_payout_settings')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
