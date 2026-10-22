'use client'

import { useState, useEffect } from 'react'
import { 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  User, 
  CreditCard, 
  Camera, 
  Building2,
  AlertCircle,
  Loader2,
  Upload,
  Sparkles,
  ClipboardCheck
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  VerificationRequest,
  uploadVerificationDocument,
  updateVerificationFiles
} from '@/lib/verification'
import DocumentUploadCard from './DocumentUploadCard'

interface VerificationWizardProps {
  request: VerificationRequest
  userId: string
  onStepComplete: (stepId: string, data?: Record<string, any>) => Promise<void>
  onComplete: () => void
  onExit: () => void
}

const STEPS = [
  {
    id: 'organizerInfo',
    title: 'Personal Information',
    description: 'Tell us about yourself',
    icon: User,
    required: true,
  },
  {
    id: 'governmentId',
    title: 'Government ID',
    description: 'Upload your identification',
    icon: CreditCard,
    required: true,
  },
  {
    id: 'selfie',
    title: 'Selfie Verification',
    description: 'Take a quick photo',
    icon: Camera,
    required: true,
  },
  {
    id: 'businessDetails',
    title: 'Business Details',
    description: 'Optional business info',
    icon: Building2,
    required: false,
  },
  {
    id: 'review',
    title: 'Review & Submit',
    description: 'Confirm everything looks right',
    icon: ClipboardCheck,
    required: false,
  },
]

function ReviewRow({ label, value }: { label: string; value?: string }) {
  const { t } = useTranslation('organizer')
  const filled = Boolean(value && value.trim())
  return (
    <div>
      <dt className="text-white/50">{label}</dt>
      {/* An empty row used to render the literal string ", " — left behind when
          the em-dash sweep replaced this placeholder's dash with a comma. */}
      <dd className={filled ? 'text-white' : 'text-white/40'}>
        {filled ? value : t('onboarding.verification.review.not_provided', { defaultValue: 'Not provided' })}
      </dd>
    </div>
  )
}

