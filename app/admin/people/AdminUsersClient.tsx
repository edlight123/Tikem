'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConsoleButton } from '@/components/admin/console'
import { Search, ArrowUpRight } from 'lucide-react'

type AdminUsersClientProps = {
  counts: {
    total: number
    organizers: number
    verified: number
  }
  initialUsers: any[]
  initialHasMore?: boolean
  initialCursor?: string | null
}

export default function AdminUsersClient({
  counts,
  initialUsers,
  initialHasMore = false,
  initialCursor = null,
}: AdminUsersClientProps) {
  const { t } = useTranslation('admin')

  const [users, setUsers] = useState<any[]>(initialUsers)
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!normalizedQuery) return users
    return users.filter(
      (u) =>
        String(u.full_name || '').toLowerCase().includes(normalizedQuery) ||
        String(u.email || '').toLowerCase().includes(normalizedQuery),
    )
  }, [users, normalizedQuery])

  const loadMore = async () => {
    if (isLoadingMore || !hasMore || !cursor) return
    setIsLoadingMore(true)
    setLoadError(null)
    try {
      const url = new URL('/api/admin/users', window.location.origin)
      url.searchParams.set('limit', '200')
      url.searchParams.set('cursor', cursor)

      const res = await fetch(url.toString(), { method: 'GET' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Failed to load more users (${res.status})`)
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
          if (!id || seen.has(id)) continue
          seen.add(id)
          out.push(u)
        }
        return out
      })

      setCursor(nextCursor)
      setHasMore(nextHasMore && Boolean(nextCursor))
    } catch (err: any) {
      console.error('Load more users error:', err)
      setLoadError(err?.message || 'Failed to load more users')
    } finally {
      setIsLoadingMore(false)
    }
  }

  const stats: { label: string; value: string }[] = [
    { label: t('users.total_users'), value: counts.total.toLocaleString() },
    { label: t('users.organizers'), value: counts.organizers.toLocaleString() },
    { label: t('users.verified_organizers'), value: counts.verified.toLocaleString() },
  ]

  const columns: Column<any>[] = [
    {
      key: 'user',
      header: 'User',
      render: (u) => (
        <Link href={`/admin/people/${u.id}`} className="group block min-w-0">
          <span className="block truncate text-sm font-medium text-console-text group-hover:underline">
            {u.full_name || 'No name'}
          </span>
          <span className="block truncate text-meta text-console-mut">{u.email || 'No email'}</span>
        </Link>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <span className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">
          {String(u.role || 'attendee')}
        </span>
      ),
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
          href={`/admin/people/${u.id}`}
          className="inline-flex items-center gap-1 text-meta font-medium text-console-mut hover:text-console-text"
        >
          View <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ),
    },
  ]

  const renderMobileCard = (u: any) => (
    <Link href={`/admin/people/${u.id}`} className="block p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-console-text">{u.full_name || 'No name'}</span>
          <span className="block truncate text-meta text-console-mut">{u.email || 'No email'}</span>
        </div>
        <span className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">
          {String(u.role || 'attendee')}
        </span>
      </div>
      <div className="mt-2 font-mono tabular-nums text-meta text-console-mut">
        Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
      </div>
    </Link>
  )

  return (
    <div className="space-y-6">
      {/* Stats — plain figures, not boxed */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-8">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">
              {s.label}
            </div>
            <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search — refines the loaded list */}
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-console-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('users.search_users')}
          className="w-full rounded bg-console-panel py-2.5 pl-9 pr-3 text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
        />
      </div>

      {loadError && (
        <div className="rounded-lg bg-console-panel px-4 py-3 text-sm text-console-red">
          {loadError}
        </div>
      )}

      <DataTable<any>
        columns={columns}
        rows={filtered}
        rowKey={(u) => String(u?.id || '')}
        pageSize={25}
        variant="console"
        renderMobileCard={renderMobileCard}
        empty={
          <p className="label-mono text-center text-caption uppercase tracking-[0.14em] text-console-mut">
            {normalizedQuery ? 'No users match your search' : 'No users found'}
          </p>
        }
      />

      {hasMore && cursor && !normalizedQuery && (
        <div className="flex justify-center">
          <ConsoleButton type="button" variant="quiet" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t('users.loading') : t('users.load_more')}
          </ConsoleButton>
        </div>
      )}

      <p className="text-xs text-console-faint">{t('users.search_hint')}</p>
    </div>
  )
}
