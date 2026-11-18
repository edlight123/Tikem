/**
 * Organizer → Settings → Notifications loading skeleton.
 *
 * Page body only: the organizer layout already paints OrganizerTopNav and the
 * `pb-mobile-nav` main.
 *
 * Derived geometry (app/organizer/settings/notifications/page.tsx):
 *   root    min-h-screen bg-canvas py-8
 *   inner   max-w-3xl px-4 sm:px-6 lg:px-8
 *   back    inline text-sm link + 16px chevron, mb-6
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle
 *           mt-1.5  (the eyebrow was missing here)
 *   card    mt-8 overflow-hidden rounded-2xl bg-surface-low — NotificationsForm
 *           carries three channels with 5 / 2 / 2 toggles (email, SMS, push);
 *           this used to draw 3 × 4, so the card was ~90px too tall
 *
 * Toggles are the real 44×24 switch (`w-11 h-6 rounded-full`). The old
 * `w-96` subtitle bar is gone: 384px inside a 370px content box overflowed
 * horizontally at 402px.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

const CHANNELS = [5, 2, 2]

export default function NotificationsLoading() {
  return (
    <div className="min-h-screen bg-canvas py-8">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Bar className="mb-6 h-5 w-32" />

        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-52 sm:h-9 sm:w-60" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        <div className="mt-8 space-y-8 overflow-hidden rounded-2xl bg-surface-low p-6">
          {CHANNELS.map((items, section) => (
            <div key={section}>
              <Bar className="mb-4 h-6 w-44" />
              <div className="space-y-4">
                {Array.from({ length: items }).map((_, item) => (
                  <div key={item} className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Bar className="h-5 w-32" />
                      <Bar className="h-4 w-full max-w-md" />
                    </div>
                    <Bar className="h-6 w-11 shrink-0 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
