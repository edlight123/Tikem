/**
 * Organizer Verification Page
 * Premium step-by-step verification flow
 */

'use client'

import { useTranslation } from 'react-i18next'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import VerificationStatusHero from '@/components/organizer/verification/VerificationStatusHero'
import VerificationStepper from '@/components/organizer/verification/VerificationStepper'
import ReviewSubmitPanel from '@/components/organizer/verification/ReviewSubmitPanel'
import VerificationWelcome from '@/components/organizer/verification/VerificationWelcome'
import VerificationWizard from '@/components/organizer/verification/VerificationWizard'
import OrganizerInfoForm from '@/components/organizer/verification/forms/OrganizerInfoForm'
import GovernmentIDForm from '@/components/organizer/verification/forms/GovernmentIDForm'
import SelfieForm from '@/components/organizer/verification/forms/SelfieForm'
import BusinessDetailsForm from '@/components/organizer/verification/forms/BusinessDetailsForm'
import { SectionHeader } from '@/components/organizer/ui'
import {
  getVerificationRequest,
  initializeVerificationRequest,
  updateVerificationStep,
  submitVerificationForReview,
  restartVerification,
  isOwnerEditableStatus,
  calculateCompletionPercentage,
  canSubmitForReview,
  type VerificationRequest
} from '@/lib/verification'
import { useOrganizerClientGuard } from '@/lib/hooks/useOrganizerClientGuard'

type ViewMode = 'welcome' | 'wizard' | 'overview' | 'organizerInfo' | 'governmentId' | 'selfie' | 'businessDetails' | 'review'

