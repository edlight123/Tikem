'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

type Share = {
  id: string
  title: string
  image_url: string
  status: 'live' | 'review' | 'not_approved'
  event_id: string | null
  reason: string | null
  created_at: string
}

// A dot and a label, never a filled status pill (house rule).
const DOT: Record<Share['status'], string> = {
  live: 'bg-brand-400',
  review: 'bg-fg-faint',
  not_approved: 'bg-danger-soft',
}

export default function MySharesClient() {
  const { t } = useTranslation('common')
  const [shares, setShares] = useState<Share[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/community/submissions', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setShares(Array.isArray(d?.shares) ? d.shares : []))
      .catch(() => setError(true))
  }, [])

  return (
    <div>
      <h1 className="font-display italic lowercase !text-[clamp(28px,4vw,40px)] !leading-[1.04] text-fg">
        {t('community.share.mine_title', { defaultValue: 'my shared events' })}
      </h1>
      {error ? (
        <p className="mt-6 text-meta text-danger-soft">{t('community.share.errors.generic')}</p>
      ) : !shares ? (
        <p className="mt-6 text-meta text-fg-subtle">…</p>
      ) : shares.length === 0 ? (
        <p className="mt-6 text-meta text-fg-muted">
          {t('community.share.mine_empty')}{' '}
          <Link href="/share-event" className="font-semibold text-fg underline underline-offset-4">
            {t('community.share.share_one')}
          </Link>
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {shares.map((s) => {
            const row = (
              <div className="flex items-center gap-3 rounded bg-surface p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.image_url} alt="" className="h-14 w-11 shrink-0 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold text-fg">{s.title || '—'}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-meta text-fg-muted">
                    <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} aria-hidden />
                    {t(`community.share.status_${s.status}`)}
                    {s.reason ? <span className="truncate text-fg-subtle">· {s.reason}</span> : null}
                  </p>
                </div>
              </div>
            )
            return (
              <li key={s.id}>
                {s.status === 'live' && s.event_id ? (
                  <Link href={`/events/${encodeURIComponent(s.event_id)}`} className="block hover:opacity-90">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
