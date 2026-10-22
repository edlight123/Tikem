/**
 * OrganizerInfoForm Component
 * Form for organizer personal information
 */

'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  initialData: Record<string, any>
  onSave: (data: Record<string, any>) => Promise<void>
  onCancel: () => void
}

export default function OrganizerInfoForm({ initialData, onSave, onCancel }: Props) {
  const { t } = useTranslation('organizer')
  const [formData, setFormData] = useState({
    full_name: initialData.full_name || '',
    phone: initialData.phone || '',
    organization_name: initialData.organization_name || '',
    organization_type: initialData.organization_type || 'individual',
    email: initialData.email || '',
    address: initialData.address || '',
    city: initialData.city || '',
    country: initialData.country || 'Haiti'
  })

  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    const normalizedPhone = String(formData.phone || '').replace(/[\s\-()]/g, '')

    if (!formData.full_name.trim()) {
      newErrors.full_name = t('onboarding.verification.errors.full_name_required', { defaultValue: 'Full name is required' })
    }

    if (!formData.phone.trim()) {
      newErrors.phone = t('onboarding.verification.errors.phone_required', { defaultValue: 'Phone number is required' })
    } else if (!/^\+?\d{10,}$/.test(normalizedPhone)) {
      newErrors.phone = t('onboarding.verification.errors.phone_invalid', { defaultValue: 'Invalid phone number format' })
    }

    if (!formData.organization_name.trim()) {
      newErrors.organization_name = t('onboarding.verification.errors.organization_name_required', { defaultValue: 'Organization name is required' })
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    try {
      setIsSaving(true)
      await onSave(formData)
    } catch (error: any) {
      setErrors({ _form: error.message || t('onboarding.verification.errors.save_failed_short', { defaultValue: 'Failed to save' }) })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white/[0.055] rounded-2xl p-6 md:p-8">
        <h3 className="mb-6 font-display lowercase italic !text-[22px] !leading-snug text-white">
          {t('onboarding.verification.forms.organizer_info_title', { defaultValue: 'Organizer Information' })}
        </h3>

        <div className="space-y-4">
          {/* Full Name */}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.field.full_name', { defaultValue: 'Full Name' })} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              className={`w-full rounded-lg px-4 py-3 text-white [color-scheme:dark] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400/50 ${
                errors.full_name ? 'bg-red-500/10 ring-1 ring-inset ring-red-500/40' : 'bg-white/[0.055] hover:bg-white/[0.08] focus:bg-white/[0.08]'
              }`}
              placeholder={t('onboarding.verification.forms.full_name_placeholder', { defaultValue: 'John Doe' })}
            />
            {errors.full_name && (
              <p className="mt-1 text-sm text-red-300">{errors.full_name}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.field.phone', { defaultValue: 'Phone Number' })} <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className={`w-full rounded-lg px-4 py-3 text-white [color-scheme:dark] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400/50 ${
                errors.phone ? 'bg-red-500/10 ring-1 ring-inset ring-red-500/40' : 'bg-white/[0.055] hover:bg-white/[0.08] focus:bg-white/[0.08]'
              }`}
              placeholder={t('onboarding.verification.field.phone_placeholder', { defaultValue: '+509 1234 5678' })}
            />
            {errors.phone && (
              <p className="mt-1 text-sm text-red-300">{errors.phone}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.field.email', { defaultValue: 'Email Address' })}
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
              placeholder={t('onboarding.verification.forms.email_placeholder', { defaultValue: 'john@example.com' })}
            />
          </div>

          {/* Organization Name */}
          <div>
            <label htmlFor="organization_name" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.field.organization_business_name', { defaultValue: 'Organization/Business Name' })} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="organization_name"
              name="organization_name"
              value={formData.organization_name}
              onChange={handleChange}
              className={`w-full rounded-lg px-4 py-3 text-white [color-scheme:dark] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400/50 ${
                errors.organization_name ? 'bg-red-500/10 ring-1 ring-inset ring-red-500/40' : 'bg-white/[0.055] hover:bg-white/[0.08] focus:bg-white/[0.08]'
              }`}
              placeholder={t('onboarding.verification.forms.organization_name_placeholder', { defaultValue: 'Your Company Name' })}
            />
            {errors.organization_name && (
              <p className="mt-1 text-sm text-red-300">{errors.organization_name}</p>
            )}
          </div>

          {/* Organization Type */}
          <div>
            <label htmlFor="organization_type" className="block text-sm font-medium text-white/70 mb-2">
              {t('onboarding.verification.field.organization_type', { defaultValue: 'Organization Type' })}
            </label>
            <select
              id="organization_type"
              name="organization_type"
              value={formData.organization_type}
              onChange={handleChange}
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
            <textarea
              id="address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows={2}
              className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
              placeholder={t('onboarding.verification.field.address_placeholder', { defaultValue: 'Street address' })}
            />
          </div>

          {/* City & Country */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-white/70 mb-2">
                {t('onboarding.verification.field.city', { defaultValue: 'City' })}
              </label>
              <input
                type="text"
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
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
                name="country"
                value={formData.country}
                onChange={handleChange}
                className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white [color-scheme:dark] transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
              >
                <option value="Haiti">{t('onboarding.verification.country.haiti', { defaultValue: 'Haiti' })}</option>
                <option value="Dominican Republic">{t('onboarding.verification.country.dominican_republic', { defaultValue: 'Dominican Republic' })}</option>
                <option value="Other">{t('onboarding.verification.country.other', { defaultValue: 'Other' })}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Form Error */}
        {errors._form && (
          <div className="mt-4 p-3 bg-red-500/10 rounded-xl">
            <p className="text-sm text-red-300">{errors._form}</p>
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
          {t('onboarding.verification.nav.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 px-6 py-3 bg-white hover:bg-white/90 text-black rounded font-semibold transition-all disabled:opacity-50"
        >
          {isSaving
            ? t('onboarding.verification.nav.saving', { defaultValue: 'Saving...' })
            : t('onboarding.verification.nav.save_continue', { defaultValue: 'Save & Continue' })}
        </button>
      </div>
    </form>
  )
}