function ReviewDoc({ ok, label }: { ok: boolean; label: string }) {
  const { t } = useTranslation('organizer')
  return (
    <li className="flex items-center gap-2">
      <span className={`grid h-5 w-5 place-items-center rounded-full ${ok ? 'text-emerald-300' : 'bg-white/[0.10] text-white/40'}`}>
        {ok ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      </span>
      <span className={ok ? 'text-white' : 'text-white/50'}>{label}</span>
      {!ok && <span className="text-xs font-medium text-amber-300">{t('onboarding.verification.missing', { defaultValue: 'Missing' })}</span>}
    </li>
  )
}

export default function VerificationWizard({
  request,
  userId,
  onStepComplete,
  onComplete,
  onExit,
}: VerificationWizardProps) {
  const { t } = useTranslation('organizer')
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  
  // Form states for organizer info
  const [organizerForm, setOrganizerForm] = useState({
    full_name: request.steps.organizerInfo?.fields?.full_name || '',
    phone: request.steps.organizerInfo?.fields?.phone || '',
    organization_name: request.steps.organizerInfo?.fields?.organization_name || '',
    organization_type: request.steps.organizerInfo?.fields?.organization_type || 'individual',
    email: request.steps.organizerInfo?.fields?.email || '',
    address: request.steps.organizerInfo?.fields?.address || '',
    city: request.steps.organizerInfo?.fields?.city || '',
    country: request.steps.organizerInfo?.fields?.country || 'Haiti'
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  
  // ID upload states
  const [idFrontPath, setIdFrontPath] = useState(request.files.governmentId?.front)
  const [idBackPath, setIdBackPath] = useState(request.files.governmentId?.back)
  
  // Selfie state
  const [selfiePath, setSelfiePath] = useState(request.files.selfie?.path)
  
  // Business form state
  const [businessForm, setBusinessForm] = useState({
    business_registration_number: request.steps.businessDetails?.fields?.business_registration_number || '',
    tax_id: request.steps.businessDetails?.fields?.tax_id || '',
    business_type: request.steps.businessDetails?.fields?.business_type || '',
    registration_date: request.steps.businessDetails?.fields?.registration_date || ''
  })

  // Find the first incomplete required step on mount
  useEffect(() => {
    const firstIncomplete = STEPS.findIndex((step) => {
      const stepData = request.steps[step.id as keyof typeof request.steps]
      return step.required && stepData?.status !== 'complete'
    })
    if (firstIncomplete !== -1) {
      setCurrentStepIndex(firstIncomplete)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentStep = STEPS[currentStepIndex]
  const currentStepData = request.steps[currentStep.id as keyof typeof request.steps]

  const getStepStatus = (stepId: string) => {
    const stepData = request.steps[stepId as keyof typeof request.steps]
    return stepData?.status || 'incomplete'
  }

  const isStepComplete = (stepId: string) => getStepStatus(stepId) === 'complete'

  const completedSteps = STEPS.filter(s => isStepComplete(s.id)).length
  const requiredSteps = STEPS.filter(s => s.required)
  const allRequiredComplete = requiredSteps.every(s => isStepComplete(s.id))

  const handleNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1)
      setError('')
    } else if (allRequiredComplete) {
      onComplete()
    }
  }

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1)
      setError('')
    }
  }

  const handleSaveStep = async (data?: Record<string, any>) => {
    try {
      setSaving(true)
      setError('')
      await onStepComplete(currentStep.id, data)
      handleNext()
    } catch (err: any) {
      setError(err.message || t('onboarding.verification.errors.save_failed', { defaultValue: 'Failed to save. Please try again.' }))
    } finally {
      setSaving(false)
    }
  }

  const handleSkipStep = async () => {
    try {
      setSaving(true)
      setError('')
      await onStepComplete(currentStep.id, {})
      handleNext()
    } catch (err: any) {
      setError(err.message || t('onboarding.verification.errors.skip_failed', { defaultValue: 'Failed to skip. Please try again.' }))
    } finally {
      setSaving(false)
    }
  }

  // Validate organizer info
  const validateOrganizerInfo = (): boolean => {
    const newErrors: Record<string, string> = {}
    const normalizedPhone = String(organizerForm.phone || '').replace(/[\s\-()]/g, '')

    if (!organizerForm.full_name.trim()) {
      newErrors.full_name = t('onboarding.verification.errors.full_name_required', { defaultValue: 'Full name is required' })
    }
    if (!organizerForm.phone.trim()) {
      newErrors.phone = t('onboarding.verification.errors.phone_required', { defaultValue: 'Phone number is required' })
    } else if (!/^\+?\d{10,}$/.test(normalizedPhone)) {
      newErrors.phone = t('onboarding.verification.errors.phone_invalid', { defaultValue: 'Invalid phone number format' })
    }
    if (!organizerForm.organization_name.trim()) {
      newErrors.organization_name = t('onboarding.verification.errors.organization_name_required', { defaultValue: 'Organization name is required' })
    }

    setFormErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Handle saving current step
  const handleSaveCurrentStep = async () => {
    try {
      setSaving(true)
      setError('')
      setFormErrors({})

      if (currentStep.id === 'organizerInfo') {
        if (!validateOrganizerInfo()) {
          setSaving(false)
          return
        }
        await onStepComplete(currentStep.id, organizerForm)
      } else if (currentStep.id === 'governmentId') {
        if (!idFrontPath || !idBackPath) {
          setError(t('onboarding.verification.errors.upload_both_id', { defaultValue: 'Please upload both front and back of your ID' }))
          setSaving(false)
          return
        }
        await onStepComplete(currentStep.id)
      } else if (currentStep.id === 'selfie') {
        if (!selfiePath) {
          setError(t('onboarding.verification.errors.upload_selfie', { defaultValue: 'Please upload a selfie for identity verification' }))
          setSaving(false)
          return
        }
        await onStepComplete(currentStep.id)
      } else if (currentStep.id === 'businessDetails') {
        await onStepComplete(currentStep.id, businessForm)
      }

      handleNext()
    } catch (err: any) {
      setError(err.message || t('onboarding.verification.errors.save_failed', { defaultValue: 'Failed to save. Please try again.' }))
    } finally {
      setSaving(false)
    }
  }

  // ID upload handlers
  const handleIdFrontUpload = async (file: File) => {
    try {
      const path = await uploadVerificationDocument(userId, file, 'id_front')
      setIdFrontPath(path)
      const updateData: any = { governmentId: { front: path, uploadedAt: new Date() } }
      if (idBackPath) updateData.governmentId.back = idBackPath
      await updateVerificationFiles(userId, updateData)
    } catch (err: any) {
      throw new Error(err.message || t('onboarding.verification.errors.upload_id_front_failed', { defaultValue: 'Failed to upload ID front' }))
    }
  }

  const handleIdBackUpload = async (file: File) => {
    try {
      const path = await uploadVerificationDocument(userId, file, 'id_back')
      setIdBackPath(path)
      const updateData: any = { governmentId: { back: path, uploadedAt: new Date() } }
      if (idFrontPath) updateData.governmentId.front = idFrontPath
      await updateVerificationFiles(userId, updateData)
    } catch (err: any) {
      throw new Error(err.message || t('onboarding.verification.errors.upload_id_back_failed', { defaultValue: 'Failed to upload ID back' }))
    }
  }

  // Selfie upload handler
  const handleSelfieUpload = async (file: File) => {
    try {
      const path = await uploadVerificationDocument(userId, file, 'selfie')
      setSelfiePath(path)
      await updateVerificationFiles(userId, { selfie: { path, uploadedAt: new Date() } })
    } catch (err: any) {
      throw new Error(err.message || t('onboarding.verification.errors.upload_selfie_failed', { defaultValue: 'Failed to upload selfie' }))
    }
  }

  const progressPercentage = ((currentStepIndex + 1) / STEPS.length) * 100

  // No fill on this wrapper. The wizard REPLACES the page (app/organizer/verify
  // returns it instead of the overview), so this div is the canvas, not a card
  // — and tinting the whole viewport 3% meant the 3% step panel nested inside it
  // was exactly the same colour and read as nothing. The panels below sit on
  // the page's own #0a0a0a and their fills do the separating.
  return (
    <div className="min-h-[80vh]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={onExit}
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('onboarding.verification.save_exit', { defaultValue: 'Save & Exit' })}
          </button>
          
          {/* Progress Bar */}
          <div className="bg-white/[0.055] rounded-2xl p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white">
                {t('onboarding.verification.step_of', {
                  defaultValue: 'Step {{current}} of {{total}}',
                  current: currentStepIndex + 1,
                  total: STEPS.length,
                })}
              </h2>
              <span className="text-sm text-white/60">
                {t('onboarding.verification.required_complete', {
                  defaultValue: '{{completed}} of {{total}} required complete',
                  completed: completedSteps,
                  total: requiredSteps.length,
                })}
              </span>
            </div>
            
            {/* Step Indicators */}
            <div className="flex items-center gap-2">
              {STEPS.map((step, index) => {
                const isComplete = isStepComplete(step.id)
                const isCurrent = index === currentStepIndex
                const isPast = index < currentStepIndex
                
                return (
                  <div key={step.id} className="flex-1 flex items-center">
                    <button
                      onClick={() => {
                        setCurrentStepIndex(index)
                        setError('')
                      }}
                      className={`
                        w-8 h-8 rounded flex items-center justify-center text-xs font-semibold transition-all
                        ${isComplete
                          ? 'bg-emerald-500 text-white'
                          : isCurrent
                            ? 'bg-white text-black ring-4 ring-white/10'
                            : isPast
                              ? 'bg-white/[0.12] text-white/70'
                              : 'bg-white/[0.055] text-white/45'
                        }
                      `}
                    >
                      {isComplete ? <Check className="w-4 h-4" /> : index + 1}
                    </button>
                    {index < STEPS.length - 1 && (
                      <div
                        className={`flex-1 h-1 mx-2 rounded transition-colors ${
                          isComplete || isPast ? 'bg-emerald-500' : 'bg-white/[0.08]'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Current Step Info */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.07] flex items-center justify-center">
              <currentStep.icon className="w-6 h-6 text-white" />
            </div>
            <div>
              {/* `!` on the size: `.mobile-typography h1` (0,1,1) beats a bare
                  arbitrary size (0,1,0) under 640px, leading included. */}
              <h1 className="font-display lowercase italic !text-[24px] !leading-[1.06] text-white md:!text-[28px]">
                {t(`onboarding.verification.steps.${currentStep.id}.title`, { defaultValue: currentStep.title })}
              </h1>
              <p className="text-white/60">
                {t(`onboarding.verification.steps.${currentStep.id}.description`, { defaultValue: currentStep.description })}
                {!currentStep.required && (
                  <span className="ml-2 text-xs font-medium text-white/45">
                    {t('onboarding.verification.optional', { defaultValue: 'Optional' })}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* What you'll need — shown on the first step so organizers don't bail mid-flow */}
        {currentStepIndex === 0 && (
          <div className="mb-6 bg-white/[0.055] rounded-xl p-4">
            <h4 className="text-sm font-semibold text-white mb-1.5">{t('onboarding.verification.before_you_start', { defaultValue: 'Before you start' })}</h4>
            <p className="text-sm text-white/65 mb-2">
              {t('onboarding.verification.before_you_start_intro', { defaultValue: 'Have these ready. It takes about 5 minutes, and your progress saves as you go:' })}
            </p>
            <ul className="text-sm text-white/65 space-y-1 ml-5 list-disc">
              <li>{t('onboarding.verification.checklist_id', { defaultValue: 'A government-issued ID (front & back)' })}</li>
              <li>{t('onboarding.verification.checklist_selfie', { defaultValue: 'Your phone or webcam for a quick selfie holding your ID' })}</li>
              <li>{t('onboarding.verification.checklist_org', { defaultValue: 'Your organization name and contact details' })}</li>
            </ul>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-500/10 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-200">{t('onboarding.verification.error_label', { defaultValue: 'Error' })}</p>
              <p className="text-sm text-red-200/80">{error}</p>
            </div>
          </div>
        )}

        {/* Step Content */}
        <div className="bg-white/[0.055] rounded-2xl overflow-hidden">
          {currentStep.id === 'organizerInfo' && (
            <div className="p-5 md:p-6 space-y-5">
              {/* Full Name */}
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-white/70 mb-2">
                  {t('onboarding.verification.field.full_name', { defaultValue: 'Full Name' })} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="full_name"
                  value={organizerForm.full_name}
                  onChange={(e) => {
                    setOrganizerForm(prev => ({ ...prev, full_name: e.target.value }))
                    if (formErrors.full_name) setFormErrors(prev => ({ ...prev, full_name: '' }))
                  }}
                  className={`w-full rounded-lg px-4 py-3 text-white [color-scheme:dark] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400/50 ${
                    formErrors.full_name ? 'bg-red-500/10 ring-1 ring-inset ring-red-500/40' : 'bg-white/[0.055] hover:bg-white/[0.08] focus:bg-white/[0.08]'
                  }`}
                  placeholder={t('onboarding.verification.field.full_name_placeholder', { defaultValue: 'Your full name as it appears on your ID' })}
                />
                {formErrors.full_name && <p className="mt-1.5 text-sm text-red-300">{formErrors.full_name}</p>}
              </div>

              {/* Phone & Email Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.verification.field.phone', { defaultValue: 'Phone Number' })} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    value={organizerForm.phone}
                    onChange={(e) => {
                      setOrganizerForm(prev => ({ ...prev, phone: e.target.value }))
                      if (formErrors.phone) setFormErrors(prev => ({ ...prev, phone: '' }))
                    }}
                    className={`w-full rounded-lg px-4 py-3 text-white [color-scheme:dark] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400/50 ${
                      formErrors.phone ? 'bg-red-500/10 ring-1 ring-inset ring-red-500/40' : 'bg-white/[0.055] hover:bg-white/[0.08] focus:bg-white/[0.08]'
                    }`}
                    placeholder={t('onboarding.verification.field.phone_placeholder', { defaultValue: '+509 1234 5678' })}
                  />
                  {formErrors.phone && <p className="mt-1.5 text-sm text-red-300">{formErrors.phone}</p>}
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.verification.field.email', { defaultValue: 'Email Address' })}
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={organizerForm.email}
                    onChange={(e) => setOrganizerForm(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                    placeholder={t('onboarding.verification.field.email_placeholder', { defaultValue: 'email@example.com' })}
                  />
                </div>
              </div>

              {/* Organization Name */}
              <div>
                <label htmlFor="organization_name" className="block text-sm font-medium text-white/70 mb-2">
                  {t('onboarding.verification.field.organization_name', { defaultValue: 'Organization Name' })} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="organization_name"
                  value={organizerForm.organization_name}
                  onChange={(e) => {
                    setOrganizerForm(prev => ({ ...prev, organization_name: e.target.value }))
                    if (formErrors.organization_name) setFormErrors(prev => ({ ...prev, organization_name: '' }))
                  }}
                  className={`w-full rounded-lg px-4 py-3 text-white [color-scheme:dark] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400/50 ${
                    formErrors.organization_name ? 'bg-red-500/10 ring-1 ring-inset ring-red-500/40' : 'bg-white/[0.055] hover:bg-white/[0.08] focus:bg-white/[0.08]'
                  }`}
                  placeholder={t('onboarding.verification.field.organization_name_placeholder', { defaultValue: 'Your business or organization name' })}
                />
                {formErrors.organization_name && <p className="mt-1.5 text-sm text-red-300">{formErrors.organization_name}</p>}
              </div>

              {/* Organization Type */}
              <div>
                <label htmlFor="organization_type" className="block text-sm font-medium text-white/70 mb-2">
                  {t('onboarding.verification.field.organization_type', { defaultValue: 'Organization Type' })}
                </label>
                <select
                  id="organization_type"
                  value={organizerForm.organization_type}
                  onChange={(e) => setOrganizerForm(prev => ({ ...prev, organization_type: e.target.value }))}
                  className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                >
                  <option value="individual">{t('onboarding.verification.org_type.individual', { defaultValue: 'Individual/Sole Proprietor' })}</option>
                  <option value="company">{t('onboarding.verification.org_type.company', { defaultValue: 'Company/Corporation' })}</option>
                  <option value="nonprofit">{t('onboarding.verification.org_type.nonprofit', { defaultValue: 'Non-Profit Organization' })}</option>
                  <option value="other">{t('onboarding.verification.org_type.other', { defaultValue: 'Other' })}</option>
                </select>
              </div>

              {/* Address */}
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-white/70 mb-2">
                  {t('onboarding.verification.field.address', { defaultValue: 'Address' })}
                </label>
                <input
                  type="text"
                  id="address"
                  value={organizerForm.address}
                  onChange={(e) => setOrganizerForm(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  placeholder={t('onboarding.verification.field.address_placeholder', { defaultValue: 'Street address' })}
                />
              </div>

              {/* City & Country */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="city" className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.verification.field.city', { defaultValue: 'City' })}
                  </label>
                  <input
                    type="text"
                    id="city"
                    value={organizerForm.city}
                    onChange={(e) => setOrganizerForm(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                    placeholder={t('onboarding.verification.field.city_placeholder', { defaultValue: 'Port-au-Prince' })}
                  />
                </div>
                <div>
                  <label htmlFor="country" className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.verification.field.country', { defaultValue: 'Country' })}
                  </label>
                  <select
                    id="country"
                    value={organizerForm.country}
                    onChange={(e) => setOrganizerForm(prev => ({ ...prev, country: e.target.value }))}
                    className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  >
                    <option value="Haiti">{t('onboarding.verification.country.haiti', { defaultValue: 'Haiti' })}</option>
                    <option value="Dominican Republic">{t('onboarding.verification.country.dominican_republic', { defaultValue: 'Dominican Republic' })}</option>
                    <option value="Other">{t('onboarding.verification.country.other', { defaultValue: 'Other' })}</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {currentStep.id === 'governmentId' && (
            <div className="p-5 md:p-6 space-y-5">
              {/* Tips */}
              <div className="bg-white/[0.07] rounded-xl p-4">
                <h4 className="font-semibold text-white text-sm mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> {t('onboarding.verification.photo_tips', { defaultValue: 'Photo Tips' })}
                </h4>
                <ul className="text-sm text-white/65 space-y-1 ml-6 list-disc">
                  <li>{t('onboarding.verification.tip_readable', { defaultValue: 'Ensure all text is clearly readable' })}</li>
                  <li>{t('onboarding.verification.tip_lighting', { defaultValue: 'Use good lighting (avoid glare)' })}</li>
                  <li>{t('onboarding.verification.tip_background', { defaultValue: 'Place ID on a contrasting background' })}</li>
                </ul>
              </div>

              {/* Upload Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DocumentUploadCard
                  title={t('onboarding.verification.doc.id_front_title', { defaultValue: 'ID Front' })}
                  description={t('onboarding.verification.doc.id_front_desc', { defaultValue: 'Front side of your ID' })}
                  existingFileUrl={idFrontPath}
                  onUpload={handleIdFrontUpload}
                  onRemove={async () => setIdFrontPath(undefined)}
                  required
                />
                <DocumentUploadCard
                  title={t('onboarding.verification.doc.id_back_title', { defaultValue: 'ID Back' })}
                  description={t('onboarding.verification.doc.id_back_desc', { defaultValue: 'Back side of your ID' })}
                  existingFileUrl={idBackPath}
                  onUpload={handleIdBackUpload}
                  onRemove={async () => setIdBackPath(undefined)}
                  required
                />
              </div>
            </div>
          )}

          {currentStep.id === 'selfie' && (
            <div className="p-5 md:p-6 space-y-5">
              {/* Instructions */}
              <div className="bg-white/[0.07] rounded-xl p-4">
                <h4 className="font-semibold text-white text-sm mb-2">{t('onboarding.verification.selfie_how', { defaultValue: 'How to take a good selfie:' })}</h4>
                <ul className="text-sm text-white/65 space-y-1 ml-6 list-disc">
                  <li>{t('onboarding.verification.selfie_tip_hold', { defaultValue: 'Hold your ID next to your face' })}</li>
                  <li>{t('onboarding.verification.selfie_tip_face', { defaultValue: 'Make sure your face is clearly visible' })}</li>
                  <li>{t('onboarding.verification.selfie_tip_text', { defaultValue: 'Ensure the ID text is readable in the photo' })}</li>
                  <li>{t('onboarding.verification.selfie_tip_light', { defaultValue: 'Use good lighting and look at the camera' })}</li>
                </ul>
              </div>

              {/* Upload Card */}
              <DocumentUploadCard
                title={t('onboarding.verification.doc.selfie_title', { defaultValue: 'Selfie with ID' })}
                description={t('onboarding.verification.doc.selfie_desc', { defaultValue: 'Take a photo of yourself holding your ID' })}
                existingFileUrl={selfiePath}
                onUpload={handleSelfieUpload}
                onRemove={async () => setSelfiePath(undefined)}
                required
              />
            </div>
          )}

          {currentStep.id === 'businessDetails' && (
            <div className="p-5 md:p-6 space-y-5">
              <div className="bg-white/[0.06] rounded-xl p-4 mb-2">
                <p className="text-sm text-white/60">
                  {t('onboarding.verification.business_optional_note', { defaultValue: 'This step is optional. Add business details if you have a registered business.' })}
                </p>
              </div>

              {/* Business Registration Number */}
              <div>
                <label htmlFor="business_registration_number" className="block text-sm font-medium text-white/70 mb-2">
                  {t('onboarding.verification.field.business_registration_number', { defaultValue: 'Business Registration Number' })}
                </label>
                <input
                  type="text"
                  id="business_registration_number"
                  value={businessForm.business_registration_number}
                  onChange={(e) => setBusinessForm(prev => ({ ...prev, business_registration_number: e.target.value }))}
                  className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  placeholder={t('onboarding.verification.field.business_registration_number_placeholder', { defaultValue: 'e.g., RC-12345' })}
                />
              </div>

              {/* Tax ID */}
              <div>
                <label htmlFor="tax_id" className="block text-sm font-medium text-white/70 mb-2">
                  {t('onboarding.verification.field.tax_id', { defaultValue: 'Tax ID Number (NIF)' })}
                </label>
                <input
                  type="text"
                  id="tax_id"
                  value={businessForm.tax_id}
                  onChange={(e) => setBusinessForm(prev => ({ ...prev, tax_id: e.target.value }))}
                  className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  placeholder={t('onboarding.verification.field.tax_id_placeholder', { defaultValue: 'e.g., NIF-123456789' })}
                />
              </div>

              {/* Business Type & Registration Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="business_type" className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.verification.field.business_type', { defaultValue: 'Business Type' })}
                  </label>
                  <select
                    id="business_type"
                    value={businessForm.business_type}
                    onChange={(e) => setBusinessForm(prev => ({ ...prev, business_type: e.target.value }))}
                    className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  >
                    <option value="">{t('onboarding.verification.business_type.select', { defaultValue: 'Select type' })}</option>
                    <option value="sole_proprietorship">{t('onboarding.verification.business_type.sole_proprietorship', { defaultValue: 'Sole Proprietorship' })}</option>
                    <option value="partnership">{t('onboarding.verification.business_type.partnership', { defaultValue: 'Partnership' })}</option>
                    <option value="corporation">{t('onboarding.verification.business_type.corporation', { defaultValue: 'Corporation' })}</option>
                    <option value="nonprofit">{t('onboarding.verification.business_type.nonprofit', { defaultValue: 'Non-Profit' })}</option>
                    <option value="cooperative">{t('onboarding.verification.business_type.cooperative', { defaultValue: 'Cooperative' })}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="registration_date" className="block text-sm font-medium text-white/70 mb-2">
                    {t('onboarding.verification.field.registration_date', { defaultValue: 'Registration Date' })}
                  </label>
                  <input
                    type="date"
                    id="registration_date"
                    value={businessForm.registration_date}
                    onChange={(e) => setBusinessForm(prev => ({ ...prev, registration_date: e.target.value }))}
                    className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  />
                </div>
              </div>
            </div>
          )}

          {currentStep.id === 'review' && (
            <div className="p-5 md:p-6 space-y-4">
              <p className="text-sm text-white/60">
                {t('onboarding.verification.review_intro', { defaultValue: 'Please confirm everything is correct before submitting. You can edit any section.' })}
              </p>

              {/* Personal information */}
              <div className="bg-white/[0.07] rounded-xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('onboarding.verification.review.personal_information', { defaultValue: 'Personal information' })}</h3>
                  <button type="button" onClick={() => setCurrentStepIndex(0)} className="text-sm font-medium text-brand-300 hover:text-brand-300">{t('onboarding.verification.review.edit', { defaultValue: 'Edit' })}</button>
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <ReviewRow label={t('onboarding.verification.review.full_name', { defaultValue: 'Full name' })} value={organizerForm.full_name} />
                  <ReviewRow label={t('onboarding.verification.review.phone', { defaultValue: 'Phone' })} value={organizerForm.phone} />
                  <ReviewRow label={t('onboarding.verification.review.email', { defaultValue: 'Email' })} value={organizerForm.email} />
                  <ReviewRow label={t('onboarding.verification.review.organization', { defaultValue: 'Organization' })} value={organizerForm.organization_name} />
                  <ReviewRow label={t('onboarding.verification.review.type', { defaultValue: 'Type' })} value={organizerForm.organization_type} />
                  <ReviewRow label={t('onboarding.verification.review.location', { defaultValue: 'Location' })} value={[organizerForm.address, organizerForm.city, organizerForm.country].filter(Boolean).join(', ')} />
                </dl>
              </div>

              {/* Documents */}
              <div className="bg-white/[0.07] rounded-xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('onboarding.verification.review.identity_documents', { defaultValue: 'Identity documents' })}</h3>
                  <button type="button" onClick={() => setCurrentStepIndex(1)} className="text-sm font-medium text-brand-300 hover:text-brand-300">{t('onboarding.verification.review.edit', { defaultValue: 'Edit' })}</button>
                </div>
                <ul className="space-y-2 text-sm">
                  <ReviewDoc ok={!!idFrontPath} label={t('onboarding.verification.review.doc_id_front', { defaultValue: 'Government ID, front' })} />
                  <ReviewDoc ok={!!idBackPath} label={t('onboarding.verification.review.doc_id_back', { defaultValue: 'Government ID, back' })} />
                  <ReviewDoc ok={!!selfiePath} label={t('onboarding.verification.review.doc_selfie', { defaultValue: 'Selfie with ID' })} />
                </ul>
              </div>

              {/* Business (only if provided) */}
              {(businessForm.business_registration_number || businessForm.tax_id || businessForm.business_type) && (
                <div className="bg-white/[0.07] rounded-xl p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('onboarding.verification.review.business_details', { defaultValue: 'Business details' })}</h3>
                    <button type="button" onClick={() => setCurrentStepIndex(3)} className="text-sm font-medium text-brand-300 hover:text-brand-300">{t('onboarding.verification.review.edit', { defaultValue: 'Edit' })}</button>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <ReviewRow label={t('onboarding.verification.review.reg_number', { defaultValue: 'Reg. number' })} value={businessForm.business_registration_number} />
                    <ReviewRow label={t('onboarding.verification.review.tax_id', { defaultValue: 'Tax ID' })} value={businessForm.tax_id} />
                    <ReviewRow label={t('onboarding.verification.review.type', { defaultValue: 'Type' })} value={businessForm.business_type} />
                  </dl>
                </div>
              )}

              <div className="rounded-xl bg-white/[0.07] p-4 text-sm text-white/65">
                {t('onboarding.verification.review.submit_disclaimer', { defaultValue: 'By submitting, you confirm this information is accurate. Our team reviews it usually within 1–2 business days, and you’ll be notified once approved, which unlocks withdrawals.' })}
              </div>
            </div>
          )}
        </div>

        {/* Navigation Footer */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={handlePrevious}
            disabled={currentStepIndex === 0 || saving}
            className={`
              flex items-center gap-2 px-4 py-2.5 rounded text-sm font-semibold transition-all
              ${currentStepIndex === 0
                ? 'text-white/40 cursor-not-allowed'
                : 'text-white/70 hover:bg-white/[0.07] hover:text-white'
              }
            `}
          >
            <ArrowLeft className="w-4 h-4" />
            {t('onboarding.verification.nav.previous', { defaultValue: 'Previous' })}
          </button>

          <div className="flex items-center gap-3">
            {!currentStep.required && !isStepComplete(currentStep.id) && (
              <button
                onClick={handleSkipStep}
                disabled={saving}
                className="px-4 py-2.5 rounded text-sm font-semibold text-white bg-white/[0.07] hover:bg-white/[0.12] transition-colors"
              >
                {t('onboarding.verification.nav.skip_for_now', { defaultValue: 'Skip for now' })}
              </button>
            )}
            
            {currentStepIndex === STEPS.length - 1 && allRequiredComplete ? (
              <button
                onClick={onComplete}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded text-sm font-semibold bg-white text-black hover:bg-white/90 transition-all"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {t('onboarding.verification.nav.submit_for_review', { defaultValue: 'Submit for review' })}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleSaveCurrentStep}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded text-sm font-semibold bg-white text-black hover:bg-white/90 transition-all"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isStepComplete(currentStep.id) ? (
                  <>
                    {t('onboarding.verification.nav.next_step', { defaultValue: 'Next Step' })}
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    {t('onboarding.verification.nav.save_continue', { defaultValue: 'Save & Continue' })}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
