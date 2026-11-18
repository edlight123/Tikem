/**
 * "Cleared today — 6 · by ted 4, by mireille 2"
 *
 * The concession to a shared-queue team without building assignment: you can
 * see the queue is moving and who is moving it, which is most of what
 * coordination buys you. Reads the existing admin audit log — no new writes, no
 * assigned_to field.
 */

export interface ClearedActivity {
  actor?: { name?: string }
  timestamp?: string
}

/** Actor tallies for activities that happened on `today`, busiest first. */
export function tallyClearedToday(
  activities: ClearedActivity[],
  now: Date = new Date()
): { total: number; byActor: { name: string; count: number }[] } {
  const day = now.toISOString().slice(0, 10)
  const counts = new Map<string, number>()

  for (const activity of activities) {
    if (!activity?.timestamp || activity.timestamp.slice(0, 10) !== day) continue
    const name = activity.actor?.name?.trim() || 'someone'
    counts.set(name, (counts.get(name) || 0) + 1)
  }

  const byActor = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return { total: byActor.reduce((sum, a) => sum + a.count, 0), byActor }
}

export function ClearedToday({ activities }: { activities: ClearedActivity[] }) {
  const { total, byActor } = tallyClearedToday(activities)

  // Nothing cleared yet today is not worth a line of chrome saying so.
  if (total === 0) return null

  return (
    <p className="label-mono mt-4 text-eyebrow uppercase tracking-[0.08em] text-console-faint">
      <span className="text-console-mut">Cleared today, </span>
      <span className="tabular-nums text-console-mut">{total}</span>
      {byActor.length > 0 && (
        <>
          {' · '}
          {byActor.map((actor, i) => (
            <span key={actor.name}>
              {i > 0 && ' · '}
              {actor.name} <span className="tabular-nums">{actor.count}</span>
            </span>
          ))}
        </>
      )}
    </p>
  )
}
