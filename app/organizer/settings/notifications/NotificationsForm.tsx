'use client';

import { useTranslation } from 'react-i18next'

import { useState } from 'react';
import { Bell, Mail, MessageSquare, Smartphone, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

interface NotificationsFormProps {
  userId: string;
  initialData: {
    email_ticket_sales: boolean;
    email_new_reviews: boolean;
    email_payout_updates: boolean;
    email_event_reminders: boolean;
    email_marketing: boolean;
    sms_ticket_sales: boolean;
    sms_event_reminders: boolean;
    push_ticket_sales: boolean;
    push_new_reviews: boolean;
    email_attendee_messages: boolean;
    push_attendee_messages: boolean;
  };
}

export default function NotificationsForm({ userId, initialData }: NotificationsFormProps) {
  const { t } = useTranslation('organizer')

  const [formData, setFormData] = useState(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  const handleToggle = (key: keyof typeof formData) => {
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
        title: 'Preferences saved',
        message: 'Your notification preferences have been updated.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error updating notifications:', error);
      showToast({
        title: 'Error',
        message: 'Failed to update preferences. Please try again.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-8">
      {/* Email Notifications */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-brand-300" />
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('notifications_form.email_notifications')}</h3>
        </div>
        <div className="space-y-4">
          <ToggleItem
            label={t('notifications_form.ticket_sales')}
            message="Get notified when someone purchases a ticket"
            checked={formData.email_ticket_sales}
            onChange={() => handleToggle('email_ticket_sales')}
          />
          <ToggleItem
            label={t('notifications_form.new_reviews')}
            message="Get notified when your event receives a review"
            checked={formData.email_new_reviews}
            onChange={() => handleToggle('email_new_reviews')}
          />
          <ToggleItem
            label={t('notifications_form.attendee_messages')}
            message={t('notifications_form.attendee_messages_email')}
            checked={formData.email_attendee_messages}
            onChange={() => handleToggle('email_attendee_messages')}
          />
          <ToggleItem
            label={t('notifications_form.payout_updates')}
            message="Get notified about payout status changes"
            checked={formData.email_payout_updates}
            onChange={() => handleToggle('email_payout_updates')}
          />
          <ToggleItem
            label={t('notifications_form.event_reminders')}
            message="Get reminders before your events start"
            checked={formData.email_event_reminders}
            onChange={() => handleToggle('email_event_reminders')}
          />
          <ToggleItem
            label={t('notifications_form.marketing_updates')}
            message="Receive tips, feature updates, and promotional content"
            checked={formData.email_marketing}
            onChange={() => handleToggle('email_marketing')}
          />
        </div>
      </div>

      {/* SMS Notifications */}
      <div className="pt-6 border-t border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-brand-300" />
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('notifications_form.sms_notifications')}</h3>
        </div>
        <div className="space-y-4">
          <ToggleItem
            label={t('notifications_form.ticket_sales')}
            message="Receive SMS when someone purchases a ticket"
            checked={formData.sms_ticket_sales}
            onChange={() => handleToggle('sms_ticket_sales')}
          />
          <ToggleItem
            label={t('notifications_form.event_reminders')}
            message="Receive SMS reminders before your events"
            checked={formData.sms_event_reminders}
            onChange={() => handleToggle('sms_event_reminders')}
          />
        </div>
        <p className="text-xs text-white/50 mt-3">
          SMS notifications require a verified phone number. Standard rates may apply.
        </p>
      </div>

      {/* Push Notifications */}
      <div className="pt-6 border-t border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <Smartphone className="w-5 h-5 text-brand-300" />
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('notifications_form.push_notifications')}</h3>
        </div>
        <div className="space-y-4">
          <ToggleItem
            label={t('notifications_form.ticket_sales')}
            message="Get instant push notifications for ticket sales"
            checked={formData.push_ticket_sales}
            onChange={() => handleToggle('push_ticket_sales')}
          />
          <ToggleItem
            label={t('notifications_form.new_reviews')}
            message="Get instant push notifications for new reviews"
            checked={formData.push_new_reviews}
            onChange={() => handleToggle('push_new_reviews')}
          />
          <ToggleItem
            label={t('notifications_form.attendee_messages')}
            message={t('notifications_form.attendee_messages_push')}
            checked={formData.push_attendee_messages}
            onChange={() => handleToggle('push_attendee_messages')}
          />
        </div>
        <p className="text-xs text-white/50 mt-3">
          Push notifications require the Tikèm mobile app.
        </p>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-4 border-t border-white/10">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'Saving...' : 'Save Preferences'}
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
