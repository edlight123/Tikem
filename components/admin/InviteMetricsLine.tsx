import { getInviteTotals } from '@/lib/invites/server'

/**
 * One line on /admin/analytics: friend invites sent, people who joined from an
 * invite link, and buyers credited to an invite (lib/invites). Server
 * component; a read failure renders nothing rather than zeros that look real.
 */
export async function InviteMetricsLine() {
  let totals: { sent: number; joined: number; purchased: number } | null = null
  try {
    totals = await getInviteTotals()
  } catch (err) {
    console.error('[admin] invite totals failed', (err as any)?.message)
  }
  if (!totals) return null

  const cells = [
    { label: 'Invites sent', value: totals.sent },
    { label: 'Joined from invite', value: totals.joined },
    { label: 'Buyers from invites', value: totals.purchased },
  ]
  return (
    <section className="mt-8 rounded-xl bg-white/[0.04] px-4 py-3">
      <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Friend invites</div>
      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
        {cells.map((c) => (
          <div key={c.label} className="flex items-baseline gap-2">
            <span className="font-mono text-lg tabular-nums text-console-text">{c.value}</span>
            <span className="text-[12px] text-console-mut">{c.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
