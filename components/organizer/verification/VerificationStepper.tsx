import { useTranslation } from 'react-i18next'
/**
 * VerificationStepper Component
 * Step-by-step checklist for verification process
 */

import { type VerificationRequest, type VerificationStep } from '@/lib/verification'
import { StatusChip, type ChipTone } from '@/components/ui/kit'
import { SectionHeader } from '@/components/organizer/ui/PageHeader'

interface Props {
  request: VerificationRequest
  onEditStep: (stepId: keyof VerificationRequest['steps']) => void
  isReadOnly?: boolean
}

export default function VerificationStepper({ request, onEditStep, isReadOnly = false }: Props) {
  const { t } = useTranslation('organizer')

  // Fixed order of steps to prevent random ordering
  const stepOrder: (keyof VerificationRequest['steps'])[] = [
    'organizerInfo',
    'governmentId', 
    'selfie',
    'businessDetails'
  ]
  
  const steps = stepOrder.map(stepId => [stepId, request.steps[stepId]] as [keyof VerificationRequest['steps'], VerificationStep])

  return (
    <div className="space-y-4">
      <SectionHeader title={t('verification_stepper.verification_steps')} className="mb-4" />

      <div className="space-y-3">
        {steps.map(([stepId, step], index) => (
          <StepCard
            key={stepId}
            stepId={stepId}
            step={step}
            stepNumber={index + 1}
            onEdit={() => onEditStep(stepId)}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    </div>
  )
}

interface StepCardProps {
  stepId: keyof VerificationRequest['steps']
  step: VerificationStep
  stepNumber: number
  onEdit: () => void
  onSkip?: () => void
  isReadOnly: boolean
}

function StepCard({ stepId, step, stepNumber, onEdit, onSkip, isReadOnly }: StepCardProps) {
  const { t } = useTranslation('organizer')

  // Status styling.
  //
  // Every state is a FILL, never a hairline around an empty box (see
  // docs/POSH_DESIGN_BRIEF.md). This used to be the other way round and it read
  // backwards: `complete` and `needs_attention` had NO surface at all while
  // `incomplete` carried `bg-white/[0.03]`, so a finished step looked fainter
  // than an unfinished one. Done work now sits one step UP the ladder (0.05 on
  // the 0.03 page), unfinished work stays at the base 0.03, and the state that
  // needs a human sits at 0.05 with a red ring — the sanctioned "fill plus an
  // accent ring on top" pattern, not a border standing in for a surface.
  const statusConfig: Record<
    VerificationStep['status'],
    { surface: string; iconBgColor: string; icon: React.ReactNode; tone: ChipTone; badgeText: string }
  > = {
    complete: {
      surface: 'bg-white/[0.08]',
      iconBgColor: 'bg-emerald-500',
      icon: (
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      ),
      tone: 'success',
      badgeText: 'Complete'
    },
    incomplete: {
      surface: 'bg-white/[0.055]',
      iconBgColor: 'bg-white/[0.10]',
      icon: (
        <span className="text-xs font-bold text-white/60">
          {stepNumber}
        </span>
      ),
      tone: 'neutral',
      badgeText: step.required ? 'Required' : 'Optional'
    },
    needs_attention: {
      surface: 'bg-white/[0.08] ring-1 ring-inset ring-red-500/40',
      iconBgColor: 'bg-red-500',
      icon: (
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tone: 'danger',
      badgeText: 'Needs Attention'
    }
  }

  const config = statusConfig[step.status]

  // Determine if card should be clickable
  // - Editable flow: only incomplete steps open the form.
  // - Read-only flow: completed steps should still open the details view.
  const isClickable = (!isReadOnly && step.status !== 'complete') || (isReadOnly && step.status === 'complete')

  // Handle card click
  const handleCardClick = () => {
    if (isClickable) {
      onEdit()
    }
  }

  return (
    <div 
      onClick={isClickable ? handleCardClick : undefined}
      className={`${config.surface} rounded-2xl p-4 transition-colors ${isClickable ? 'cursor-pointer hover:bg-white/[0.12]' : ''}`}
    >
      <div className="flex items-start gap-4">
        {/* Step icon */}
        <div className={`${config.iconBgColor} rounded w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5`}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white text-sm md:text-base mb-1">
                {step.title}
                {step.required && (
                  <span className="text-red-500 ml-1" aria-label={t('actions.required')}>
                    *
                  </span>
                )}
              </h3>
              <p className="text-xs md:text-sm text-white/60">
                {step.description}
              </p>
            </div>

            {/* Status read-out: dot + label, not a filled pill. */}
            <StatusChip tone={config.tone} className="mt-0.5 flex-shrink-0">
              {config.badgeText}
            </StatusChip>
          </div>

          {/* Missing fields / Error message */}
          {step.status !== 'complete' && step.missingFields && step.missingFields.length > 0 && (
            <div className="mt-2 mb-3">
              <p className="text-xs text-white/60 mb-1">{t('verification_stepper.missing')}</p>
              <ul className="list-disc list-inside text-xs text-white/70 space-y-0.5">
                {step.missingFields.map((field) => (
                  <li key={field}>
                    {formatFieldName(field)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step.errorMessage && (
            <div className="mt-2 mb-3 text-xs text-red-300">
              {step.errorMessage}
            </div>
          )}

          {/* Action indicator */}
          {!isReadOnly && (
            <div className="mt-3">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-brand-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>{step.status === 'complete' ? 'Edit' : 'Complete'}</span>
              </span>
            </div>
          )}

          {/* Read-only view */}
          {isReadOnly && step.status === 'complete' && (
            <div className="mt-3">
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white/70 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span>{t('actions.view_details')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper: Format field names for display
function formatFieldName(field: string): string {
  const fieldNames: Record<string, string> = {
    full_name: 'Full Name',
    phone: 'Phone Number',
    organization_name: 'Organization Name',
    id_front: 'ID Front Photo',
    id_back: 'ID Back Photo',
    selfie: 'Selfie Photo',
    business_registration: 'Business Registration',
    tax_id: 'Tax ID',
    payout_method: 'Payout Method',
    bank_account: 'Bank Account',
    moncash_number: 'MonCash Number'
  }

  return fieldNames[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}
