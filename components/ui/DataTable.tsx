'use client'

import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

export type SortDir = 'asc' | 'desc'
type Align = 'left' | 'right' | 'center'

export interface Column<T> {
  /** Stable id for the column; also used as the default sort key. */
  key: string
  /** Header label / node. */
  header: React.ReactNode
  /** Cell renderer. Defaults to String((row as any)[key]). */
  render?: (row: T) => React.ReactNode
  /** Enables the sortable header affordance for this column. */
  sortable?: boolean
  /** Value used when sorting client-side. Falls back to (row as any)[key]. */
  sortAccessor?: (row: T) => string | number | Date | null | undefined
  align?: Align
  /** Extra classes for the <td>. */
  cellClassName?: string
  /** Extra classes for the <th>. */
  headerClassName?: string
  /** Hide this column below md (it still appears in the mobile fallback card). */
  hideOnMobile?: boolean
}

export interface DataTableSelection {
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Stable key per row. */
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void

  /** Toolbar slot (search input, filters). Rendered above the table. */
  toolbar?: React.ReactNode

  /** Loading skeleton. */
  loading?: boolean
  /** Number of skeleton rows to render while loading. */
  skeletonRows?: number
  /** Shown when there are no rows (and not loading). */
  empty?: React.ReactNode

  /** Controlled sort — provide together with onSortChange for server-side sort. */
  sortKey?: string
  sortDir?: SortDir
  onSortChange?: (key: string, dir: SortDir) => void

  /** Controlled pagination (server-side). */
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  /** Client-side pagination — used only when controlled `page` is not provided. */
  pageSize?: number

  /** Optional row selection (checkbox column). */
  selection?: DataTableSelection

  /** Custom mobile (<md) card renderer. Falls back to a stacked label/value card. */
  renderMobileCard?: (row: T) => React.ReactNode

  stickyHeader?: boolean
  className?: string

