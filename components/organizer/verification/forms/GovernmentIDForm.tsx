/**
 * GovernmentIDForm Component
 * Upload form for government ID (front and back)
 */

'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DocumentUploadCard from '../DocumentUploadCard'
import { uploadVerificationDocument, updateVerificationFiles } from '@/lib/verification'

interface Props {
  userId: string
  initialData: {
    frontPath?: string
    backPath?: string
  }
  onSave: () => Promise<void>
  onCancel: () => void
}

export default function GovernmentIDForm({ userId, initialData, onSave, onCancel }: Props) {
  const { t } = useTranslation('organizer')
  const [frontPath, setFrontPath] = useState(initialData.frontPath)
  const [backPath, setBackPath] = useState(initialData.backPath)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const handleFrontUpload = async (file: File) => {
    try {
      const path = await uploadVerificationDocument(userId, file, 'id_front')
      setFrontPath(path)
      
      // Update Firestore immediately - only include defined values
      const updateData: any = {
        governmentId: {
          front: path,
          uploadedAt: new Date()
        }
      }
      if (backPath) {
        updateData.governmentId.back = backPath
      }
      await updateVerificationFiles(userId, updateData)
    } catch (err: any) {
      throw new Error(err.message || t('onboarding.verification.errors.upload_id_front_failed', { defaultValue: 'Failed to upload ID front' }))
    }
  }

  const handleBackUpload = async (file: File) => {
    try {
      const path = await uploadVerificationDocument(userId, file, 'id_back')
      setBackPath(path)
      
      // Update Firestore immediately - only include defined values
      const updateData: any = {
        governmentId: {
          back: path,
          uploadedAt: new Date()
        }
      }
      if (frontPath) {
        updateData.governmentId.front = frontPath
      }
      await updateVerificationFiles(userId, updateData)
    } catch (err: any) {
      throw new Error(err.message || t('onboarding.verification.errors.upload_id_back_failed', { defaultValue: 'Failed to upload ID back' }))
    }
  }

  const handleFrontRemove = async () => {
    setFrontPath(undefined)
    // Don't update Firestore with undefined - let it keep existing data
    if (backPath) {
      await updateVerificationFiles(userId, {
        governmentId: {
          back: backPath
        }
      })
    }
  }

  const handleBackRemove = async () => {
    setBackPath(undefined)
    // Don't update Firestore with undefined - let it keep existing data
    if (frontPath) {
      await updateVerificationFiles(userId, {
        governmentId: {
          front: frontPath
        }
      })
    }
  }

  const handleContinue = async () => {
    if (!frontPath || !backPath) {
      setError(t('onboarding.verification.errors.upload_both_id', { defaultValue: 'Please upload both front and back of your ID' }))
      return
    }

    try {
      setIsSaving(true)
      await onSave()
    } catch (err: any) {
      setError(err.message || t('onboarding.verification.errors.save_failed_short', { defaultValue: 'Failed to save' }))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/[0.055] rounded-2xl p-6 md:p-8">
        <h3 className="mb-2 font-display lowercase italic !text-[22px] !leading-snug text-white">
          {t('verification_id.government_id_upload')}
        </h3>
        <p className="text-sm md:text-base text-white/60 mb-6">
          {t('verification_id.upload_both_sides')}
        </p>

        {/* Tips */}
        <div className="bg-white/[0.07] rounded-xl p-4 mb-6">
          <h4 className="font-semibold text-white text-sm mb-2">{t('onboarding.verification.photo_tips', { defaultValue: 'Photo Tips:' })}</h4>
          <ul className="text-sm text-white/65 space-y-1 list-disc list-inside">
            <li>{t('onboarding.verification.tip_readable', { defaultValue: 'Ensure all text is clearly readable' })}</li>
            <li>{t('onboarding.verification.tip_lighting', { defaultValue: 'Use good lighting (avoid glare)' })}</li>
            <li>{t('onboarding.verification.tip_background', { defaultValue: 'Place ID on a contrasting background' })}</li>
            <li>{t('onboarding.verification.tip_sharp', { defaultValue: 'Photo should not be blurry or cropped' })}</li>
          </ul>
        </div>

        {/* Upload Cards */}
        <div className="space-y-4">
          <DocumentUploadCard
            title={t('onboarding.verification.id_front', { defaultValue: 'ID Front' })}
            description={t('onboarding.verification.id_front_desc', { defaultValue: 'Upload the front side of your national ID' })}
            existingFileUrl={frontPath}
            onUpload={handleFrontUpload}
            onRemove={handleFrontRemove}
            required
          />

          <DocumentUploadCard
            title={t('onboarding.verification.id_back', { defaultValue: 'ID Back' })}
            description={t('onboarding.verification.id_back_desc', { defaultValue: 'Upload the back side of your national ID' })}
            existingFileUrl={backPath}
            onUpload={handleBackUpload}
            onRemove={handleBackRemove}
            required
          />
        </div>

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
          className="flex-1 px-6 py-3 text-white bg-white/[0.07] rounded-full font-semibold hover:bg-white/[0.12] transition-colors disabled:opacity-50"
        >
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={isSaving || !frontPath || !backPath}
          className="flex-1 px-6 py-3 bg-white hover:bg-white/90 text-black rounded-full font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}
