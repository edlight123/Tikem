import { requireOrgPage } from '@/app/organizer/_lib/orgPage';
import { adminDb } from '@/lib/firebase/admin';
import SecurityForm from './SecurityForm';
import { SettingsPageChrome } from '@/components/organizer/ui/SettingsPageChrome';

export const dynamic = 'force-dynamic';

async function getLoginHistory(userId: string) {
  const loginSnapshot = await adminDb
    .collection('organizers')
    .doc(userId)
    .collection('loginHistory')
    .orderBy('timestamp', 'desc')
    .limit(10)
    .get();

  return loginSnapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export default async function SecuritySettingsPage() {
  const ctx = await requireOrgPage('view', '/organizer/settings/security');
  const user = ctx.user;

  const loginHistory = await getLoginHistory(user.id);

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="security_title" subtitleKey="security_subtitle" />

        {/* mt-8, matching profile / organization / defaults / notifications.
            Without it the subtitle butts straight into the first card, which
            is why this page read as more cramped than its siblings. */}
        <div className="mt-8">
        <SecurityForm 
          userId={user.id}
          loginHistory={loginHistory}
        />
        </div>
      </div>
    </div>
  );
}
