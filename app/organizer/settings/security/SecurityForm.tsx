'use client';

import { useTranslation } from 'react-i18next'

import { useState } from 'react';
import { Lock, Key, Monitor, MapPin, Clock, Loader2, Shield } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { StatusChip } from '@/components/ui/kit';

interface LoginRecord {
  id: string;
  timestamp: string;
  ip_address?: string;
  device?: string;
  location?: string;
  status: string;
}

interface SecurityFormProps {
  userId: string;
  loginHistory: any[];
}

export default function SecurityForm({ userId, loginHistory }: SecurityFormProps) {
  const { t } = useTranslation('organizer')

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const { showToast } = useToast();

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      showToast({
        title: 'Passwords do not match',
        message: 'Please make sure your new passwords match.',
        type: 'error',
      });
      return;
    }

    if (newPassword.length < 8) {
      showToast({
        title: 'Password too short',
        message: 'Password must be at least 8 characters long.',
        type: 'error',
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      const response = await fetch('/api/organizer/settings/security/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to change password');
      }

      showToast({
        title: 'Password changed',
        message: 'Your password has been successfully updated.',
        type: 'success',
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      showToast({
        title: 'Error',
        message: error.message || 'Failed to change password',
        type: 'error',
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Change Password */}
      <div className="rounded-xl bg-white/[0.03] p-6">
        <div className="flex items-center gap-2 mb-6">
          <Key className="w-5 h-5 text-brand-300" />
          <h3 className="font-display text-[20px] lowercase italic leading-none text-white">{t('security.change_password')}</h3>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
          <div>
            <label htmlFor="current_password" className="block text-sm font-medium text-white/70 mb-2">
              {t('security.current_password')}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                type="password"
                id="current_password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                placeholder={t('security.enter_current_password')}
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="new_password" className="block text-sm font-medium text-white/70 mb-2">
              {t('security.new_password')}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                type="password"
                id="new_password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                placeholder={t('security.enter_new_password')}
                required
                minLength={8}
              />
            </div>
          </div>
          <div>
            <label htmlFor="confirm_password" className="block text-sm font-medium text-white/70 mb-2">
              {t('security.confirm_new_password_label')}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                type="password"
                id="confirm_password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                placeholder={t('security.confirm_new_password')}
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isChangingPassword}
            className="px-6 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isChangingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
            {isChangingPassword ? 'Updating...' : 'Update Password'}
          </button>
          <p className="text-xs text-white/50">
            {t('security.password_min_length')}
          </p>
        </form>
      </div>

      {/* Two-Factor Authentication (Future) */}
      <div className="rounded-xl bg-white/[0.03] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-300" />
            <div>
              <h3 className="font-display text-[20px] lowercase italic leading-none text-white">{t('security.two_factor_auth')}</h3>
              <p className="text-sm text-white/60 mt-1">
                {t('security.extra_security_layer')}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-[8px] bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white/60">
            {t('security.coming_soon')}
          </span>
        </div>
      </div>

      {/* Login History */}
      <div className="rounded-xl bg-white/[0.03] overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-brand-300" />
            <h3 className="font-display text-[20px] lowercase italic leading-none text-white">{t('security.recent_login_activity')}</h3>
          </div>
          <p className="text-sm text-white/60 mt-1">
            {t('security.monitor_logins')}
          </p>
        </div>
        {loginHistory.length === 0 ? (
          <div className="p-12 text-center">
            <Monitor className="w-16 h-16 text-white/50 mx-auto mb-4" />
            <p className="text-white/60">{t('security.no_recent_activity')}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {loginHistory.map((record: LoginRecord) => (
              <div key={record.id} className="p-4 hover:bg-white/[0.06]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Monitor className="w-4 h-4 text-white/40" />
                      <span className="font-medium text-white">
                        {record.device || 'Unknown Device'}
                      </span>
                      <StatusChip tone={record.status === 'success' ? 'success' : 'danger'}>
                        {record.status}
                      </StatusChip>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-white/60">
                      {record.location && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>{record.location}</span>
                        </div>
                      )}
                      {record.ip_address && (
                        <span className="font-mono text-xs">{record.ip_address}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-white/50">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(record.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
