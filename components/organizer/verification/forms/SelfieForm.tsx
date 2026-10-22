/**
 * SelfieForm Component
 * Upload form for selfie verification
 */

'use client'

import { useState } from 'react'
import DocumentUploadCard from '../DocumentUploadCard'
import { uploadVerificationDocument, updateVerificationFiles } from '@/lib/verification'
import { useTranslation } from 'react-i18next'

interface Props {
  userId: string
  initialData: {
    selfiePath?: string
  }
  onSave: () => Promise<void>
  onCancel: () => void
}

export default function SelfieForm({ userId, initialData, onSave, onCancel }: Props) {
  const { t } = useTranslation('organizer')
  const [selfiePath, setSelfiePath] = useState(initialData.selfiePath)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const handleUpload = async (file: File) => {
    try {
      const path = await uploadVerificationDocument(userId, file, 'selfie')
      setSelfiePath(path)
      
      // Update Firestore immediately
      await updateVerificationFiles(userId, {
        selfie: {
          path,
          uploadedAt: new Date()
        }
      })
    } catch (err: any) {
      throw new Error(err.message || 'Failed to upload selfie')
    }
  }

  const handleRemove = async () => {
    setSelfiePath(undefined)
    // Avoid writing `undefined` into Firestore (can throw). Clearing locally is enough;
    // the user can re-upload before submission.
    await updateVerificationFiles(userId, {
      selfie: {
        uploadedAt: new Date()
      }
    })
  }

  const handleContinue = async () => {
    if (!selfiePath) {
      setError('Please upload a selfie for identity verification')
      return
    }

    try {
      setIsSaving(true)
      await onSave()
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/[0.055] rounded-2xl p-6 md:p-8">
        <h3 className="mb-2 font-display lowercase italic !text-[22px] !leading-snug text-white">
          {t('actions.identity_verification')}
        </h3>
        <p className="text-sm md:text-base text-white/60 mb-6">
          {t('verification_selfie.take_clear_selfie')}
        </p>

        {/* Instructions */}
        <div className="bg-white/[0.07] rounded-xl p-4 mb-6">
          <h4 className="font-semibold text-white text-sm mb-2">{t('verification_selfie.instructions')}</h4>
          <ul className="text-sm text-white/65 space-y-1 list-disc list-inside">
            <li>{t('onboarding.verification.selfie_tip_hold', { defaultValue: 'Hold your ID next to your face' })}</li>
            <li>{t('onboarding.verification.selfie_tip_face', { defaultValue: 'Make sure your face is clearly visible' })}</li>
            <li>{t('onboarding.verification.selfie_tip_readable', { defaultValue: 'Ensure the ID text is readable in the photo' })}</li>
            <li>{t('onboarding.verification.selfie_tip_lighting', { defaultValue: 'Use good lighting and remove sunglasses/hat' })}</li>
            <li>{t('onboarding.verification.selfie_tip_camera', { defaultValue: 'Look directly at the camera' })}</li>
          </ul>
        </div>

        {/* Upload Card */}
        <DocumentUploadCard
          title={t('onboarding.verification.selfie_title', { defaultValue: 'Selfie with ID' })}
          description={t('onboarding.verification.selfie_desc', { defaultValue: 'Take or upload a photo of yourself holding your ID' })}
          existingFileUrl={selfiePath}
          onUpload={handleUpload}
          onRemove={handleRemove}
          required
        />

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 rounded-xl">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="flex-1 px-6 py-3 text-white bg-white/[0.07] rounded font-semibold hover:bg-white/[0.12] transition-colors disabled:opacity-50"
        >
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={isSaving || !selfiePath}
          className="flex-1 px-6 py-3 bg-white hover:bg-white/90 text-black rounded font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}
