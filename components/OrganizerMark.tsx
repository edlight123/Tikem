import { Building2 } from 'lucide-react'

/**
 * An organizer's identity mark. The uploaded logo wins; with no logo the mark
 * is an organization glyph on a quiet fill, never the name's first letter
 * (owner rule: "for an org, the icon should be like an org"). People keep
 * their initials; organizations do not.
 *
 * `className` sets the box size and radius (e.g. "h-11 w-11 rounded-xl").
 */
export default function OrganizerMark({
  logoUrl,
  className = 'h-11 w-11 rounded-xl',
}: {
  logoUrl?: string | null
  className?: string
}) {
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center overflow-hidden bg-white/[0.08] text-white ${className}`}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <Building2 aria-hidden className="h-[45%] w-[45%]" strokeWidth={1.75} />
      )}
    </div>
  )
}