  /**
   * Visual variant. 'default' is the shared organizer look (unchanged);
   * 'console' renders with the admin Control Room tokens (panel surface,
   * mono headers, raise-tone dividers, no borders). Purely additive.
   */
  variant?: 'default' | 'console'
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
 * Shared admin/organizer data table. Crisp corners, sticky header, clean
 * (zebra-free) rows, row hover, optional sort/pagination/selection, designed
 * empty + loading states, and a responsive mobile card fallback. The default
 * variant keeps the organizer look (teal brand accent); variant="console"
 * renders with the admin Control Room tokens instead.
 */
export function DataTable<T>({
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
  selection,
  renderMobileCard,
  stickyHeader = true,
  className = '',
  variant = 'default',
}: DataTableProps<T>) {
  const isConsole = variant === 'console'
  const controlledSort = typeof onSortChange === 'function'
  const [internalSortKey, setInternalSortKey] = useState<string | undefined>(undefined)
  const [internalSortDir, setInternalSortDir] = useState<SortDir>('asc')
  const [internalPage, setInternalPage] = useState(1)

  const activeSortKey = controlledSort ? sortKey : internalSortKey
  const activeSortDir = controlledSort ? (sortDir ?? 'asc') : internalSortDir

  const handleSort = (col: Column<T>) => {
    if (!col.sortable) return
    const nextDir: SortDir = activeSortKey === col.key && activeSortDir === 'asc' ? 'desc' : 'asc'
    if (controlledSort) {
      onSortChange!(col.key, nextDir)
    } else {
      setInternalSortKey(col.key)
      setInternalSortDir(nextDir)
    }
  }

  // Client-side sort only when uncontrolled.
  const sortedRows = useMemo(() => {
    if (controlledSort || !internalSortKey) return rows
    const col = columns.find((c) => c.key === internalSortKey)
    if (!col) return rows
    const accessor = col.sortAccessor ?? ((row: T) => (row as Record<string, unknown>)[col.key] as never)
    const copy = [...rows]
    copy.sort((a, b) => {
      const res = compare(accessor(a), accessor(b))
      return internalSortDir === 'asc' ? res : -res
    })
    return copy
  }, [rows, columns, controlledSort, internalSortKey, internalSortDir])

  // Client-side pagination only when controlled page is absent and pageSize set.
  const clientPaginated = typeof page !== 'number' && typeof pageSize === 'number'
  const clientTotalPages = clientPaginated ? Math.max(1, Math.ceil(sortedRows.length / pageSize!)) : 1
  const currentPage = clientPaginated ? Math.min(internalPage, clientTotalPages) : page

  const visibleRows = useMemo(() => {
    if (!clientPaginated) return sortedRows
    const start = (currentPage! - 1) * pageSize!
    return sortedRows.slice(start, start + pageSize!)
  }, [sortedRows, clientPaginated, currentPage, pageSize])

  const goToPage = (next: number) => {
    if (clientPaginated) {
      setInternalPage(next)
    } else {
      onPageChange?.(next)
    }
  }

  const allSelected =
    !!selection && rows.length > 0 && rows.every((r) => selection.selectedIds.has(rowKey(r)))
  const someSelected =
    !!selection && !allSelected && rows.some((r) => selection.selectedIds.has(rowKey(r)))

  const colSpan = columns.length + (selection ? 1 : 0)
  const footerTotalPages = clientPaginated ? clientTotalPages : totalPages
  const footerPage = clientPaginated ? currentPage : page
  const showFooter = !!footerTotalPages && footerTotalPages > 1

  const SortIcon = ({ col }: { col: Column<T> }) => {
    if (!col.sortable) return null
    if (activeSortKey !== col.key)
      return (
        <ChevronsUpDown
          className={isConsole ? 'h-3.5 w-3.5 text-console-faint' : 'h-3.5 w-3.5 text-white/50'}
        />
      )
    const activeIconClass = isConsole ? 'h-3.5 w-3.5 text-console-text' : 'h-3.5 w-3.5 text-brand-600'
    return activeSortDir === 'asc' ? (
      <ChevronUp className={activeIconClass} />
    ) : (
      <ChevronDown className={activeIconClass} />
    )
  }

  const dividerClass = isConsole ? 'divide-y divide-console-raise' : 'divide-y divide-white/10'
  const checkboxClass = isConsole
    ? 'h-4 w-4 rounded accent-console-text focus:outline-none focus:ring-2 focus:ring-console-mut'
    : 'h-4 w-4 rounded border-white/10 text-brand-600 focus:ring-brand-500'

  return (
    <div
      className={
        isConsole
          ? `overflow-hidden rounded-lg bg-console-panel ${className}`
          : // The table is a surface, so it gets a FILL, not a hairline drawn
            // around it. `border border-white/10` over a 3% fill on the
            // #0a0a0a page meant only the outline read — the wireframe look
            // the owner has rejected repeatedly (see "Surfaces: a fill, not a
            // hairline around nothing" in docs/POSH_DESIGN_BRIEF.md). This now
            // matches components/organizer/ui/DataTable and ui/kit's Card
            // exactly. `shadow-soft` went with it: rgba(0,0,0,0.08) is a black
            // shadow on a black page. The rules INSIDE the table stay — a rule
            // between rows and under the header row is the meaning.
            `overflow-hidden rounded-2xl bg-white/[0.03] ${className}`
      }
    >
      {toolbar && (
        <div className={isConsole ? 'p-3 sm:p-4' : 'border-b border-white/10 p-3 sm:p-4'}>
          {toolbar}
        </div>
      )}

      {loading ? (
        <div className={dividerClass}>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              {/* Skeleton bars sit ON the 0.03 card, so they step UP the ladder
                  to the inset tone; the old 0.04 on 0.03 was invisible. */}
              <div className={`h-9 w-9 animate-pulse rounded-lg ${isConsole ? 'bg-console-raise' : 'bg-white/[0.07]'}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-3.5 w-1/3 animate-pulse rounded ${isConsole ? 'bg-console-raise' : 'bg-white/[0.07]'}`} />
                <div className={`h-3 w-1/4 animate-pulse rounded ${isConsole ? 'bg-console-raise' : 'bg-white/[0.07]'}`} />
              </div>
              <div className={`h-6 w-16 animate-pulse ${isConsole ? 'rounded bg-console-raise' : 'rounded bg-white/[0.07]'}`} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8">
          {empty ?? (
            <p className={isConsole ? 'text-center text-sm text-console-mut' : 'text-center text-sm text-white/50'}>
              No results found.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              {/* A sticky header needs an OPAQUE fill so rows don't ghost
                  through it. `bg-[#0a0a0a]` was the page colour punched into
                  the middle of the card; #141414 is the brief's surface-1 and
                  is what components/organizer/ui/DataTable already uses. */}
              <thead
                className={`${isConsole ? 'bg-console-panel' : 'bg-[#141414]'} ${stickyHeader ? 'sticky top-0 z-10' : ''}`}
              >
                <tr className={isConsole ? '' : 'border-b border-white/10'}>
                  {selection && (
                    <th className="w-12 px-4 py-3 sm:px-6">
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected
                        }}
                        onChange={selection.onToggleAll}
                        className={checkboxClass}
                      />
                    </th>
                  )}
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col)}
                      className={`${
                        isConsole
                          ? 'label-mono px-4 py-3 text-[10px] uppercase tracking-wide text-console-faint sm:px-6'
                          : 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/50 sm:px-6'
                      } ${alignClass[col.align ?? 'left']} ${
                        col.sortable
                          ? isConsole
                            ? 'cursor-pointer select-none hover:text-console-mut'
                            : 'cursor-pointer select-none hover:text-white/70'
                          : ''
                      } ${col.hideOnMobile ? '' : ''} ${col.headerClassName ?? ''}`}
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
              <tbody className={dividerClass}>
                {visibleRows.map((row) => {
                  const id = rowKey(row)
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`transition-colors ${isConsole ? 'hover:bg-console-raise' : 'hover:bg-white/[0.07]'} ${
                        onRowClick ? 'cursor-pointer' : ''
                      }`}
                    >
                      {selection && (
                        <td className="px-4 py-3 sm:px-6" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={selection.selectedIds.has(id)}
                            onChange={() => selection.onToggle(id)}
                            className={checkboxClass}
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-3 align-middle text-sm ${
                            isConsole ? 'text-console-text' : 'text-white'
                          } sm:px-6 ${alignClass[col.align ?? 'left']} ${col.cellClassName ?? ''}`}
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
          <div className={`${dividerClass} md:hidden`}>
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
                      <span
                        className={
                          isConsole
                            ? 'label-mono text-[10px] uppercase tracking-wide text-console-faint'
                            : 'text-[11px] font-semibold uppercase tracking-wide text-white/50'
                        }
                      >
                        {col.header}
                      </span>
                      <span
                        className={
                          isConsole
                            ? 'min-w-0 text-right text-sm text-console-text'
                            : 'min-w-0 text-right text-sm text-white'
                        }
                      >
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
        <div
          className={
            isConsole
              ? 'flex items-center justify-between px-4 py-3 sm:px-6'
              : 'flex items-center justify-between border-t border-white/10 px-4 py-3 sm:px-6'
          }
        >
          <p className={isConsole ? 'label-mono text-xs tabular-nums text-console-mut' : 'text-xs text-white/50'}>
            Page {footerPage} of {footerTotalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage((footerPage ?? 1) - 1)}
              disabled={(footerPage ?? 1) <= 1}
              className={
                isConsole
                  ? 'inline-flex items-center gap-1 rounded bg-console-raise px-3 py-1.5 text-sm font-medium text-console-mut transition-colors hover:text-console-text disabled:cursor-not-allowed disabled:opacity-40'
                  // An outlined box with a 3% hover on a 3% card: the border was
                  // the only thing visible, and the hover was not visible at
                  // all. It is a control sitting INSIDE the card, so it takes
                  // the inset step of the ladder and a real hover step.
                  : 'inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
              }
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage((footerPage ?? 1) + 1)}
              disabled={(footerPage ?? 1) >= (footerTotalPages ?? 1)}
              className={
                isConsole
                  ? 'inline-flex items-center gap-1 rounded bg-console-raise px-3 py-1.5 text-sm font-medium text-console-mut transition-colors hover:text-console-text disabled:cursor-not-allowed disabled:opacity-40'
                  : 'inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
              }
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
