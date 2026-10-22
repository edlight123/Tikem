'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ConsoleButton, ConsoleState, consoleAgeClass, consoleTone, useConsoleNow } from '@/components/admin/console'
import { formatAge } from '@/lib/admin/age'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useToast } from '@/components/ui/Toast'

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

async function getAdminSignedUrl(storagePath: string): Promise<string> {
  const response = await fetch(`/api/admin/verification-image?path=${encodeURIComponent(storagePath)}`)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Failed to get signed URL (${response.status}): ${text}`)
  }
  const json = (await response.json()) as { url?: string }
  if (!json.url) throw new Error('Signed URL missing from response')
  return json.url
}

async function resolveProofUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  if (isHttpUrl(value)) return value
  return await getAdminSignedUrl(value)
}

function parsePossibleDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // Firestore Timestamp shapes
  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate()
      return d instanceof Date ? d : null
    } catch {
      return null
    }
  }
  if (typeof value?._seconds === 'number') {
    const d = new Date(value._seconds * 1000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const submittedAtFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
})

function formatSubmittedAt(date: Date): string {
  // Deterministic formatting avoids server/client timezone/locale hydration mismatches.
  return submittedAtFormatter.format(date)
}

function formatFieldValue(value: any): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatFieldValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

interface Props {
  request: any
  user: any
}

export default function VerificationRequestReview({ request, user }: Props) {
  const router = useRouter()
  const confirmDialog = useConfirm()
  const { showToast } = useToast()
  const [reviewing, setReviewing] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<{
    idFrontUrl: string | null
    idBackUrl: string | null
    facePhotoUrl: string | null
    businessRegistrationUrl?: string | null
    taxIdUrl?: string | null
    livenessUrl?: string | null
  }>({
    idFrontUrl: null,
    idBackUrl: null,
    facePhotoUrl: null,
    businessRegistrationUrl: null,
    taxIdUrl: null,
    livenessUrl: null,
  })
  const [loadingImages, setLoadingImages] = useState(true)
  /**
   * "Now" is only known on the client. Rendering an age during SSR would bake a
   * server clock into the HTML and mismatch on hydration a minute later, so the
   * age appears once mounted — the same reason the submitted date is formatted
   * with a fixed locale and timezone below.
   */
  const now = useConsoleNow()

  // Load image URLs using client-side Firebase SDK
  useEffect(() => {
    async function loadImageUrls() {
      try {
        // Support both the new structured schema (files.* are Storage paths)
        // and legacy flat fields (some deployments stored direct URLs).
        const idFrontRef =
          request.files?.governmentId?.front ||
          request.id_front_path ||
          request.idFrontPath ||
          request.id_front_url ||
          null

        const idBackRef =
          request.files?.governmentId?.back ||
          request.id_back_path ||
          request.idBackPath ||
          request.id_back_url ||
          null

        const selfieRef =
          request.files?.selfie?.path ||
          request.selfie_path ||
          request.face_photo_path ||
          request.face_photo_url ||
          null

        const businessRegistrationRef =
          request.files?.businessDocs?.registration ||
          request.business_registration_path ||
          request.business_registration_url ||
          null

        const taxIdRef =
          request.files?.businessDocs?.taxId ||
          request.tax_id_path ||
          request.tax_id_url ||
          null

        // The liveness clip. Without it a selfie is just a picture, and a
        // picture of a picture looks identical.
        const livenessRef = request.files?.liveness?.path || null

        const [idFrontUrl, idBackUrl, facePhotoUrl, businessRegistrationUrl, taxIdUrl, livenessUrl] =
          await Promise.all([
            resolveProofUrl(idFrontRef).catch(() => null),
            resolveProofUrl(idBackRef).catch(() => null),
            resolveProofUrl(selfieRef).catch(() => null),
            resolveProofUrl(businessRegistrationRef).catch(() => null),
            resolveProofUrl(taxIdRef).catch(() => null),
            resolveProofUrl(livenessRef).catch(() => null),
          ])

        setImageUrls({ idFrontUrl, idBackUrl, facePhotoUrl, businessRegistrationUrl, taxIdUrl, livenessUrl })
      } catch (error) {
        console.error('Error loading images:', error)
      } finally {
        setLoadingImages(false)
      }
    }

    loadImageUrls()
  }, [request])

  // Normalize date
  const submittedDate =
    parsePossibleDate(request.submittedAt) ||
    parsePossibleDate(request.submitted_at) ||
    parsePossibleDate(request.createdAt) ||
    parsePossibleDate(request.created_at) ||
    null

  /**
   * How long this request has been waiting. Documents in this collection are
   * inconsistent about which timestamp field they carry, so the age rides on the
   * same first-one-that-parses chain as the submitted date above rather than on
   * any single field name.
   */
  const submittedIso = submittedDate ? submittedDate.toISOString() : null
  const age = now && submittedIso ? formatAge(submittedIso, now) : null
  const ageColor = now && submittedIso ? consoleAgeClass(submittedIso, now) : ''
  const ageTitle = submittedDate
    ? `Waiting since ${formatSubmittedAt(submittedDate)} (UTC)`
    : undefined

  const steps = request.steps || null

  const organizerCountry: string | null =
    request?.steps?.organizerInfo?.fields?.country ||
    request?.steps?.organizerInfo?.fields?.country_name ||
    request?.organizer_country ||
    null
  const isHaitiOrganizer = String(organizerCountry || '').toLowerCase() === 'haiti'
  /** Which document was submitted — decides whether a "back" should even exist. */
  const docType = String((request as any)?.files?.governmentId?.documentType || '')

  /**
   * The liveness clip, shown WITH the challenge it was recorded against.
   *
   * The sequence is the point. It is generated fresh for every attempt, so the
   * reviewer's job is not "does this look like a real person" — a good screen
   * replay passes that — but "did they do THESE things in THIS order". A clip
   * that does not match its own challenge is a replay no matter how convincing
   * the face is.
   */
  const renderLiveness = () => {
    const liveness = (request as any)?.files?.liveness
    const sequence: { id: string; signal: string }[] = liveness?.sequence || []

    if (!imageUrls.livenessUrl) {
      return (
        <div className="rounded-lg bg-console-panel p-3">
          <p className="text-sm font-medium text-console-amber">No liveness recording</p>
          <p className="mt-1 text-xs text-console-mut">
            This organizer submitted before the liveness step existed, or skipped it. A still
            selfie alone does not show a live person was present, ask them to record one before
            approving.
          </p>
        </div>
      )
    }

    return (
      <div className="rounded-lg bg-console-panel p-3">
        <p className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Liveness recording</p>
        <video
          src={imageUrls.livenessUrl}
          controls
          playsInline
          className="w-full max-w-sm rounded-lg"
        />
        {sequence.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs text-console-mut">
              They were asked to do this, in this order, check the recording matches:
            </p>
            <ol className="mt-1.5 space-y-1">
              {sequence.map((step, i) => (
                <li key={`${step.id}-${i}`} className="text-sm text-console-text">
                  <span className="text-console-faint">{i + 1}.</span>{' '}
                  {String(step.id).replace(/_/g, ' ')}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mt-2 text-xs text-console-amber">
            No challenge sequence was recorded with this clip, so it cannot be checked against one.
          </p>
        )}
      </div>
    )
  }

  const renderImageThumb = (label: string, url: string | null, alt: string) => {
    return (
      <div>
        <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1 sm:mb-2">{label}</p>
        {url ? (
          <div
            onClick={() => setSelectedImage(url)}
            className="relative aspect-[1.586/1] bg-console-ground rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Image
              src={url}
              alt={alt}
              fill
              sizes="(max-width: 640px) 100vw, 33vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 hover:bg-opacity-10 transition-opacity">
              <svg className="w-8 h-8 text-console-text opacity-0 hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </div>
          </div>
        ) : (
          <div className="aspect-[1.586/1] bg-console-ground rounded-lg flex items-center justify-center">
            <p className="text-[12px] sm:text-sm text-console-faint">Not provided</p>
          </div>
        )}
      </div>
    )
  }

  const renderProofForStep = (stepKeyOrId: string) => {
    const normalized = (stepKeyOrId || '').toLowerCase()

    if (normalized.includes('payoutsetup') || normalized.includes('payout_setup')) {
      return (
        <div className="mt-3 rounded-lg p-3 sm:p-4 bg-console-panel">
          <p className="text-sm font-semibold text-console-text">Payout checklist</p>
          <p className="text-[12px] sm:text-sm text-console-mut mt-1">
            Payout setup can be completed after approval, but these items are required before payouts can be issued.
          </p>

          <div className="mt-3 space-y-2 text-[13px] sm:text-sm text-console-mut">
            <div className="flex items-start gap-2">
              <span className="mt-0.5">•</span>
              <span>Identity verification (Organizer Verification) must be approved.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5">•</span>
              <span>Select payout method (Bank transfer or Mobile money) in Organizer Settings → Payouts.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5">•</span>
              <span>Complete method-specific verification (bank proof or phone verification).</span>
            </div>

            {isHaitiOrganizer ? (
              <div className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>MonCash payouts may depend on platform prefunding/availability.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Stripe Connect (US/CA) onboarding is required when enabled.</span>
              </div>
            )}
          </div>
        </div>
      )
    }

    if (normalized.includes('governmentid') || normalized.includes('government_id')) {
      return (
        <div className="mt-3">
          {loadingImages ? (
            <div className="text-center py-4">
              <div className="inline-block w-6 h-6 border-4 border-console-mut border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-console-mut mt-2">Loading documents...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
              {/* A passport has one page, so there is no back to be missing. */}
              {renderImageThumb(
                docType === 'passport' ? 'Passport - Photo page' : 'ID Card - Front',
                imageUrls.idFrontUrl,
                'ID Front'
              )}
              {docType === 'passport'
                ? null
                : renderImageThumb('ID Card - Back', imageUrls.idBackUrl, 'ID Back')}
            </div>
          )}
        </div>
      )
    }

    if (normalized.includes('selfie') || normalized.includes('identity')) {
      return (
        <div className="mt-3">
          {loadingImages ? (
            <div className="text-center py-4">
              <div className="inline-block w-6 h-6 border-4 border-console-mut border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-console-mut mt-2">Loading selfie...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                {renderImageThumb('Selfie Photo', imageUrls.facePhotoUrl, 'Selfie')}
              </div>
              {renderLiveness()}
            </div>
          )}
        </div>
      )
    }

    if (normalized.includes('businessdetails') || normalized.includes('business_details')) {
      return (
        <div className="mt-3">
          {loadingImages ? (
            <div className="text-center py-4">
              <div className="inline-block w-6 h-6 border-4 border-console-mut border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-console-mut mt-2">Loading business documents...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {imageUrls.businessRegistrationUrl ? (
                <a
                  href={imageUrls.businessRegistrationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded bg-console-raise text-console-text hover:opacity-90 text-[13px] sm:text-sm font-medium"
                >
                  Open business registration
                </a>
              ) : (
                <div className="px-3 py-2 rounded bg-console-panel text-[13px] sm:text-sm text-console-faint">
                  Business registration not provided
                </div>
              )}

              {imageUrls.taxIdUrl ? (
                <a
                  href={imageUrls.taxIdUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded bg-console-raise text-console-text hover:opacity-90 text-[13px] sm:text-sm font-medium"
                >
                  Open tax ID document
                </a>
              ) : (
                <div className="px-3 py-2 rounded bg-console-panel text-[13px] sm:text-sm text-console-faint">
                  Tax ID not provided
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  const handleApprove = async () => {
    const ok = await confirmDialog({
      title: 'Approve this verification?',
      description: `${user?.full_name || user?.email || 'This organizer'} will be marked verified and notified.`,
      confirmLabel: 'Approve',
      variant: 'default',
    })
    if (!ok) return

    setReviewing(true)
    try {
      const response = await fetch('/api/admin/review-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          status: 'approved',
        }),
      })

      if (!response.ok) throw new Error('Failed to approve')

      showToast({ type: 'success', title: 'Verification approved', message: 'The organizer has been notified.' })
      router.refresh()
    } catch (error) {
      console.error('Error approving:', error)
      showToast({ type: 'error', title: 'Approval failed', message: 'Could not approve this verification. Please try again.' })
    } finally {
      setReviewing(false)
    }
  }

  const handleRequestChanges = async () => {
    if (!rejectionReason.trim()) {
      showToast({ type: 'warning', title: 'Reason required', message: 'Please provide a reason for the requested changes.' })
      return
    }

    setReviewing(true)
    try {
      const response = await fetch('/api/admin/review-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          status: 'changes_requested',
          rejectionReason: rejectionReason.trim(),
        }),
      })

      if (!response.ok) throw new Error('Failed to request changes')

      showToast({ type: 'success', title: 'Changes requested', message: 'The organizer has been notified.' })
      setShowRejectModal(false)
      router.refresh()
    } catch (error) {
      console.error('Error rejecting:', error)
      showToast({ type: 'error', title: 'Request failed', message: 'Could not request changes. Please try again.' })
    } finally {
      setReviewing(false)
    }
  }

  return (
    <>
      <div className="rounded-lg p-4 sm:p-6 bg-console-panel">
        <div className="flex items-start justify-between mb-3 sm:mb-4 gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="font-semibold text-console-text text-base sm:text-lg truncate">
                {user?.full_name || 'Unknown User'}
              </h3>
              {age ? (
                <span className={`label-mono text-[13px] tabular-nums shrink-0 ${ageColor}`} title={ageTitle}>
                  {age}
                </span>
              ) : null}
            </div>
            <p className="text-[13px] sm:text-sm text-console-mut truncate">{user?.email}</p>
            <p className="font-mono tabular-nums text-[11px] sm:text-xs text-console-faint mt-1">
              {submittedDate ? (
                <>
                  Submitted {formatSubmittedAt(submittedDate)} (UTC)
                </>
              ) : (
                'Submission date not available'
              )}
            </p>
          </div>
          <ConsoleState tone={consoleTone(request.status || 'pending')}>
            {String(request.status || 'pending')
              .replace(/[_-]+/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase())}
          </ConsoleState>
        </div>

        {/* Submission Sections */}
        <div className="mb-4 sm:mb-6">
          {steps ? (
            <div className="space-y-3 sm:space-y-4">
              {Object.entries(steps).map(([stepKey, stepValue]: any) => {
                const title = stepValue?.title || stepKey
                const required = stepValue?.required === true
                const stepStatus = stepValue?.status || 'incomplete'
                const fields = stepValue?.fields && typeof stepValue.fields === 'object' ? stepValue.fields : {}
                const missingFields: string[] = Array.isArray(stepValue?.missingFields) ? stepValue.missingFields : []
                const errorMessage: string | null = stepValue?.errorMessage || null
                const stepId: string = stepValue?.id || stepKey

                return (
                  <div key={stepKey} className="rounded-lg p-3 sm:p-4 bg-console-ground">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-semibold text-console-text truncate">{title}</p>
                        {stepValue?.description ? (
                          <p className="text-[12px] sm:text-sm text-console-mut">{stepValue.description}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        {required ? (
                          <span className="label-mono uppercase text-[10px] sm:text-xs tracking-[0.14em] text-console-faint">Required</span>
                        ) : (
                          <span className="label-mono uppercase text-[10px] sm:text-xs tracking-[0.14em] text-console-faint">Optional</span>
                        )}
                        <ConsoleState tone={consoleTone(stepStatus)}>
                          {String(stepStatus).replaceAll('_', ' ')}
                        </ConsoleState>
                      </div>
                    </div>

                    {errorMessage ? (
                      <div className="text-[12px] sm:text-sm text-console-red rounded bg-console-panel p-2 mb-2">
                        {errorMessage}
                      </div>
                    ) : null}

                    {missingFields.length > 0 ? (
                      <div className="text-[12px] sm:text-sm text-console-amber rounded bg-console-panel p-2 mb-2">
                        Missing: {missingFields.join(', ')}
                      </div>
                    ) : null}

                    {Object.keys(fields).length === 0 ? (
                      <p className="text-[12px] sm:text-sm text-console-faint">No details provided.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                        {Object.entries(fields)
                          .map(([k, v]) => ({ k, v, s: formatFieldValue(v) }))
                          .filter((x) => x.s)
                          .map(({ k, s }) => (
                            <div key={k} className="min-w-0">
                              <p className="text-[11px] sm:text-xs text-console-faint truncate">{k.replaceAll('_', ' ')}</p>
                              <p className="text-[13px] sm:text-sm text-console-text break-words">{s}</p>
                            </div>
                          ))}
                      </div>
                    )}

                    {renderProofForStep(stepId)}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg p-3 sm:p-4 bg-console-ground">
              <p className="text-[13px] sm:text-sm text-console-mut font-medium">Submission details</p>
              <p className="text-[12px] sm:text-sm text-console-faint">No step-by-step submission data found on this request.</p>
            </div>
          )}
        </div>

        {/* Fallback proof section for legacy/unknown request shapes */}
        {!steps ? (
          <div className="mb-4 sm:mb-6">
            <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-2">Proof</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
              {loadingImages ? (
                <div className="col-span-1 sm:col-span-3 text-center py-8">
                  <div className="inline-block w-8 h-8 border-4 border-console-mut border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-console-mut mt-2">Loading images...</p>
                </div>
              ) : (
                <>
                  {renderImageThumb('ID Card - Front', imageUrls.idFrontUrl, 'ID Front')}
                  {renderImageThumb('ID Card - Back', imageUrls.idBackUrl, 'ID Back')}
                  {renderImageThumb('Selfie Photo', imageUrls.facePhotoUrl, 'Selfie')}
                </>
              )}
            </div>

            {!loadingImages && (imageUrls.businessRegistrationUrl || imageUrls.taxIdUrl) ? (
              <div className="mt-3 rounded-lg p-3 sm:p-4 bg-console-ground">
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-2">Business Documents</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {imageUrls.businessRegistrationUrl ? (
                    <a
                      href={imageUrls.businessRegistrationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded bg-console-raise text-console-text hover:opacity-90 text-[13px] sm:text-sm font-medium"
                    >
                      Open business registration
                    </a>
                  ) : (
                    <div className="px-3 py-2 rounded bg-console-panel text-[13px] sm:text-sm text-console-faint">
                      Business registration not provided
                    </div>
                  )}

                  {imageUrls.taxIdUrl ? (
                    <a
                      href={imageUrls.taxIdUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded bg-console-raise text-console-text hover:opacity-90 text-[13px] sm:text-sm font-medium"
                    >
                      Open tax ID document
                    </a>
                  ) : (
                    <div className="px-3 py-2 rounded bg-console-panel text-[13px] sm:text-sm text-console-faint">
                      Tax ID not provided
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Action Buttons — only show for pending/in-review/changes_requested */}
        {(() => {
          const s = (request.status || 'pending').toLowerCase()
          const isActionable = s === 'pending' || s === 'pending_review' || s === 'in_review' || s === 'changes_requested'
          if (!isActionable) return null
          return (
            <div className="flex gap-2 sm:gap-3">
              <ConsoleButton
                variant="primary"
                onClick={handleApprove}
                disabled={reviewing}
                className="flex-1 min-h-[44px]"
              >
                {reviewing ? 'Processing...' : 'Approve'}
              </ConsoleButton>
              <ConsoleButton
                onClick={() => setShowRejectModal(true)}
                disabled={reviewing}
                className="flex-1 min-h-[44px]"
              >
                Request changes
              </ConsoleButton>
            </div>
          )
        })()}
      </div>

      {/* Image Lightbox */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="relative max-w-4xl max-h-full">
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-console-panel text-console-text rounded p-2 hover:bg-console-raise"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="relative w-[90vw] max-w-4xl h-[80vh]">
              <Image
                src={selectedImage}
                alt="Verification document"
                fill
                className="object-contain rounded-lg"
                sizes="90vw"
                onClick={(e) => e.stopPropagation()}
                unoptimized
              />
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-console-panel rounded-lg shadow-xl p-4 sm:p-6 max-w-md w-full">
            <h3 className="label-mono text-[13px] font-bold uppercase tracking-[0.14em] text-console-text mb-3 sm:mb-4">Request Changes</h3>
            <p className="text-[13px] sm:text-sm text-console-mut mb-3 sm:mb-4">
              Please describe what needs to be fixed. The organizer will receive this in an email and can resubmit.
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g., ID photo is blurry; please re-upload a clear front/back."
              className="w-full px-3 py-2 rounded bg-console-ground text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut mb-3 sm:mb-4 text-[15px] sm:text-base min-h-[44px]"
              rows={4}
            />
            <div className="flex gap-2 sm:gap-3">
              <ConsoleButton
                onClick={() => {
                  setShowRejectModal(false)
                  setRejectionReason('')
                }}
                className="flex-1 min-h-[44px]"
              >
                Cancel
              </ConsoleButton>
              <ConsoleButton
                variant="primary"
                onClick={handleRequestChanges}
                disabled={reviewing || !rejectionReason.trim()}
                className="flex-1 min-h-[44px]"
              >
                {reviewing ? 'Sending...' : 'Send Request'}
              </ConsoleButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
