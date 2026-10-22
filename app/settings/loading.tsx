/**
 * Settings loading skeleton.
 *
 * The old one had the wrong container (`max-w-7xl` against a real `max-w-4xl`),
 * no back link, and eight `bg-white/[0.03] border border-white/10` blocks where
 * the page has FOUR cards — and that fill is invisible on `#0a0a0a`, so the
 * loading state was eight empty outlines at the wrong width. Its navbar was
 * `py-3` (56px everywhere) against a real `h-14 sm:h-16`.
 *
 * Derived geometry (SettingsPageClient):
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   body     max-w-4xl px-4 sm:px-6 lg:px-8 py-8
 *   back     inline-flex text link with a 16px chevron, mb-6
 *   header   mb-8 — h1 text-3xl (36px line box), p mt-2
 *   cards    space-y-6 — four `rounded-2xl border border-white/10
 *            bg-white/[0.03] p-6` shells: a 40px rounded-xl icon tile beside a
 *            title + subtitle (mb-6), then the card's own rows. The fourth
 *            carries `border-red-500/20` (Danger Zone).
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

function Card({ lines, danger = false }: { lines: number; danger?: boolean }) {
  return (
    <div
      className={`rounded-2xl border bg-white/[0.03] p-6 ${
        danger ? 'border-red-500/20' : 'border-white/10'
      }`}
    >
      <div className="mb-6 flex items-center gap-3">
        <div className="skeleton h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <Bar className="h-6 w-44" />
          <Bar className="mt-1.5 h-4 w-56 max-w-full" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: lines }).map((_, l) => (
          <Bar key={l} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      {/* Navbar */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* back to profile */}
        <Bar className="mb-6 h-6 w-36" />

        {/* header */}
        <div className="mb-8">
          <Bar className="h-9 w-44" />
          <Bar className="mt-2 h-5 w-64 max-w-full" />
        </div>

        <div className="space-y-6">
          <Card lines={3} />
          <Card lines={3} />
          <Card lines={1} />
          <Card lines={1} danger />
        </div>
      </div>
    </div>
  )
}
