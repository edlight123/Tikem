import Link from 'next/link'
import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
  actionIcon?: LucideIcon
  /**
   * Kept for call-site compatibility. Both tones now render the same on-brand
   * dark surface: the app has one canvas, so there is no light variant left.
   */
  tone?: 'light' | 'dark'
}

/**
 * Legacy link-CTA empty state, restyled to the POSH formula (brief §2.6):
 * outline icon, serif lowercase headline, one muted line, one white pill.
 * A fill separates it from the page; no dashed edge, no hover scale.
 * Visually matches `EmptyState` in components/ui/kit.tsx.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  actionIcon: ActionIcon,
}: EmptyStateProps) {
  return (
    <div className="rounded-2xl bg-white/[0.055] px-6 py-12 text-center">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center text-white/45">
        <Icon className="h-9 w-9" strokeWidth={1.5} />
      </div>

      {/* `!text-[22px]`: `.mobile-typography h3` outranks a plain size utility. */}
      <h3 className="font-display lowercase !text-[22px] !leading-tight text-white">{title}</h3>

      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/55">{description}</p>

      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-6 inline-flex items-center gap-2 rounded bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
        >
          {ActionIcon && <ActionIcon className="h-4 w-4" />}
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
