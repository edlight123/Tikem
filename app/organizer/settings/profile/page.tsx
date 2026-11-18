import { redirect } from 'next/navigation';
import { requireOrgPage } from '@/app/organizer/_lib/orgPage';
import { adminDb } from '@/lib/firebase/admin';
import ProfileForm from './ProfileForm';
import { SettingsPageChrome } from '@/components/organizer/ui/SettingsPageChrome';

export const dynamic = 'force-dynamic';

async function getUserProfile(userId: string) {
  const userDoc = await adminDb.collection('users').doc(userId).get();
  return userDoc.exists ? userDoc.data() : null;
}

export default async function ProfileSettingsPage() {
  const ctx = await requireOrgPage('view', '/organizer/settings/profile');
  const user = ctx.user;

  const userProfile = await getUserProfile(user.id);

  if (!userProfile) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-canvas py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="profile_title" subtitleKey="profile_subtitle" />

        {/* Profile Form */}
        <div className="mt-8 overflow-hidden rounded-2xl bg-surface-low">
          <ProfileForm 
            userId={user.id}
            initialData={{
              full_name: userProfile.full_name || '',
              email: userProfile.email || user.email || '',
              phone_number: userProfile.phone_number || '',
              photo_url: userProfile.photo_url || user.photo_url || '',
            }}
          />
        </div>

        {/* Info Notice */}
        <div className="mt-6 p-4 bg-surface-low  rounded-lg">
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">Note:</strong> Your email address is managed through your authentication provider and cannot be changed here. Contact support if you need to update your email.
          </p>
        </div>
      </div>
    </div>
  );
}
