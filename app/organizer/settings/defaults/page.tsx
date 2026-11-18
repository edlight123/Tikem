import { requireOrgPage } from '@/app/organizer/_lib/orgPage';
import { adminDb } from '@/lib/firebase/admin';
import DefaultsForm from './DefaultsForm';
import { SettingsPageChrome } from '@/components/organizer/ui/SettingsPageChrome';

export const dynamic = 'force-dynamic';

async function getOrganizerData(userId: string) {
  const organizerDoc = await adminDb.collection('organizers').doc(userId).get();
  return organizerDoc.exists ? organizerDoc.data() : null;
}

export default async function DefaultsSettingsPage() {
  const ctx = await requireOrgPage('manage_settings', '/organizer/settings/defaults');
  const orgId = ctx.orgId;

  const organizerData = await getOrganizerData(orgId);

  return (
    <div className="min-h-screen bg-canvas py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="defaults_title" subtitleKey="defaults_subtitle" />

        {/* Defaults Form */}
        <div className="mt-8 overflow-hidden rounded-2xl bg-surface-low">
          <DefaultsForm 
            userId={orgId}
            initialData={{
              default_city: organizerData?.default_city || '',
              default_country: organizerData?.default_country || 'HT',
              default_timezone: organizerData?.default_timezone || 'America/Port-au-Prince',
              default_currency: organizerData?.default_currency || 'HTG',
              default_categories: organizerData?.default_categories || [],
            }}
          />
        </div>

        {/* Info Notice */}
        <div className="mt-6 p-4 bg-surface-low  rounded-lg">
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">Note:</strong> These defaults will be pre-filled when you create a new event, but you can always change them for individual events.
          </p>
        </div>
      </div>
    </div>
  );
}
