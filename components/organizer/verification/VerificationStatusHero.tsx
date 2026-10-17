import { useTranslation } from 'react-i18next'
/**
 * VerificationStatusHero Component
 * Displays the current verification status with appropriate messaging and CTAs
 */

import { type VerificationStatus } from '@/lib/verification'
import Link from 'next/link'
import {
  BadgeCheck,
  CircleX,
  Clock,
  Eye,
  FileText,
  RefreshCw,
  TriangleAlert
} from 'lucide-react'

interface Props {
  status: VerificationStatus
  completionPercentage: number
  reviewNotes?: string
  onRestart?: () => void
  isRestarting?: boolean
}

export default function VerificationStatusHero({
  status,
  completionPercentage,
  reviewNotes,
  onRestart,
  isRestarting = false
}: Props) {
  const { t } = useTranslation('organizer')

  // Status configuration.
  //
  // Each status is a semantic TINT, not a coloured hairline around nothing.
  // Every entry here used to be `bgColor: ''` + `border-<hue>-500/30`, which on
  // the #0a0a0a page drew the hero as an empty outlined box — the wireframe
  // look the brief rejects. The fill now carries the status (and the icon chip
  // steps up one notch inside it), matching the notices already shipped in
  // ReviewSubmitPanel.
  const statusConfig: Record<VerificationStatus, {
    icon: React.ComponentType<{ className?: string }>
    bgColor: string
    iconBgColor: string
    iconColor: string
    title: string
    description: string
    readonly?: boolean
    ctaHref?: string
    actionType?: 'restart' | 'link'
  }> = {
    not_started: {
      icon: FileText,
      bgColor: 'bg-white/[0.055]',
      iconBgColor: 'bg-white/[0.08]',
      iconColor: 'text-white',
      title: 'Start Verification',
      description: 'Complete identity verification to withdraw your earnings.'
    },
    in_progress: {
      icon: Clock,
      bgColor: 'bg-white/[0.055]',
      iconBgColor: 'bg-amber-500/15',
      iconColor: 'text-amber-300',
      title: 'Complete Your Verification',
      description: `You're ${completionPercentage}% complete. Finish the required steps to submit for review.`
    },
    pending_review: {
      icon: Eye,
      bgColor: 'bg-white/[0.055]',
      iconBgColor: 'bg-amber-500/15',
      iconColor: 'text-amber-300',
      title: 'Verification Submitted',
      description: 'Your verification is pending review. Our team reviews it usually within 1–2 business days.',
      readonly: true
    },
    // Legacy alias (older documents used "pending")
    pending: {
      icon: Eye,
      bgColor: 'bg-white/[0.055]',
      iconBgColor: 'bg-amber-500/15',
      iconColor: 'text-amber-300',
      title: 'Verification Submitted',
      description: 'Your verification is pending review. Our team reviews it usually within 1–2 business days.',
      readonly: true
    },
    in_review: {
      icon: Eye,
      bgColor: 'bg-white/[0.055]',
      iconBgColor: 'bg-amber-500/15',
      iconColor: 'text-amber-300',
      title: 'Under Review',
      description: 'Our team is currently reviewing your verification documents.',
      readonly: true
    },
    approved: {
      icon: BadgeCheck,
      bgColor: 'bg-white/[0.055]',
      iconBgColor: 'bg-emerald-500/15',
      iconColor: 'text-emerald-300',
      title: 'Verification Approved',
      description: 'Your account is verified. You can now publish paid events and request payouts.',
      ctaHref: '/organizer/events/new',
      actionType: 'link'
    },
    changes_requested: {
      icon: TriangleAlert,
      bgColor: 'bg-amber-500/10',
      iconBgColor: 'bg-amber-500/20',
      iconColor: 'text-amber-300',
      title: 'Changes Requested',
      description: 'We need some additional information. Please review the notes below and update your submission.'
    },
    rejected: {
      icon: CircleX,
      bgColor: 'bg-red-500/10',
      iconBgColor: 'bg-red-500/20',
      iconColor: 'text-red-300',
      title: 'Verification Declined',
      description: 'Your verification was not approved. Click below to start a fresh application with all fields cleared.',
      actionType: 'restart'
    }
  }

  const config = statusConfig[status]

  const Icon = config.icon

  return (
    <div className={`${config.bgColor} rounded-2xl p-6 md:p-8 mb-6`}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`${config.iconBgColor} rounded-full p-3 md:p-4 flex-shrink-0`}>
          <Icon className={`w-6 h-6 md:w-7 md:h-7 ${config.iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* `!` on the size: body carries `.mobile-typography`, whose
              `h1` rule (0,1,1) outranks a bare arbitrary size (0,1,0) under
              640px and would drag this back to text-xl with its own leading. */}
          <h1 className="mb-2 font-display lowercase italic !text-[26px] !leading-[1.05] text-white md:!text-[32px]">
            {config.title}
          </h1>
          <p className="text-sm md:text-base text-white/70 mb-4">
            {config.description}
          </p>

          {/* Progress bar for in_progress status */}
          {status === 'in_progress' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs md:text-sm font-medium text-white/70">
                  {t('actions.progress')}
                </span>
                <span className="text-xs md:text-sm font-semibold text-amber-300">
                  {completionPercentage}%
                </span>
              </div>
              <div className="w-full bg-white/[0.12] rounded-full h-2">
                <div
                  className="bg-amber-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Review notes for changes_requested or rejected.
              A neutral step UP, not the hero's own tint again: the same colour
              nested inside itself renders as nothing. */}
          {(status === 'changes_requested' || status === 'rejected') && reviewNotes && (
            <div className="bg-white/[0.08] rounded-xl p-4 mb-4">
              <h3 className="text-sm font-semibold text-white mb-2">
                {t('verification_status.feedback_from_team')}
              </h3>
              <p className="text-sm text-white/70 whitespace-pre-wrap">
                {reviewNotes}
              </p>
            </div>
          )}

          {/* Actions (only when meaningful) */}
          {config.actionType === 'link' && config.ctaHref ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={config.ctaHref}
                className="bg-white hover:bg-white/90 text-black px-6 py-3 rounded-full font-semibold text-sm md:text-base text-center transition-all"
              >
                {t('actions.create_event')}
              </Link>
              <Link
                href="/organizer"
                className="bg-white/[0.07] hover:bg-white/[0.12] text-white hover:text-white px-6 py-3 rounded-full font-medium text-sm md:text-base text-center transition-colors"
              >
                {t('verification_status.back_to_dashboard')}
              </Link>
            </div>
          ) : null}

          {config.actionType === 'restart' ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={onRestart}
                disabled={isRestarting}
                className={`bg-white hover:bg-white/90 ${
                  isRestarting ? 'opacity-50 cursor-not-allowed' : ''
                } text-black px-6 py-3 rounded-full font-semibold text-sm md:text-base transition-colors flex items-center justify-center gap-2`}
              >
                {isRestarting ? (
                  <div className="w-4 h-4 border-2 border-black/60 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Start Fresh Application
              </button>
              <Link
                href="/organizer"
                className="bg-white/[0.07] hover:bg-white/[0.12] text-white hover:text-white px-6 py-3 rounded-full font-medium text-sm md:text-base text-center transition-colors"
              >
                {t('verification_status.back_to_dashboard')}
              </Link>
            </div>
          ) : null}

          {status === 'pending' || status === 'pending_review' || status === 'in_review' ? (
            <div className="mt-4">
              <Link
                href="/organizer/events"
                className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white"
              >
                <Eye className="w-4 h-4" />
                {t('verification_status.go_to_events')}
              </Link>
            </div>
          ) : null}
        </div>
      </div>

    </div>
  )
}
