'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConsoleButton, ConsoleState } from '@/components/admin/console'
import { Search, ArrowUpRight } from 'lucide-react'

type VerifyState = 'verified' | 'pending' | 'unverified'
function verifyState(u: any): VerifyState {
  const s = String(u?.verification_status || '').toLowerCase()
  if (s === 'approved') return 'verified'
  if (s === 'pending' || s === 'pending_review' || s === 'in_review') return 'pending'
  return 'unverified'
}

type AdminOrganizersClientProps = {
  counts: {
    total: number
    organizers: number
    verified: number
  }
  initialUsers: any[]
  initialHasMore?: boolean
  initialCursor?: string | null
}

export default function AdminOrganizersClient({
  counts,
  initialUsers,
  initialHasMore = false,
  initialCursor = null,
}: AdminOrganizersClientProps) {
  const { t } = useTranslation('admin')

  const [users, setUsers] = useState<any[]>(initialUsers)
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const [verifyFilter, setVerifyFilter] = useState<'all' | VerifyState>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (verifyFilter !== 'all' && verifyState(u) !== verifyFilter) return false
      if (!q) return true
      return (
        String(u.full_name || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q)
      )
    })
  }, [users, query, verifyFilter])

  const loadMore = async () => {
    if (isLoadingMore || !hasMore || !cursor) return
    setIsLoadingMore(true)
    try {
      const url = new URL('/api/admin/organizers', window.location.origin)
      url.searchParams.set('limit', '200')
      url.searchParams.set('cursor', cursor)

      const res = await fetch(url.toString(), { method: 'GET' })
      if (!res.ok) {
        console.error('Failed to load more organizers:', await res.text())
        return
      }

      const data = await res.json()
      const nextUsers = Array.isArray(data?.users) ? data.users : []
      const nextCursor = typeof data?.nextCursor === 'string' ? data.nextCursor : null
      const nextHasMore = Boolean(data?.hasMore)

      setUsers((prev) => {
        const seen = new Set(prev.map((u: any) => String(u?.id || '')))
        const out = [...prev]
        for (const u of nextUsers) {
          const id = String(u?.id || '')
          if (!id) continue
          if (seen.has(id)) continue
          seen.add(id)
          out.push(u)
        }
        return out
      })

      setCursor(nextCursor)
      setHasMore(nextHasMore && Boolean(nextCursor))
    } catch (err) {
      console.error('Load more organizers error:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }

  const renderVerification = (u: any) => {
    if (u.verification_status === 'approved') {
      return <ConsoleState tone="good">{t('users.verified')}</ConsoleState>
    }
    if (
      u.verification_status === 'pending' ||
      u.verification_status === 'pending_review' ||
      u.verification_status === 'in_review'
    ) {
      return <ConsoleState tone="warn">Pending</ConsoleState>
    }
    return <ConsoleState tone="neutral">Not Verified</ConsoleState>
  }

  const columns: Column<any>[] = [
    {
      key: 'user',
      header: 'Organizer',
      render: (u) => (
        <Link href={`/admin/people/organizers/${u.id}`} className="group block min-w-0">
          <span className="block truncate text-sm font-medium text-console-text group-hover:underline">
            {u.full_name || 'No name'}
          </span>
          <span className="block truncate text-meta text-console-mut">{u.email}</span>
        </Link>
      ),
    },
    {
      key: 'verification',
      header: 'Verification',
      render: (u) => renderVerification(u),
    },
    {
      key: 'joined',
      header: 'Joined',
      render: (u) => (
        <span className="font-mono tabular-nums text-meta text-console-mut whitespace-nowrap">
          {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (u) => (
        <Link
          href={`/admin/people/organizers/${u.id}`}
          className="inline-flex items-center gap-1 text-meta font-medium text-console-mut hover:text-console-text"
        >
          Manage <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ),
    },
  ]

  const renderOrganizerMobileCard = (u: any) => (
    <Link href={`/admin/people/organizers/${u.id}`} className="block p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-console-text">{u.full_name || 'No name'}</span>
          <span className="block truncate text-meta text-console-mut">{u.email}</span>
        </div>
        {renderVerification(u)}
      </div>
      <div className="mt-2 font-mono tabular-nums text-meta text-console-mut">
        Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
      </div>
    </Link>
  )

  const unverified = Math.max(0, counts.organizers - counts.verified)
  const stats = [
    { label: 'Organizers', value: counts.organizers },
    { label: 'Verified', value: counts.verified },
    { label: 'Not verified', value: unverified },
  ]

  const filters: { key: 'all' | VerifyState; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'verified', label: 'Verified' },
    { key: 'pending', label: 'Pending' },
    { key: 'unverified', label: 'Not verified' },
  ]

  return (
    <div>
      {/* Stats — plain figures, not boxed */}
      <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-8">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">
              {s.label}
            </div>
            <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">
              {s.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar: search + verification filter */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-console-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            className="w-full rounded bg-console-panel py-2.5 pl-9 pr-3 text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
          />
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto rounded-lg bg-console-panel p-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setVerifyFilter(f.key)}
              className={`shrink-0 rounded px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut ${
                verifyFilter === f.key
                  ? 'bg-console-raise text-console-text'
                  : 'text-console-mut hover:text-console-text'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DataTable<any>
        columns={columns}
        rows={filtered}
        rowKey={(u) => String(u?.id || '')}
        pageSize={25}
        variant="console"
        renderMobileCard={renderOrganizerMobileCard}
        empty={
          <p className="label-mono text-center text-caption uppercase tracking-[0.14em] text-console-mut">
            {query || verifyFilter !== 'all' ? 'No organizers match your filters' : t('organizers.no_organizers_found')}
          </p>
        }
      />

      {hasMore && cursor && (
        <div className="mt-4 sm:mt-6 flex justify-center">
          <ConsoleButton type="button" variant="quiet" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t('users.loading') : t('users.load_more')}
          </ConsoleButton>
        </div>
      )}
    </div>
  )
}
