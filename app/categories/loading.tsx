/**
 * Categories hub loading skeleton.
 *
 * The shapes were roughly right but nothing was VISIBLE: the six category
 * cards and nine event cards were `bg-white/[0.03] border border-white/10`,
 * which on a `#0a0a0a` page paints six and then nine empty outlines. The nine
 * event cards were also a layout the hub does not have — the event grid only
 * appears when a `?category=` is set, and it is a 4:5 poster grid, not a
 * `h-48 md:h-56` block. The navbar was `py-3` (56px at every width) against a
 * real `h-14 sm:h-16`.
 *
 * Derived geometry:
 *   navbar    h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   body      CategoriesContent — max-w-7xl px-4 sm:px-6 lg:px-8 py-6 md:py-8
 *   header    mb-6 md:mb-8 — h1 clamp(28px,4.5vw,40px) leading 1.02, then
 *             p mt-2 at 13px / 15px from md
 *   grid      CategoryGrid, wrapped in mb-8 md:mb-12:
 *             grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4,
 *             cells h-24 sm:h-28 rounded-2xl
 *
 * The `?category=` event grid is deliberately not drawn: the bare hub is the
 * common entry and shows nothing there, so drawing it would ADD a block that
 * then disappears. /categories/[category] has its own boundary.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      {/* Navbar — h-14 / sm:h-16 with this page's bottom rule. */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        <div className="mb-6 md:mb-8">
          <Bar className="h-8 w-52 md:h-10 md:w-64" />
          <Bar className="mt-2 h-4 w-72 max-w-full" />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:mb-12 md:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl sm:h-28" />
          ))}
        </div>
      </div>
    </div>
  )
}
