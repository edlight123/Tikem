'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorialSectionHeading } from '@/components/ui/EditorialHeader'

interface Summary {
  sent: number
  joined: number
  purchased: number
}

/**
 * "Your invites" on /profile (lib/invites): invites sent, people who joined
 * from your link, people who bought. Counts only. Renders nothing while
 * loading, when config/auth.invites is off (the endpoint 404s), or when the
 * user has never invited anyone.
 */
export function InviteSummaryCard() {
  const { t } = useTranslation('common')
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/invites/summary')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.enabled) {
          setSummary({ sent: Number(json.sent) || 0, joined: Number(json.joined) || 0, purchased: Number(json.purchased) || 0 })
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!summary || summary.sent + summary.joined + summary.purchased === 0) return null

  const cells = [
    { label: t('invites.summarySent'), value: summary.sent },
    { label: t('invites.summaryJoined'), value: summary.joined },
    { label: t('invites.summaryBought'), value: summary.purchased },
  ]
  return (
    <section>
      <EditorialSectionHeading title={t('invites.summaryTitle')} className="mb-4" />
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-2xl bg-white/[0.055] px-4 py-3">
            <div className="font-mono text-2xl font-bold tabular-nums text-white">{c.value}</div>
            <div className="mt-1 text-[12px] text-white/55">{c.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
