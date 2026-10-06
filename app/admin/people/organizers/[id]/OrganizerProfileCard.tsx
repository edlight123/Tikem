'use client'

import { ConsolePanel } from '@/components/admin/console'
import { safeExternalUrl } from '@/lib/safeUrl'

/** The public-facing organization details, when the organizer has filled any in. */
export default function OrganizerProfileCard({ organizer }: { organizer: any }) {
  // Organizer-typed and possibly stored before write-side validation existed:
  // only an http(s) URL becomes a link, anything else renders as plain text.
  const websiteHref = safeExternalUrl(organizer.website)
  return (
    <ConsolePanel className="p-4 sm:p-5 lg:col-span-2">
      <h2 className="label-mono mb-4 text-[10px] uppercase tracking-[0.18em] text-console-faint">
        Organization Profile
      </h2>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {organizer.organization_name && (
          <div>
            <dt className="text-xs text-console-mut">Organization Name</dt>
            <dd className="mt-1 text-sm text-console-text">{organizer.organization_name}</dd>
          </div>
        )}

        {organizer.business_type && (
          <div>
            <dt className="text-xs text-console-mut">Business Type</dt>
            <dd className="mt-1 text-sm text-console-text">{organizer.business_type}</dd>
          </div>
        )}

        {organizer.website && (
          <div>
            <dt className="text-xs text-console-mut">Website</dt>
            <dd className="mt-1 text-sm text-console-text">
              {websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-console-mut hover:underline"
                >
                  {organizer.website}
                </a>
              ) : (
                <span className="break-all">{String(organizer.website)}</span>
              )}
            </dd>
          </div>
        )}

        {organizer.description && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-console-mut">Description</dt>
            <dd className="mt-1 text-sm text-console-text">{organizer.description}</dd>
          </div>
        )}
      </dl>
    </ConsolePanel>
  )
}
