import { requireOrgPage } from '@/app/organizer/_lib/orgPage';
import { adminDb } from '@/lib/firebase/admin';
import NotificationsForm from './NotificationsForm';
import { withOrganizerNotificationDefaults } from '@/lib/organizer/notificationPreferences';
import { SettingsPageChrome } from '@/components/organizer/ui/SettingsPageChrome';

export const dynamic = 'force-dynamic';

async function getNotificationPreferences(userId: string) {
  const prefsDoc = await adminDb
    .collection('organizers')
    .doc(userId)
    .collection('notificationPreferences')
    .doc('main')
    .get();

  return prefsDoc.exists ? prefsDoc.data() : null;
}

export default async function NotificationsSettingsPage() {
  const ctx = await requireOrgPage('manage_settings', '/organizer/settings/notifications');
  const orgId = ctx.orgId;

  const preferences = await getNotificationPreferences(orgId);

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="notifications_title" subtitleKey="notifications_subtitle" />

        {/* Notifications Form */}
        <div className="mt-8 overflow-hidden rounded-2xl bg-white/[0.03]">
          <NotificationsForm 
            userId={orgId}
            initialData={withOrganizerNotificationDefaults(preferences)}
          />
        </div>
      </div>
    </div>
  );
}
