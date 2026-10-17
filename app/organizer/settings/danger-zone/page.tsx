import { T } from '@/components/organizer/ui/TranslatedText'
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DangerZone from './DangerZone';
import { ChevronLeft, AlertTriangle } from 'lucide-react';
import { SettingsPageChrome } from '@/components/organizer/ui/SettingsPageChrome';

export const dynamic = 'force-dynamic';

export default async function DangerZoneSettingsPage() {
  const user = await getCurrentUser();

  if (!user?.id) {
    redirect('/auth/login?redirect=/organizer/settings/danger-zone');
  }

  if (user.role !== 'organizer') {
    redirect('/organizer?redirect=/organizer/settings/danger-zone');
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SettingsPageChrome titleKey="danger_zone_title" subtitleKey="danger_zone_subtitle" />

        {/* Warning Banner */}
        <div className="bg-red-500/10 rounded-2xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-300 mb-1"><T k="server_bits.proceed_with_caution" /></h3>
              <p className="text-sm text-red-200/80"><T k="server_bits.danger_intro" /></p>
            </div>
          </div>
        </div>

        {/* Danger Zone Actions */}
        <DangerZone userId={user.id} />
      </div>
    </div>
  );
}
