import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
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
  const user = await getCurrentUser();

  if (!user?.id) {
    redirect('/auth/login?redirect=/organizer/settings/notifications');
  }

  if (user.role !== 'organizer') {
    redirect('/organizer?redirect=/organizer/settings/notifications');
  }

  const preferences = await getNotificationPreferences(user.id);

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="notifications_title" subtitleKey="notifications_subtitle" />

        {/* Notifications Form */}
        <div className="mt-8 overflow-hidden rounded-2xl bg-white/[0.03]">
          <NotificationsForm 
            userId={user.id}
            initialData={withOrganizerNotificationDefaults(preferences)}
          />
        </div>
      </div>
    </div>
  );
}
