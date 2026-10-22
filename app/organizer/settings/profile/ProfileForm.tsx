'use client';

import { useTranslation } from 'react-i18next'

import { useState, useEffect, useRef } from 'react';
import { User, Phone, Mail, Camera, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { SaveBar } from '@/components/organizer/ui';
import Image from 'next/image';

interface ProfileFormProps {
  userId: string;
  initialData: {
    full_name: string;
    email: string;
    phone_number: string;
    photo_url: string;
  };
}

export default function ProfileForm({ userId, initialData }: ProfileFormProps) {
  const { t } = useTranslation('organizer')

  const [formData, setFormData] = useState(initialData);
  const [savedData, setSavedData] = useState(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
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
      const response = await fetch('/api/organizer/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: formData.full_name,
          phone_number: formData.phone_number,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update profile');
      }

      setSavedData({ ...formData });
      showToast({
        title: 'Profile updated',
        message: 'Your profile has been successfully updated.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      showToast({
        title: 'Error',
        message: 'Failed to update profile. Please try again.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      showToast({
        title: 'Invalid file',
        message: 'Please select an image file.',
        type: 'error',
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast({
        title: 'File too large',
        message: 'Please select an image smaller than 5MB.',
        type: 'error',
      });
      return;
    }

    setIsUploadingPhoto(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);

      const response = await fetch('/api/organizer/settings/profile/upload-photo', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload photo');
      }

      const { photo_url } = await response.json();
      setFormData((prev) => ({ ...prev, photo_url }));
      setSavedData((prev) => ({ ...prev, photo_url }));

      showToast({
        title: 'Photo updated',
        message: 'Your profile photo has been successfully updated.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error uploading photo:', error);
      showToast({
        title: 'Error',
        message: 'Failed to upload photo. Please try again.',
        type: 'error',
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="p-6 space-y-6">
      {/* Profile Photo */}
      <div className="flex items-start gap-6">
        <div className="relative">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-white/[0.055]">
            {formData.photo_url ? (
              <Image
                src={formData.photo_url}
                alt={t('profile_form.profile_photo')}
                width={96}
                height={96}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-12 h-12 text-white/40" />
              </div>
            )}
          </div>
          {isUploadingPhoto && (
            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <label
            htmlFor="photo-upload"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white/[0.07] hover:bg-white/[0.12] text-white/80 rounded cursor-pointer transition-colors"
          >
            <Camera className="w-4 h-4" />
            {t('profile_form.change_photo')}
          </label>
          <input
            id="photo-upload"
            type="file"
            accept="image/*"
            onChange={handlePhotoUpload}
            className="hidden"
            disabled={isUploadingPhoto}
          />
          <p className="text-xs text-white/50 mt-2">
            {t('profile_form.photo_formats')}
          </p>
        </div>
      </div>

      {/* Full Name */}
      <div>
        <label htmlFor="full_name" className="block text-sm font-medium text-white/70 mb-2">
          {t('profile_form.full_name')}
        </label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            id="full_name"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder={t('profile_form.enter_full_name')}
            required
          />
        </div>
      </div>

      {/* Email (Read-only) */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
          {t('profile_form.email_address')}
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="email"
            id="email"
            value={formData.email}
            className="w-full pl-10 pr-4 py-3 rounded bg-white/[0.04] text-white/45 cursor-not-allowed text-[16px] focus:outline-none"
            disabled
          />
        </div>
        <p className="text-xs text-white/50 mt-1">
          {t('profile_form.email_cannot_change')}
        </p>
      </div>

      {/* Phone Number */}
      <div>
        <label htmlFor="phone_number" className="block text-sm font-medium text-white/70 mb-2">
          {t('profile_form.phone_number')}
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="tel"
            id="phone_number"
            value={formData.phone_number}
            onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            placeholder="+509 1234 5678"
          />
        </div>
        <p className="text-xs text-white/50 mt-1">
          {t('profile_form.phone_use_note')}
        </p>
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
