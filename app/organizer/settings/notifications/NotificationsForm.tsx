'use client';

import { useTranslation } from 'react-i18next'

import { useState } from 'react';
import { Mail, Smartphone, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import type { OrganizerNotificationPreferences } from '@/lib/organizer/notificationPreferences';

interface NotificationsFormProps {
  userId: string;
  initialData: OrganizerNotificationPreferences;
}

/**
 * Only switches that change a real send.
 *
 * This form used to offer eleven, of which the senders read two. Removed,
 * because Tikèm never sends them: an organizer sale EMAIL, reviews (there are
 * none), event-reminder and marketing emails to organizers, and every SMS row
 * (no SMS provider is wired). Payout updates are not a switch: they are about
 * the organizer's own money and always go out (lib/notifications/policy.ts,
 * the same "always on" the mobile app shows). The stored values for removed
 * keys are left as they were; this form only writes the keys it shows.
 *
 *   email_attendee_messages → lib/organizer-message-alerts.ts
 *   push_attendee_messages  → lib/organizer-message-alerts.ts
 *   push_ticket_sales       → notifyOrganizerTicketSale (lib/notifications/helpers.ts)
 */
const SHOWN_KEYS = ['email_attendee_messages', 'push_ticket_sales', 'push_attendee_messages'] as const;
type ShownKey = (typeof SHOWN_KEYS)[number];

export default function NotificationsForm({ initialData }: NotificationsFormProps) {
  const { t } = useTranslation('organizer')

  const [formData, setFormData] = useState<Record<ShownKey, boolean>>(() => ({
    email_attendee_messages: initialData.email_attendee_messages,
    push_ticket_sales: initialData.push_ticket_sales,
    push_attendee_messages: initialData.push_attendee_messages,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  const handleToggle = (key: ShownKey) => {
    setFormData((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/organizer/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to update notifications');
      }

      showToast({
        title: t('notifications_form.saved_title'),
        message: t('notifications_form.saved_body'),
        type: 'success',
      });
    } catch (error) {
      console.error('Error updating notifications:', error);
      showToast({
        title: t('notifications_form.save_failed_title'),
        message: t('notifications_form.save_failed_body'),
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-8">
      {/* Email */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-brand-300" />
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('notifications_form.email_notifications')}</h3>
        </div>
        <div className="space-y-4">
          <ToggleItem
            label={t('notifications_form.attendee_messages')}
            message={t('notifications_form.attendee_messages_email')}
            checked={formData.email_attendee_messages}
            onChange={() => handleToggle('email_attendee_messages')}
          />
        </div>
      </div>

      {/* Push (mobile app) */}
      <div className="pt-6 border-t border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <Smartphone className="w-5 h-5 text-brand-300" />
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('notifications_form.push_notifications')}</h3>
        </div>
        <div className="space-y-4">
          <ToggleItem
            label={t('notifications_form.ticket_sales')}
            message={t('notifications_form.ticket_sales_push')}
            checked={formData.push_ticket_sales}
            onChange={() => handleToggle('push_ticket_sales')}
          />
          <ToggleItem
            label={t('notifications_form.attendee_messages')}
            message={t('notifications_form.attendee_messages_push')}
            checked={formData.push_attendee_messages}
            onChange={() => handleToggle('push_attendee_messages')}
          />
        </div>
        <p className="text-xs text-white/50 mt-3">{t('notifications_form.push_app_note')}</p>
      </div>

      {/* Always on */}
      <div className="pt-6 border-t border-white/10">
        <p className="font-medium text-white">{t('notifications_form.payout_updates')}</p>
        <p className="text-sm text-white/60">{t('notifications_form.payouts_always')}</p>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-4 border-t border-white/10">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? t('notifications_form.saving') : t('notifications_form.save')}
        </button>
      </div>
    </form>
  );
}

function ToggleItem({
  label,
  message,
  checked,
  onChange,
}: {
  label: string;
  message: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="font-medium text-white">{label}</p>
        <p className="text-sm text-white/60">{message}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-brand-700' : 'bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