export default function VerifyOrganizerPage() {
  const { t } = useTranslation('organizer')

  const searchParams = useSearchParams()
  const { firebaseUser, navbarUser: user, userProfile, loading: authLoading } = useOrganizerClientGuard({
    loginRedirectPath: '/organizer/verify',
    upgradeRedirectPath: '/organizer/verify',
  })

  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const [request, setRequest] = useState<VerificationRequest | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('welcome')
  const [error, setError] = useState('')
  const [userVerification, setUserVerification] = useState<{ is_verified?: boolean; verification_status?: string } | null>(null)

  const wantsDetails = searchParams.get('details') === '1'

  const userIsVerified = Boolean(userVerification?.is_verified) || userVerification?.verification_status === 'approved'
  const effectiveStatus = request ? (userIsVerified ? 'approved' : request.status) : null

  // If details are requested for an in-flight review state, jump straight to the submitted view.
  // For approved, keep the step overview visible so the user can browse sections.
  useEffect(() => {
    if (!request) return
    if (!wantsDetails) return
    if (!['pending', 'pending_review', 'in_review'].includes(request.status)) return
    setViewMode('review')
  }, [request, wantsDetails])

  // Load verification request once authenticated.
  useEffect(() => {
    if (authLoading) return
    if (!firebaseUser) return

    const uid = firebaseUser.uid
    setUserVerification({
      is_verified: userProfile?.is_verified ?? false,
      verification_status: userProfile?.verification_status ?? undefined,
    })

    let cancelled = false

    const load = async () => {
      try {
        let verificationRequest = await getVerificationRequest(uid)

        // Initialize if doesn't exist
        if (!verificationRequest) {
          verificationRequest = await initializeVerificationRequest(uid)
        } else {
          // Migrate old payout step to optional (persisted so submit validation won't be blocked).
          if (verificationRequest.steps.payoutSetup?.required === true && isOwnerEditableStatus(verificationRequest.status)) {
            // Only while the owner may still edit: a submitted/approved request is frozen in firestore.rules.
            await updateVerificationStep(uid, 'payoutSetup', {
              required: false,
              missingFields: [],
              description: 'Configure how you receive payments (can be set up later)'
            })
            verificationRequest = (await getVerificationRequest(uid)) || verificationRequest
          }
        }

        if (!cancelled) {
          setRequest(verificationRequest)
          
          // Determine initial view mode based on progress
          const completionPct = calculateCompletionPercentage(verificationRequest)
          const isReadOnly = ['pending', 'pending_review', 'in_review', 'approved', 'rejected'].includes(verificationRequest.status)
          
          if (isReadOnly) {
            // Show overview for submitted/approved/rejected
            setViewMode('overview')
          } else if (verificationRequest.status === 'not_started' && completionPct === 0) {
            // Fresh user - show welcome screen
            setViewMode('welcome')
          } else if (completionPct < 100) {
            // In progress - show wizard
            setViewMode('wizard')
          } else {
            // Complete but not submitted - show overview
            setViewMode('overview')
          }
        }
      } catch (err: any) {
        console.error('Error loading verification:', err)
        if (!cancelled) setError(err.message || 'Failed to load verification data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [authLoading, firebaseUser, userProfile])

  // Reload verification data
  const reloadRequest = async () => {
    if (!user) return
    
    try {
      const freshRequest = await getVerificationRequest(user.id)
      if (freshRequest) {
        setRequest(freshRequest)
      }
    } catch (err: any) {
      console.error('Error reloading verification:', err)
    }
  }

  const dismissError = () => setError('')

  // Handle step completion
  const handleSaveOrganizerInfo = async (data: Record<string, any>) => {
    if (!user || !request) return

    await updateVerificationStep(user.id, 'organizerInfo', {
      status: 'complete',
      fields: data,
      missingFields: []
    })

    await reloadRequest()
    setViewMode('overview')
  }

  const handleSaveGovernmentID = async () => {
    if (!user || !request) return

    await updateVerificationStep(user.id, 'governmentId', {
      status: 'complete',
      fields: {},
      missingFields: []
    })

    await reloadRequest()
    setViewMode('overview')
  }

  const handleSaveSelfie = async () => {
    if (!user || !request) return

    await updateVerificationStep(user.id, 'selfie', {
      status: 'complete',
      fields: {},
      missingFields: []
    })

    await reloadRequest()
    setViewMode('overview')
  }

  const handleSaveBusinessDetails = async (data: Record<string, any>) => {
    if (!user || !request) return

    await updateVerificationStep(user.id, 'businessDetails', {
      status: 'complete',
      fields: data,
      missingFields: []
    })

    await reloadRequest()
    setViewMode('overview')
  }

  const handleSkipBusinessDetails = async () => {
    if (!user || !request) return

    await updateVerificationStep(user.id, 'businessDetails', {
      status: 'complete',
      fields: {},
      missingFields: []
    })

    await reloadRequest()
    setViewMode('overview')
  }

  // Handle wizard step completion
  const handleWizardStepComplete = async (stepId: string, data?: Record<string, any>) => {
    if (!user || !request) return

    await updateVerificationStep(user.id, stepId as keyof VerificationRequest['steps'], {
      status: 'complete',
      fields: data || {},
      missingFields: []
    })

    await reloadRequest()
  }

  const handleSubmit = async () => {
    if (!user || !request) return

    try {
      setError('')
      await submitVerificationForReview(user.id)
      await reloadRequest()
      setViewMode('overview')
    } catch (err: any) {
      setError(err.message || 'Failed to submit verification')
    }
  }

  const handleRestart = async () => {
    if (!user || !request) return

    try {
      setRestarting(true)
      setError('')
      await restartVerification(user.id)
      await reloadRequest()
      setViewMode('overview')
    } catch (err: any) {
      setError(err.message || 'Failed to restart verification')
    } finally {
      setRestarting(false)
    }
  }

  const handleEditStep = (stepId: keyof VerificationRequest['steps']) => {
    // During read-only states, keep the flow read-only and show the submitted details instead.
    const statusToUse = request ? (userIsVerified ? 'approved' : request.status) : null
    if (statusToUse && ['pending', 'pending_review', 'in_review', 'approved', 'rejected'].includes(statusToUse)) {
      setViewMode('review')
      return
    }

    const viewModes: Record<string, ViewMode> = {
      organizerInfo: 'organizerInfo',
      governmentId: 'governmentId',
      selfie: 'selfie',
      businessDetails: 'businessDetails',
    }

    setViewMode(viewModes[stepId] || 'overview')
  }

  if (authLoading || loading || restarting) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">
            {restarting ? 'Resetting verification...' : 'Loading verification...'}
          </p>
        </div>
      </div>
    )
  }

  if (error && !request) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="bg-red-500/10 rounded-2xl p-6 max-w-md">
          <h2 className="mb-2 font-display lowercase italic !text-[22px] !leading-snug text-red-200">{t('verification_page.error_loading')}</h2>
          <p className="text-sm text-red-200 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2.5 bg-white text-black font-semibold rounded hover:bg-white/90 transition-colors"
          >
            {t('actions.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!request || !user) {
    return null
  }

  const statusForUI = effectiveStatus || request.status
  const requestForUI: VerificationRequest = statusForUI === request.status ? request : ({ ...request, status: statusForUI } as VerificationRequest)
  const completionPercentage = statusForUI === 'approved' ? 100 : calculateCompletionPercentage(requestForUI)
  const isReadOnly = ['pending', 'in_review', 'approved', 'rejected'].includes(statusForUI)
  const canSubmit = canSubmitForReview(requestForUI)

  // Welcome screen for new users
  if (viewMode === 'welcome') {
    return (
      <VerificationWelcome 
        onStart={() => setViewMode('wizard')} 
      />
    )
  }

  // Wizard view for users in progress
  if (viewMode === 'wizard') {
    return (
      <VerificationWizard
        request={requestForUI}
        userId={user.id}
        onStepComplete={handleWizardStepComplete}
        onComplete={() => setViewMode('review')}
        onExit={() => setViewMode('overview')}
      />
    )
  }

  return (
    <div className="bg-[#0a0a0a]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-white/60 mb-2">
            <Link href="/organizer" className="hover:text-white">
              {t('actions.organizer')}
            </Link>
            <span className="text-white/40">/</span>
            <span className="text-white font-medium">{t('verification_page.verification')}</span>
          </div>
          <SectionHeader
            title={t('verification_page.verification')}
            description={t('verification_page.verify_to_publish')}
          />
        </div>

        {/* Status Hero */}
        <VerificationStatusHero
          status={statusForUI}
          completionPercentage={completionPercentage}
          reviewNotes={request.reviewNotes}
          onRestart={handleRestart}
          isRestarting={restarting}
        />

        {statusForUI === 'approved' && !wantsDetails ? (
          <div className="bg-emerald-500/10 rounded-2xl p-4 md:p-5 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">{t('verification_page.already_verified')}</div>
                <div className="text-sm text-white/60 mt-1">{t('verification_page.head_to_dashboard')}</div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Link
                  href="/organizer/verify?details=1"
                  className="px-4 py-2 rounded font-semibold text-sm text-white bg-white/[0.07] hover:bg-white/[0.12] transition-colors text-center"
                >
                  {t('verification_page.view_verification_details')}
                </Link>
                <Link
                  href="/organizer"
                  className="px-4 py-2 rounded font-semibold text-sm text-black bg-white hover:bg-white/90 transition-colors text-center"
                >
                  {t('verification_page.go_to_dashboard')}
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="bg-red-500/10 rounded-xl p-4 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-red-200">{t('verification_page.something_went_wrong')}</div>
                <div className="text-sm text-red-200/80 mt-1">{error}</div>
              </div>
              <button
                onClick={dismissError}
                className="text-sm font-medium text-white/70 hover:text-white"
              >
                {t('actions.dismiss')}
              </button>
            </div>
          </div>
        ) : null}

        {/* Main Content */}
        {viewMode === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <VerificationStepper
                request={requestForUI}
                onEditStep={handleEditStep}
                isReadOnly={isReadOnly}
              />
            </div>

            <aside className="lg:col-span-1">
              <div className="bg-white/[0.055] rounded-2xl p-5 md:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('verification_page.submission')}</h2>
                    <p className="text-sm text-white/60 mt-1">
                      {statusForUI === 'approved'
                        ? 'Your verification is approved. You can view the details anytime.'
                        : isReadOnly
                          ? 'Your verification is submitted. You can view the details anytime.'
                          : canSubmit
                            ? 'Everything required is complete. Review your details and submit for approval.'
                            : 'Complete the required steps to unlock submission.'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/50">{t('actions.progress')}</div>
                    <div className="text-sm font-semibold text-white">{completionPercentage}%</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="w-full bg-white/10 rounded h-2">
                    <div
                      className="bg-brand-400 h-2 rounded transition-all"
                      style={{ width: `${completionPercentage}%` }}
                    />
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <button
                    onClick={() => setViewMode('review')}
                    className={`w-full px-4 py-3 rounded font-semibold transition-colors ${
                      isReadOnly
                        ? 'bg-white/[0.07] hover:bg-white/[0.12] text-white'
                        : canSubmit
                          ? 'bg-white hover:bg-white/90 text-black'
                          : 'bg-white/[0.07] text-white/40 cursor-not-allowed'
                    }`}
                    disabled={!isReadOnly && !canSubmit}
                  >
                    {statusForUI === 'approved'
                      ? 'View Verification Details'
                      : isReadOnly
                        ? 'View Submission Details'
                        : canSubmit
                          ? 'Review & Submit'
                          : 'Complete Required Steps'}
                  </button>

                  {!isReadOnly ? (
                    <p className="text-xs text-white/60">
                      {t('verification_page.reviewed_24_48')}
                    </p>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        )}

        {viewMode === 'organizerInfo' && (
          <OrganizerInfoForm
            initialData={request.steps.organizerInfo.fields}
            onSave={handleSaveOrganizerInfo}
            onCancel={() => setViewMode('overview')}
          />
        )}

        {viewMode === 'governmentId' && (
          <GovernmentIDForm
            userId={user.id}
            initialData={{
              frontPath: request.files.governmentId?.front,
              backPath: request.files.governmentId?.back
            }}
            onSave={handleSaveGovernmentID}
            onCancel={() => setViewMode('overview')}
          />
        )}

        {viewMode === 'selfie' && (
          <SelfieForm
            userId={user.id}
            initialData={{
              selfiePath: request.files.selfie?.path
            }}
            onSave={handleSaveSelfie}
            onCancel={() => setViewMode('overview')}
          />
        )}

        {viewMode === 'businessDetails' && (
          <BusinessDetailsForm
            initialData={request.steps.businessDetails.fields}
            onSave={handleSaveBusinessDetails}
            onCancel={() => setViewMode('overview')}
            onSkip={handleSkipBusinessDetails}
          />
        )}

        {viewMode === 'review' && (
          <ReviewSubmitPanel
            request={requestForUI}
            onSubmit={handleSubmit}
            onBack={() => setViewMode('overview')}
            isReadOnly={isReadOnly}
          />
        )}
      </div>    </div>
  )
}
