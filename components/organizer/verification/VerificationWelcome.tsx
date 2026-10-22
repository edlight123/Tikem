import { useTranslation } from 'react-i18next'
/**
 * VerificationWelcome Component
 * Engaging welcome screen for new users starting verification
 */

import { Shield, BadgeCheck, Wallet, Users, ArrowRight } from 'lucide-react'

interface Props {
  onStart: () => void
  userName?: string
}

export default function VerificationWelcome({ onStart, userName }: Props) {
  const { t } = useTranslation('organizer')

  const benefits = [
    {
      icon: BadgeCheck,
      title: 'Build Trust',
      description: 'Verified badge shows attendees you\'re legitimate'
    },
    {
      icon: Wallet,
      title: 'Get Paid',
      description: 'Receive payouts directly to your bank or mobile money'
    },
    {
      icon: Users,
      title: 'Sell Tickets',
      description: 'Create and sell paid event tickets securely'
    }
  ]

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/[0.07] rounded-2xl mb-6">
            <Shield className="w-10 h-10 text-white" />
          </div>
          
          <h1 className="mb-4 font-display lowercase italic !text-[34px] !leading-[1.04] text-white sm:!text-[44px]">
            {userName ? `Welcome, ${userName}!` : 'Become a Verified Organizer'}
          </h1>
          
          <p className="text-lg text-white/60 max-w-md mx-auto">
            {t('verification_welcome.complete_quick_verification')}
          </p>
        </div>

        {/* Benefits */}
        <div className="grid sm:grid-cols-3 gap-6 mb-12">
          {benefits.map((benefit, index) => (
            <div 
              key={index}
              className="bg-white/[0.055] rounded-2xl p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/[0.07] mb-4">
                <benefit.icon className="w-6 h-6 text-white/80" />
              </div>
              <h3 className="font-semibold text-white mb-2">{benefit.title}</h3>
              <p className="text-sm text-white/60">{benefit.description}</p>
            </div>
          ))}
        </div>

        {/* What you'll need */}
        <div className="bg-white/[0.055] rounded-2xl p-6 mb-8">
          {/* `!` because `.mobile-typography h2` (0,1,1) beats a bare size. */}
          <h2 className="mb-4 font-display lowercase italic !text-[22px] !leading-snug text-white">What you&apos;ll need</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-white/[0.08] rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-white/70">1</span>
              </div>
              <div>
                <p className="font-medium text-white text-sm">{t('verification_welcome.government_issued_id')}</p>
                <p className="text-xs text-white/50">Passport, driver&apos;s license, or national ID</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-white/[0.08] rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-white/70">2</span>
              </div>
              <div>
                <p className="font-medium text-white text-sm">{t('verification_welcome.a_clear_selfie')}</p>
                <p className="text-xs text-white/50">{t('verification_welcome.to_match_id_photo')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-white/[0.08] rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-white/50">3</span>
              </div>
              <div>
                <p className="font-medium text-white text-sm">{t('verification_welcome.business_info')}<span className="text-white/40 font-normal">(optional)</span></p>
                <p className="text-xs text-white/50">{t('verification_welcome.if_registered_business')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-white/[0.08] rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-white/70">~5</span>
              </div>
              <div>
                <p className="font-medium text-white text-sm">{t('verification_welcome.about_5_minutes')}</p>
                <p className="text-xs text-white/50">{t('verification_welcome.quick_easy_process')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white hover:bg-white/90 text-black font-semibold rounded transition-all text-lg"
          >
            {t('verification_welcome.start_verification')}
            <ArrowRight className="w-5 h-5" />
          </button>
          
          <p className="text-sm text-white/50 mt-4">
            {t('verification_welcome.reviewed_24_48')}
          </p>
        </div>
      </div>
    </div>
  )
}
