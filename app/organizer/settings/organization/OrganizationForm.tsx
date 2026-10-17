'use client';

import { useTranslation } from 'react-i18next'

import { useState, useEffect, useRef } from 'react';
import { Building2, Globe, Upload, Loader2, Facebook, Instagram, Twitter, Linkedin } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { SaveBar } from '@/components/organizer/ui';
import Image from 'next/image';

interface OrganizationFormProps {
  userId: string;
  initialData: {
    organization_name: string;
    organization_type: string;
    organization_description: string;
    organization_logo: string;
    website: string;
    facebook: string;
    instagram: string;
    twitter: string;
    linkedin: string;
  };
}

export default function OrganizationForm({ userId, initialData }: OrganizationFormProps) {
  const { t } = useTranslation('organizer')

  const [formData, setFormData] = useState(initialData);
  const [savedData, setSavedData] = useState(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  const isDirty = JSON.stringify(formData) !== JSON.stringify(savedData);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/organizer/settings/organization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to update organization');
      }

      setSavedData({ ...formData });
      showToast({
        title: 'Organization updated',
        message: 'Your organization details have been successfully updated.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error updating organization:', error);
      showToast({
        title: 'Error',
        message: 'Failed to update organization. Please try again.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast({
        title: 'Invalid file',
        message: 'Please select an image file.',
        type: 'error',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast({
        title: 'File too large',
        message: 'Please select an image smaller than 5MB.',
        type: 'error',
      });
      return;
    }

    setIsUploadingLogo(true);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      formDataUpload.append('userId', userId);

      const response = await fetch('/api/organizer/settings/organization/upload-logo', {
        method: 'POST',
        body: formDataUpload,
      });

      if (!response.ok) {
        throw new Error('Failed to upload logo');
      }

      const { logo_url } = await response.json();
      setFormData((prev) => ({ ...prev, organization_logo: logo_url }));
      setSavedData((prev) => ({ ...prev, organization_logo: logo_url }));

      showToast({
        title: 'Logo updated',
        message: 'Your organization logo has been successfully updated.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error uploading logo:', error);
      showToast({
        title: 'Error',
        message: 'Failed to upload logo. Please try again.',
        type: 'error',
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="p-6 space-y-6">
      {/* Organization Logo */}
      <div className="flex items-start gap-6">
        <div className="relative">
          <div className="w-24 h-24 rounded-lg overflow-hidden bg-white/[0.055]">
            {formData.organization_logo ? (
              <Image
                src={formData.organization_logo}
                alt={t('organization.organization_logo')}
                width={96}
                height={96}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Building2 className="w-12 h-12 text-white/40" />
              </div>
            )}
          </div>
          {isUploadingLogo && (
            <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <label
            htmlFor="logo-upload"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white/[0.07] hover:bg-white/[0.12] text-white/80 rounded-full cursor-pointer transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t('organization.upload_logo')}
          </label>
          <input
            id="logo-upload"
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
            disabled={isUploadingLogo}
          />
          <p className="text-xs text-white/50 mt-2">
            {t('organization.square_logo_note')}
          </p>
        </div>
      </div>

      {/* Organization Name */}
      <div>
        <label htmlFor="organization_name" className="block text-sm font-medium text-white/70 mb-2">
          Organization Name *
        </label>
        <input
          type="text"
          id="organization_name"
          value={formData.organization_name}
          onChange={(e) => setFormData({ ...formData, organization_name: e.target.value })}
          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
          placeholder="e.g., Haiti Music Festival"
          required
        />
      </div>

      {/* Organization Type */}
      <div>
        <label htmlFor="organization_type" className="block text-sm font-medium text-white/70 mb-2">
          {t('organization.organization_type')}
        </label>
        <select
          id="organization_type"
          value={formData.organization_type}
          onChange={(e) => setFormData({ ...formData, organization_type: e.target.value })}
          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
        >
          <option value="">{t('organization.select_type')}</option>
          <option value="individual">{t('organization.individual')}</option>
          <option value="company">{t('organization.company')}</option>
          <option value="nonprofit">{t('organization.non_profit')}</option>
          <option value="government">{t('organization.government')}</option>
          <option value="other">{t('actions.other')}</option>
        </select>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="organization_description" className="block text-sm font-medium text-white/70 mb-2">
          {t('actions.description')}
        </label>
        <textarea
          id="organization_description"
          value={formData.organization_description}
          onChange={(e) => setFormData({ ...formData, organization_description: e.target.value })}
          rows={4}
          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 resize-none bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
          placeholder={t('organization.about_placeholder')}
        />
        <p className="text-xs text-white/50 mt-1">
          {t('organization.public_profile_note')}
        </p>
      </div>

      {/* Website */}
      <div>
        <label htmlFor="website" className="block text-sm font-medium text-white/70 mb-2">
          {t('actions.website')}
        </label>
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="url"
            id="website"
            value={formData.website}
            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder="https://example.com"
          />
        </div>
      </div>

      {/* Social Media */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white/70">{t('organization.social_media')}</h3>
        
        {/* Facebook */}
        <div className="relative">
          <Facebook className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            value={formData.facebook}
            onChange={(e) => setFormData({ ...formData, facebook: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder={t('organization.facebook_hint')}
          />
        </div>

        {/* Instagram */}
        <div className="relative">
          <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            value={formData.instagram}
            onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder={t('organization.instagram_hint')}
          />
        </div>

        {/* Twitter */}
        <div className="relative">
          <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            value={formData.twitter}
            onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder={t('organization.twitter_hint')}
          />
        </div>

        {/* LinkedIn */}
        <div className="relative">
          <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            value={formData.linkedin}
            onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder={t('organization.linkedin_hint')}
          />
        </div>
      </div>

      <SaveBar
        dirty={isDirty}
        saving={isSubmitting}
        onSave={() => formRef.current?.requestSubmit()}
        onDiscard={() => setFormData(savedData)}
      />
    </form>
  );
}
