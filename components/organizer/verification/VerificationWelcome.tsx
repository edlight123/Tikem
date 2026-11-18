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
          <div className="inline-flex items-center justify-center w-20 h-20 bg-surface-raised rounded-2xl mb-6">
            <Shield className="w-10 h-10 text-fg" />
          </div>
          
          <h1 className="mb-4 font-display lowercase italic !text-display !leading-[1.04] text-fg sm:!text-hero">
            {userName ? `Welcome, ${userName}!` : 'Become a Verified Organizer'}
          </h1>
          
          <p className="text-lg text-fg-muted max-w-md mx-auto">
            {t('verification_welcome.complete_quick_verification')}
          </p>
        </div>

        {/* Benefits */}
        <div className="grid sm:grid-cols-3 gap-6 mb-12">
          {benefits.map((benefit, index) => (
            <div 
              key={index}
              className="bg-surface rounded-2xl p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-surface-raised mb-4">
                <benefit.icon className="w-6 h-6 text-fg-soft" />
              </div>
              <h3 className="font-semibold text-fg mb-2">{benefit.title}</h3>
              <p className="text-sm text-fg-muted">{benefit.description}</p>
            </div>
          ))}
        </div>

        {/* What you'll need */}
        <div className="bg-surface rounded-2xl p-6 mb-8">
          {/* `!` because `.mobile-typography h2` (0,1,1) beats a bare size. */}
          <h2 className="mb-4 font-display lowercase italic !text-section !leading-snug text-fg">What you&apos;ll need</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-surface-raised rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-fg-muted">1</span>
              </div>
              <div>
                <p className="font-medium text-fg text-sm">{t('verification_welcome.government_issued_id')}</p>
                <p className="text-xs text-fg-subtle">Passport, driver&apos;s license, or national ID</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-surface-raised rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-fg-muted">2</span>
              </div>
              <div>
                <p className="font-medium text-fg text-sm">{t('verification_welcome.a_clear_selfie')}</p>
                <p className="text-xs text-fg-subtle">{t('verification_welcome.to_match_id_photo')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-surface-raised rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-fg-subtle">3</span>
              </div>
              <div>
                <p className="font-medium text-fg text-sm">{t('verification_welcome.business_info')}<span className="text-fg-subtle font-normal">(optional)</span></p>
                <p className="text-xs text-fg-subtle">{t('verification_welcome.if_registered_business')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-surface-raised rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-fg-muted">~5</span>
              </div>
              <div>
                <p className="font-medium text-fg text-sm">{t('verification_welcome.about_5_minutes')}</p>
                <p className="text-xs text-fg-subtle">{t('verification_welcome.quick_easy_process')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 px-8 py-4 bg-inverse hover:bg-inverse-hover text-on-inverse font-semibold rounded transition-all text-lg"
          >
            {t('verification_welcome.start_verification')}
            <ArrowRight className="w-5 h-5" />
          </button>
          
          <p className="text-sm text-fg-subtle mt-4">
            {t('verification_welcome.reviewed_24_48')}
          </p>
        </div>
      </div>
    </div>
  )
}
