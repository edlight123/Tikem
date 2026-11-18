'use client';

import { useTranslation } from 'react-i18next'

import { useState } from 'react';
import { Lock, Key, Loader2, Shield } from 'lucide-react';
import { ChangePasswordPanel } from '@/components/auth/ChangePasswordPanel';

interface SecurityFormProps {
  userId: string;
}

// "Recent login activity" was removed: it read organizers/{id}/loginHistory,
// which nothing writes, so it was always empty. Add it back only with real
// sign-in tracking behind it.
export default function SecurityForm({ userId }: SecurityFormProps) {
  const { t } = useTranslation('organizer')

  return (
    <div className="space-y-6">
      {/* Change Password */}
      <div className="rounded-xl bg-surface-low p-6">
        <div className="flex items-center gap-2 mb-6">
          <Key className="w-5 h-5 text-brand-300" />
          <h3 className="font-display text-title lowercase italic leading-none text-fg">{t('security.change_password')}</h3>
        </div>
        {/* Firebase holds the password: reauthenticate + updatePassword run
            client-side (components/auth/ChangePasswordPanel.tsx). */}
        <ChangePasswordPanel />
      </div>

      {/* Two-Factor Authentication (Future) */}
      <div className="rounded-xl bg-surface-low p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-300" />
            <div>
              <h3 className="font-display text-title lowercase italic leading-none text-fg">{t('security.two_factor_auth')}</h3>
              <p className="text-sm text-fg-muted mt-1">
                {t('security.extra_security_layer')}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-fg-muted">
            {t('security.coming_soon')}
          </span>
        </div>
      </div>
    </div>
  );
}
