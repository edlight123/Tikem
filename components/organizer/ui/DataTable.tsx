'use client'

import { useTranslation } from 'react-i18next'

import React, { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
} from 'lucide-react'

export type SortDir = 'asc' | 'desc'
type Align = 'left' | 'right' | 'center'

export interface OrgColumn<T> {
  key: string
  header: React.ReactNode
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  sortAccessor?: (row: T) => string | number | Date | null | undefined
  align?: Align
  cellClassName?: string
  headerClassName?: string
  /** Hide on <md (still shown in mobile card). */
  hideOnMobile?: boolean
}

export interface OrgDataTableProps<T> {
  columns: OrgColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void

  toolbar?: React.ReactNode

  loading?: boolean
  skeletonRows?: number
  empty?: React.ReactNode

  sortKey?: string
  sortDir?: SortDir
  onSortChange?: (key: string, dir: SortDir) => void

  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  pageSize?: number

  renderMobileCard?: (row: T) => React.ReactNode
  stickyHeader?: boolean
  className?: string
}

const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Dark-canvas data table for the organizer portal.
 * Same API as components/ui/DataTable but styled for the #0d0d0d surface.
 */
export function OrgDataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  toolbar,
  loading = false,
  skeletonRows = 6,
  empty,
  sortKey,
  sortDir,
  onSortChange,
  page,
  totalPages,
  onPageChange,
  pageSize,
  renderMobileCard,
  stickyHeader = true,
  className = '',
}: OrgDataTableProps<T>) {
  const { t } = useTranslation('organizer')
  const controlledSort = typeof onSortChange === 'function'
  const [internalSortKey, setInternalSortKey] = useState<string | undefined>()
  const [internalSortDir, setInternalSortDir] = useState<SortDir>('asc')
  const [internalPage, setInternalPage] = useState(1)

  const activeSortKey = controlledSort ? sortKey : internalSortKey
  const activeSortDir = controlledSort ? (sortDir ?? 'asc') : internalSortDir

  const handleSort = (col: OrgColumn<T>) => {
    if (!col.sortable) return
    const nextDir: SortDir =
      activeSortKey === col.key && activeSortDir === 'asc' ? 'desc' : 'asc'
    if (controlledSort) {
      onSortChange!(col.key, nextDir)
    } else {
      setInternalSortKey(col.key)
      setInternalSortDir(nextDir)
    }
  }

  const sortedRows = useMemo(() => {
    if (controlledSort || !internalSortKey) return rows
    const col = columns.find((c) => c.key === internalSortKey)
    if (!col) return rows
    const accessor =
      col.sortAccessor ?? ((row: T) => (row as Record<string, unknown>)[col.key] as never)
    const copy = [...rows]
    copy.sort((a, b) => {
      const res = compare(accessor(a), accessor(b))
      return internalSortDir === 'asc' ? res : -res
    })
    return copy
  }, [rows, columns, controlledSort, internalSortKey, internalSortDir])

  const clientPaginated = typeof page !== 'number' && typeof pageSize === 'number'
  const clientTotalPages = clientPaginated
    ? Math.max(1, Math.ceil(sortedRows.length / pageSize!))
    : 1
  const currentPage = clientPaginated ? Math.min(internalPage, clientTotalPages) : page

  const visibleRows = useMemo(() => {
    if (!clientPaginated) return sortedRows
    const start = (currentPage! - 1) * pageSize!
    return sortedRows.slice(start, start + pageSize!)
  }, [sortedRows, clientPaginated, currentPage, pageSize])

  const goToPage = (next: number) => {
    if (clientPaginated) setInternalPage(next)
    else onPageChange?.(next)
  }

  const footerTotalPages = clientPaginated ? clientTotalPages : totalPages
  const footerPage = clientPaginated ? currentPage : page
  const showFooter = !!footerTotalPages && footerTotalPages > 1

  function SortIcon({ col }: { col: OrgColumn<T> }) {
    if (!col.sortable) return null
    if (activeSortKey !== col.key)
      return <ChevronsUpDown className="h-3.5 w-3.5 text-white/30" />
    return activeSortDir === 'asc' ? (
      <ChevronUp className="h-3.5 w-3.5 text-brand-400" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-brand-400" />
    )
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl bg-white/[0.03] ${className}`}
    >
      {toolbar && (
        <div className="border-b border-white/10 p-3 sm:p-4">{toolbar}</div>
      )}

      {loading ? (
        <div className="divide-y divide-white/5">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4 sm:px-6">
              <div className="h-9 w-9 rounded-lg bg-white/[0.06]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded bg-white/[0.06]" />
                <div className="h-3 w-1/4 rounded bg-white/[0.06]" />
              </div>
              <div className="h-6 w-16 rounded bg-white/[0.06]" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        // The table card is already the fill: an empty state's own fill here
        // drew a box inside a box.
        <div className="p-8 [&>*]:bg-transparent">
          {empty ?? (
            <p className="text-center text-sm text-white/40">{t('actions.no_results_found')}</p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead
                className={`bg-[#141414] ${stickyHeader ? 'sticky top-0 z-10' : ''}`}
              >
                <tr className="border-b border-white/10">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col)}
                      className={`label-mono px-4 py-3 text-[11px] uppercase text-white/40 sm:px-6 ${
                        alignClass[col.align ?? 'left']
                      } ${col.sortable ? 'cursor-pointer select-none hover:text-white/70' : ''} ${
                        col.headerClassName ?? ''
                      }`}
                    >
                      <span
                        className={`inline-flex items-center gap-1.5 ${
                          col.align === 'right' ? 'flex-row-reverse' : ''
                        }`}
                      >
                        {col.header}
                        <SortIcon col={col} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleRows.map((row) => {
                  const id = rowKey(row)
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`transition-colors hover:bg-white/[0.04] ${
                        onRowClick ? 'cursor-pointer' : ''
                      }`}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-3.5 align-middle text-sm text-white sm:px-6 ${
                            alignClass[col.align ?? 'left']
                          } ${col.cellClassName ?? ''}`}
                        >
                          {col.render
                            ? col.render(row)
                            : String((row as Record<string, unknown>)[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-white/5 md:hidden">
            {visibleRows.map((row) => {
              const id = rowKey(row)
              if (renderMobileCard) {
                return (
                  <div
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                  >
                    {renderMobileCard(row)}
                  </div>
                )
              }
              return (
                <div
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`space-y-2 p-4 ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3">
                      <span className="label-mono text-[11px] uppercase text-white/40">
                        {col.header}
                      </span>
                      <span className="min-w-0 text-right text-sm text-white">
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key] ?? '')}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}

      {showFooter && (
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 sm:px-6">
          <p className="font-mono tabular-nums text-xs text-white/40">
            Page {footerPage} of {footerTotalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage((footerPage ?? 1) - 1)}
              disabled={(footerPage ?? 1) <= 1}
              className="inline-flex items-center gap-1 rounded bg-white/[0.07] px-3 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage((footerPage ?? 1) + 1)}
              disabled={(footerPage ?? 1) >= (footerTotalPages ?? 1)}
              className="inline-flex items-center gap-1 rounded bg-white/[0.07] px-3 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Toolbar row above the table — search + filter row.
 * Wrap any combination of SearchInput, FilterBar, and action buttons.
 */
export function TableToolbar({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {children}
    </div>
  )
}
