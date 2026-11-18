'use client'

import { useRouter } from 'next/navigation'
import { ConsoleAge, ConsolePanel, ConsoleRow, useConsoleNow } from '@/components/admin/console'
import type { NeedsYouItem } from '@/lib/admin/needs-you'

/**
 * The landing list: every queue merged, oldest first, each row edged in its age
 * color so the backlog reads as a temperature map before a word is read.
 * The whole row is the button — a triage list doesn't need a second target.
 */
export function NeedsYouClient({ items }: { items: NeedsYouItem[] }) {
  const router = useRouter()
  const now = useConsoleNow()

  if (items.length === 0) {
    return (
      <ConsolePanel className="px-4 py-14 text-center">
        <p className="label-mono text-caption uppercase tracking-[0.14em] text-console-mut">
          Nothing waiting
        </p>
        <p className="mt-1 text-meta text-console-faint">Every queue is clear.</p>
      </ConsolePanel>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <ConsoleRow
          key={`${item.queue}:${item.id}`}
          ageAt={item.createdAt}
          now={now}
          onClick={() => router.push(item.href)}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-console-text">{item.subject}</p>
            <p className="truncate text-caption text-console-mut">{item.decision}</p>
          </div>
          <ConsoleAge ageAt={item.createdAt} now={now} />
          <span className="label-mono hidden shrink-0 text-eyebrow tracking-[0.06em] text-console-mut sm:inline">
            OPEN ↵
          </span>
        </ConsoleRow>
      ))}
    </div>
  )
}
