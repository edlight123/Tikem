/**
 * BusinessDetailsForm Component
 * Optional business registration information
 */

'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  initialData: Record<string, any>
  onSave: (data: Record<string, any>) => Promise<void>
  onCancel: () => void
  onSkip: () => void
}

export default function BusinessDetailsForm({ initialData, onSave, onCancel, onSkip }: Props) {
  const { t } = useTranslation('organizer')
  const [formData, setFormData] = useState({
    business_registration_number: initialData.business_registration_number || '',
    tax_id: initialData.tax_id || '',
    business_type: initialData.business_type || '',
    registration_date: initialData.registration_date || ''
  })

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setIsSaving(true)
      await onSave(formData)
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white/[0.055] rounded-2xl p-6 md:p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="mb-2 font-display lowercase italic !text-[22px] !leading-snug text-white">
              {t('actions.business_details')}
            </h3>
            <p className="text-sm md:text-base text-white/60">
              {t('verification_business.optional_registration')}
            </p>
          </div>
          <span className="text-xs font-medium text-white/45">
            {t('actions.optional')}
          </span>
        </div>

        <div className="space-y-4">
          {/* Business Registration Number */}
          <div>
            <label htmlFor="business_registration_number" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.biz_reg_number', { defaultValue: 'Business Registration Number' })}
            </label>
            <input
              type="text"
              id="business_registration_number"
              name="business_registration_number"
              value={formData.business_registration_number}
              onChange={handleChange}
              className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
              placeholder="e.g., RC-12345"
            />
          </div>

          {/* Tax ID */}
          <div>
            <label htmlFor="tax_id" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.biz_tax_id', { defaultValue: 'Tax ID Number (NIF)' })}
            </label>
            <input
              type="text"
              id="tax_id"
              name="tax_id"
              value={formData.tax_id}
              onChange={handleChange}
              className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
              placeholder="e.g., NIF-123456789"
            />
          </div>

          {/* Business Type */}
          <div>
            <label htmlFor="business_type" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.biz_type', { defaultValue: 'Business Type' })}
            </label>
            <select
              id="business_type"
              name="business_type"
              value={formData.business_type}
              onChange={handleChange}
              className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
            >
              <option value="">{t('onboarding.verification.biz_select_type', { defaultValue: 'Select type' })}</option>
              <option value="sole_proprietorship">{t('onboarding.verification.biz_sole', { defaultValue: 'Sole Proprietorship' })}</option>
              <option value="partnership">{t('onboarding.verification.biz_partnership', { defaultValue: 'Partnership' })}</option>
              <option value="corporation">{t('onboarding.verification.biz_corp', { defaultValue: 'Corporation' })}</option>
              <option value="nonprofit">{t('onboarding.verification.biz_nonprofit', { defaultValue: 'Non-Profit' })}</option>
              <option value="cooperative">{t('onboarding.verification.biz_coop', { defaultValue: 'Cooperative' })}</option>
            </select>
          </div>

          {/* Registration Date */}
          <div>
            <label htmlFor="registration_date" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.biz_reg_date', { defaultValue: 'Registration Date' })}
            </label>
            <input
              type="date"
              id="registration_date"
              name="registration_date"
              value={formData.registration_date}
              onChange={handleChange}
              className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
            />
          </div>
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
          className="flex-1 px-6 py-3 text-white bg-white/[0.07] rounded font-semibold hover:bg-white/[0.12] transition-colors disabled:opacity-50"
        >
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isSaving}
          className="flex-1 px-6 py-3 text-white/60 bg-white/[0.07] hover:bg-white/[0.12] hover:text-white/80 rounded font-semibold transition-colors disabled:opacity-50"
        >
          {t('verification_business.skip_for_now')}
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 px-6 py-3 bg-white hover:bg-white/90 text-black rounded font-semibold transition-all disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </form>
  )
}
