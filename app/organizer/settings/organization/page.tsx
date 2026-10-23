import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { readOrgBrandAdmin } from '@/lib/firestore/org-brand-server';
import OrganizationForm from './OrganizationForm';
import { SettingsPageChrome } from '@/components/organizer/ui/SettingsPageChrome';

export const dynamic = 'force-dynamic';

async function getOrganizerData(userId: string) {
  const [organizerDoc, brand] = await Promise.all([
    adminDb.collection('organizers').doc(userId).get(),
    // Name and logo from their canonical home (public_profiles), so a logo set
    // in the app shows here too: lib/profile/org-brand.ts.
    readOrgBrandAdmin(userId),
  ]);
  return { ...(organizerDoc.exists ? organizerDoc.data() : {}), ...brand } as Record<string, any>;
}

export default async function OrganizationSettingsPage() {
  const user = await getCurrentUser();

  if (!user?.id) {
    redirect('/auth/login?redirect=/organizer/settings/organization');
  }

  if (user.role !== 'organizer') {
    redirect('/organizer?redirect=/organizer/settings/organization');
  }

  const organizerData = await getOrganizerData(user.id);

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="organization_title" subtitleKey="organization_subtitle" />

        {/* Organization Form */}
        <div className="mt-8 overflow-hidden rounded-2xl bg-white/[0.03]">
          <OrganizationForm 
            userId={user.id}
            initialData={{
              organization_name: organizerData?.organization_name || '',
              organization_type: organizerData?.organization_type || '',
              organization_description: organizerData?.organization_description || '',
              organization_logo: organizerData?.organization_logo || '',
              website: organizerData?.website || '',
              facebook: organizerData?.social_media?.facebook || '',
              instagram: organizerData?.social_media?.instagram || '',
              twitter: organizerData?.social_media?.twitter || '',
              linkedin: organizerData?.social_media?.linkedin || '',
            }}
          />
        </div>
      </div>
    </div>
  );
}
