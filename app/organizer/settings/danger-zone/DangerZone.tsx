'use client';

import { useTranslation } from 'react-i18next'

import { useState } from 'react';
import { Download, XCircle, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
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
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [blockedEvents, setBlockedEvents] = useState<Array<{ id: string; title: string; ticketsSold: number }> | null>(null);
  const { showToast } = useToast();

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

      showToast({ title: t('danger_zone.export_done'), type: 'success' });
    } catch (error) {
      console.error('Error exporting data:', error);
      showToast({ title: t('danger_zone.export_failed'), type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeactivate = async () => {
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      const response = await fetch('/api/organizer/settings/danger-zone/deactivate', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 409 && data?.code === 'upcoming_events_with_sales') {
        setBlockedEvents(Array.isArray(data.events) ? data.events : []);
        setIsDeactivating(false);
        return;
      }
      if (!response.ok) throw new Error('deactivate_failed');

      // Sign out for real: drop the Firebase client session AND the server
      // session cookie, then leave the organizer area.
      try {
        const [{ signOut }, { auth }] = await Promise.all([
          import('firebase/auth'),
          import('@/lib/firebase/client'),
        ]);
        await signOut(auth).catch(() => undefined);
      } catch {
        // ignore: the cookie below is what the server reads
      }
      await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined);
      window.location.href = '/';
    } catch (error) {
      console.error('Error deactivating account:', error);
      setDeactivateError(t('danger_zone.deactivate_failed'));
      setIsDeactivating(false);
    }
  };


  return (
    <div className="space-y-4">
      {/* Export Data */}
      <div className="bg-white/[0.055] rounded-2xl p-6">
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
            className="px-4 py-2 bg-white/[0.07] hover:bg-white/[0.12] text-white font-medium rounded transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isExporting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isExporting ? t('danger_zone.exporting') : t('danger_zone.export_button')}
          </button>
        </div>
      </div>

      {/* Deactivate Account */}
      <div className="bg-amber-500/10 rounded-2xl p-6">
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
            className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-medium rounded transition-colors"
          >
            {t('danger_zone.deactivate')}
          </button>
        </div>
      </div>

      {/* Delete Account */}
      <div className="bg-red-500/10 rounded-2xl p-6">
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
            className="px-4 py-2 bg-red-500/15 hover:bg-red-500/25 text-red-200 font-medium rounded transition-colors"
          >
            {t('danger_zone.delete_account')}
          </button>
        </div>
      </div>

      {/* Deactivate Confirmation Modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1c1c1c] rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-300" />
              <h3 className="font-display text-xl text-white">{t('danger_zone.deactivate_account_q')}</h3>
            </div>
            {blockedEvents ? (
              <div className="mb-6">
                <p className="font-semibold text-white mb-2">{t('danger_zone.deactivate_blocked_title')}</p>
                <p className="text-sm text-white/60 mb-3">{t('danger_zone.deactivate_blocked_body')}</p>
                <ul className="space-y-2">
                  {blockedEvents.map((ev) => (
                    <li key={ev.id} className="rounded bg-white/[0.06] px-3 py-2 text-sm">
                      <a href={`/organizer/events/${encodeURIComponent(ev.id)}`} className="font-medium text-white hover:underline">
                        {ev.title}
                      </a>
                      <span className="block text-white/55">
                        {t('danger_zone.deactivate_blocked_tickets', { count: ev.ticketsSold })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-white/60 mb-6">
                {t('danger_zone.deactivate_confirm')}
              </p>
            )}
            {deactivateError && (
              <div role="alert" className="mb-4 rounded bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
                {deactivateError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeactivateModal(false);
                  setBlockedEvents(null);
                  setDeactivateError(null);
                }}
                className="flex-1 px-4 py-3 text-white/70 font-medium rounded bg-white/[0.07] hover:bg-white/[0.12] text-[16px] focus:outline-none"
              >
                {t('actions.cancel')}
              </button>
              {!blockedEvents && (
              <button
                onClick={handleDeactivate}
                disabled={isDeactivating}
                className="flex-1 px-4 py-2.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-medium rounded disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeactivating && <Loader2 className="w-4 h-4 animate-spin" />}
                {isDeactivating ? t('danger_zone.deactivating') : t('danger_zone.deactivate')}
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      <DeleteAccountDialog open={showDeleteModal} onClose={() => setShowDeleteModal(false)} />
    </div>
  );
}
