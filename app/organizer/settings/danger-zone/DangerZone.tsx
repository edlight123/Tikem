'use client';

import { useTranslation } from 'react-i18next'

import { useState } from 'react';
import { Download, XCircle, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from 'next/navigation';
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog';

interface DangerZoneProps {
  userId: string;
}

export default function DangerZone({ userId }: DangerZoneProps) {
  const { t } = useTranslation('organizer')

  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  const handleExportData = async () => {
    setIsExporting(true);

    try {
      const response = await fetch('/api/organizer/settings/danger-zone/export-data', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to export data');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tikem-data-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showToast({
        title: 'Data exported',
        message: 'Your data has been downloaded successfully.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error exporting data:', error);
      showToast({
        title: 'Error',
        message: 'Failed to export data. Please try again.',
        type: 'error',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeactivate = async () => {
    setIsDeactivating(true);

    try {
      const response = await fetch('/api/organizer/settings/danger-zone/deactivate', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to deactivate account');
      }

      showToast({
        title: 'Account deactivated',
        message: 'Your account has been deactivated. You can reactivate within 30 days.',
        type: 'success',
      });

      // Sign out and redirect
      setTimeout(() => {
        router.push('/api/auth/signout');
      }, 2000);
    } catch (error) {
      console.error('Error deactivating account:', error);
      showToast({
        title: 'Error',
        message: 'Failed to deactivate account. Please try again.',
        type: 'error',
      });
    } finally {
      setIsDeactivating(false);
      setShowDeactivateModal(false);
    }
  };


  return (
    <div className="space-y-4">
      {/* Export Data */}
      <div className="bg-white/[0.03] rounded-xl border-2 border-white/10 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Download className="w-5 h-5 text-white/70" />
              <h3 className="font-semibold text-white">{t('danger_zone.export_your_data')}</h3>
            </div>
            <p className="text-sm text-white/60">
              {t('danger_zone.export_desc')}
            </p>
          </div>
          <button
            onClick={handleExportData}
            disabled={isExporting}
            className="px-4 py-2 border-2 border-white/15 hover:border-white/20 text-white/70 font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isExporting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isExporting ? 'Exporting...' : 'Export Data'}
          </button>
        </div>
      </div>

      {/* Deactivate Account */}
      <div className="bg-white/[0.03] rounded-xl border-2 border-amber-300 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-5 h-5 text-amber-300" />
              <h3 className="font-semibold text-white">{t('danger_zone.deactivate_account')}</h3>
            </div>
            <p className="text-sm text-white/60">
              {t('danger_zone.deactivate_desc')}
            </p>
          </div>
          <button
            onClick={() => setShowDeactivateModal(true)}
            className="px-4 py-2 border-2 border-amber-400 hover:border-amber-500 text-amber-300 font-medium rounded-lg transition-colors"
          >
            {t('danger_zone.deactivate')}
          </button>
        </div>
      </div>

      {/* Delete Account */}
      <div className="bg-white/[0.03] rounded-xl border-2 border-red-300 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Trash2 className="w-5 h-5 text-red-300" />
              <h3 className="font-semibold text-white">{t('danger_zone.delete_permanently')}</h3>
            </div>
            <p className="text-sm text-white/60 mb-3">
              {t('danger_zone.delete_desc')}
            </p>
            <ul className="text-xs text-red-300 space-y-1 list-disc list-inside">
              <li>{t('danger_zone.all_data_deleted')}</li>
              <li>{t('danger_zone.pending_payouts_forfeited')}</li>
              <li>{t('danger_zone.profile_removed')}</li>
              <li>{t('danger_zone.immediate_irreversible')}</li>
            </ul>
          </div>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            {t('danger_zone.delete_account')}
          </button>
        </div>
      </div>

      {/* Deactivate Confirmation Modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111] rounded-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-300" />
              <h3 className="font-display text-xl text-white">{t('danger_zone.deactivate_account_q')}</h3>
            </div>
            <p className="text-white/60 mb-6">
              {t('danger_zone.deactivate_confirm')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeactivateModal(false)}
                className="flex-1 px-4 py-3 text-white/70 font-medium rounded-[10px] bg-white/[0.06] hover:bg-white/[0.12] text-[16px] focus:outline-none"
              >
                {t('actions.cancel')}
              </button>
              <button
                onClick={handleDeactivate}
                disabled={isDeactivating}
                className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeactivating && <Loader2 className="w-4 h-4 animate-spin" />}
                {isDeactivating ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteAccountDialog open={showDeleteModal} onClose={() => setShowDeleteModal(false)} />
    </div>
  );
}
