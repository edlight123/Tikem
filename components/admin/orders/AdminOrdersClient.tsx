'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { formatCurrency, type Currency } from '@/lib/currency'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConsoleButton, ConsoleState, consoleTone } from '@/components/admin/console'
import {
  Search,
  Filter,
  Download,
  X,
  CreditCard,
  Smartphone,
  RefreshCw,
  Eye,
  ExternalLink,
  User,
  Mail,
  Ticket,
  QrCode,
} from 'lucide-react'
import { toCsv } from '@/lib/csv'

interface Order {
  id: string
  event_id?: string
  eventId?: string
  event_name?: string
  attendee_email?: string
  attendeeEmail?: string
  email?: string
  attendee_name?: string
  attendeeName?: string
  status?: string
  price_paid?: number
  pricePaid?: number
  currency?: string
  payment_method?: string
  paymentMethod?: string
  ticket_type?: string
  ticketType?: string
  purchased_at?: string
  purchasedAt?: string
  checked_in?: boolean
  checkedIn?: boolean
  qr_code?: string
  qrCode?: string
}

interface OrdersSummary {
  totalOrders: number
  todayOrders: number
  byStatus: {
    confirmed: number
    pending: number
    cancelled: number
    refunded: number
  }
  last30Days: {
    orders: number
    revenueUSD: number
    revenueHTG: number
    avgOrderValueUSD: number
  }
  byPaymentMethod: {
    stripe: number
    moncash: number
    natcash: number
  }
}

interface Pagination {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasMore: boolean
}

interface Filters {
  status: string
  paymentMethod: string
  currency: string
  dateRange: string
  startDate: string
  endDate: string
  sortBy: string
  search: string
}

const initialFilters: Filters = {
  status: 'all',
  paymentMethod: 'all',
  currency: 'all',
  dateRange: 'all',
  startDate: '',
  endDate: '',
  sortBy: 'newest',
  search: '',
}

/** Status is always a dot + label in the console — never a filled pill. */
function StatusBadge({ status }: { status: string }) {
  return <ConsoleState tone={consoleTone(status)}>{status || 'Unknown'}</ConsoleState>
}

/** Payment method is a category, not a status — a mono label, no color coding. */
function PaymentMethodBadge({ method }: { method: string }) {
  const methodLower = (method || '').toLowerCase()
  if (methodLower === 'stripe') {
    return (
      <span className="label-mono inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-console-mut">
        <CreditCard className="w-3 h-3" />
        Stripe
      </span>
    )
  }
  if (methodLower === 'moncash') {
    return (
      <span className="label-mono inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-console-mut">
        <Smartphone className="w-3 h-3" />
        MonCash
      </span>
    )
  }
  if (methodLower === 'natcash') {
    return (
      <span className="label-mono inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-console-mut">
        <Smartphone className="w-3 h-3" />
        NatCash
      </span>
    )
  }
  return (
    <span className="label-mono inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-console-mut">
      {method || 'Unknown'}
    </span>
  )
}

export function AdminOrdersClient() {
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<OrdersSummary | null>(null)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 50,
    totalCount: 0,
    totalPages: 0,
    hasMore: false,
  })
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [exporting, setExporting] = useState(false)

  const fetchOrders = useCallback(async (page: number = 1) => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pagination.pageSize.toString(),
        sortBy: filters.sortBy,
      })

      if (filters.status !== 'all') params.set('status', filters.status)
      if (filters.paymentMethod !== 'all') params.set('paymentMethod', filters.paymentMethod)
      if (filters.currency !== 'all') params.set('currency', filters.currency)
      if (filters.search) params.set('search', filters.search)
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)

      const res = await fetch(`/api/admin/orders?${params}`)
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.ok) {
        setOrders(data.orders)
        setPagination(data.pagination)
      } else {
        setLoadError(data.error || `Failed to load orders (${res.status})`)
        setOrders([])
      }
    } catch (e) {
      console.error('Failed to fetch orders:', e)
      setLoadError(e instanceof Error ? e.message : 'Failed to load orders')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [filters, pagination.pageSize])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'summary' }),
      })
      const data = await res.json()
      if (data.ok) {
        setSummary(data.summary)
      }
    } catch (e) {
      console.error('Failed to fetch summary:', e)
    }
  }, [])

  useEffect(() => {
    fetchOrders(1)
    fetchSummary()
  }, [fetchOrders, fetchSummary])

  useEffect(() => {
    fetchOrders(1)
  }, [fetchOrders])

  const handleSearch = () => {
    fetchOrders(1)
  }

  const handleDateRangeChange = (range: string) => {
    const now = new Date()
    let start = ''
    let end = now.toISOString().split('T')[0]

    if (range === 'today') {
      start = end
    } else if (range === 'week') {
      const weekAgo = new Date(now.setDate(now.getDate() - 7))
      start = weekAgo.toISOString().split('T')[0]
    } else if (range === 'month') {
      const monthAgo = new Date(now.setMonth(now.getMonth() - 1))
      start = monthAgo.toISOString().split('T')[0]
    } else if (range === 'quarter') {
      const quarterAgo = new Date(now.setMonth(now.getMonth() - 3))
      start = quarterAgo.toISOString().split('T')[0]
    } else {
      start = ''
      end = ''
    }

    setFilters(prev => ({
      ...prev,
      dateRange: range,
      startDate: start,
      endDate: end,
    }))
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      // Fetch all orders matching current filters (up to 1000)
      const params = new URLSearchParams({
        page: '1',
        pageSize: '1000',
        sortBy: filters.sortBy,
      })

      if (filters.status !== 'all') params.set('status', filters.status)
      if (filters.paymentMethod !== 'all') params.set('paymentMethod', filters.paymentMethod)
      if (filters.currency !== 'all') params.set('currency', filters.currency)
      if (filters.search) params.set('search', filters.search)
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)

      const res = await fetch(`/api/admin/orders?${params}`)
      const data = await res.json()

      if (data.ok && data.orders.length > 0) {
        // Create CSV
        const headers = ['Order ID', 'Event', 'Attendee Email', 'Attendee Name', 'Status', 'Amount', 'Currency', 'Payment Method', 'Ticket Type', 'Checked In', 'Purchase Date']
        const rows = data.orders.map((o: Order) => [
          o.id,
          o.event_name || '',
          o.attendee_email || o.attendeeEmail || o.email || '',
          o.attendee_name || o.attendeeName || '',
          o.status || '',
          o.price_paid || o.pricePaid || 0,
          o.currency || 'USD',
          o.payment_method || o.paymentMethod || '',
          o.ticket_type || o.ticketType || '',
          (o.checked_in || o.checkedIn) ? 'Yes' : 'No',
          o.purchased_at || o.purchasedAt || '',
        ])

        const csvContent = toCsv([headers, ...rows])

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `orders-export-${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setExporting(false)
    }
  }

  const resetFilters = () => {
    setFilters(initialFilters)
  }

  const activeFiltersCount = [
    filters.status !== 'all',
    filters.paymentMethod !== 'all',
    filters.currency !== 'all',
    filters.dateRange !== 'all',
  ].filter(Boolean).length

  const columns: Column<Order>[] = [
    {
      key: 'order',
      header: 'Order',
      render: (order) => {
        const ticketType = order.ticket_type || order.ticketType || 'General'
        return (
          <div>
            <div className="font-mono text-sm font-medium tabular-nums text-console-text">{order.id.slice(0, 8)}…</div>
            <div className="text-xs text-console-mut">{ticketType}</div>
          </div>
        )
      },
    },
    {
      key: 'event',
      header: 'Event',
      render: (order) => {
        const eventId = order.event_id || order.eventId || ''
        return (
          <div>
            <div className="text-sm text-console-text max-w-[200px] truncate">{order.event_name || 'Unknown'}</div>
            {eventId && (
              <Link
                href={`/admin/events?selected=${eventId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-console-mut hover:text-console-text"
              >
                View Event
              </Link>
            )}
          </div>
        )
      },
    },
    {
      key: 'attendee',
      header: 'Attendee',
      render: (order) => {
        const email = order.attendee_email || order.attendeeEmail || order.email || ''
        const name = order.attendee_name || order.attendeeName || ''
        return (
          <div>
            <div className="text-sm text-console-text">{name || 'N/A'}</div>
            <div className="text-xs text-console-mut truncate max-w-[180px]">{email}</div>
          </div>
        )
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (order) => {
        const price = order.price_paid || order.pricePaid || 0
        const currency = order.currency || 'USD'
        return (
          <div className="font-mono text-sm font-medium tabular-nums text-console-text">
            {formatCurrency(price, currency as Currency)}
          </div>
        )
      },
    },
    {
      key: 'payment',
      header: 'Payment',
      render: (order) => <PaymentMethodBadge method={order.payment_method || order.paymentMethod || ''} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => <StatusBadge status={order.status || ''} />,
    },
    {
      key: 'date',
      header: 'Date',
      render: (order) => {
        const purchasedAt = order.purchased_at || order.purchasedAt || ''
        return (
          <div>
            <div className="font-mono text-sm tabular-nums text-console-text">
              {purchasedAt ? new Date(purchasedAt).toLocaleDateString() : '-'}
            </div>
            <div className="font-mono text-xs tabular-nums text-console-mut">
              {purchasedAt ? new Date(purchasedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </div>
          </div>
        )
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (order) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setSelectedOrder(order)
          }}
          className="p-1.5 text-console-faint hover:text-console-text transition-colors"
          title="View Details"
        >
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ]

  const renderOrderMobileCard = (order: Order) => {
    const email = order.attendee_email || order.attendeeEmail || order.email || ''
    const name = order.attendee_name || order.attendeeName || ''
    const price = order.price_paid || order.pricePaid || 0
    const currency = order.currency || 'USD'
    const paymentMethod = order.payment_method || order.paymentMethod || ''
    const purchasedAt = order.purchased_at || order.purchasedAt || ''

    return (
      <div className="p-4" onClick={() => setSelectedOrder(order)}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="font-mono text-sm font-medium tabular-nums text-console-text">Order {order.id.slice(0, 8)}…</div>
            <div className="text-xs text-console-mut truncate max-w-[200px]">{order.event_name}</div>
          </div>
          <StatusBadge status={order.status || ''} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="text-console-mut">{name || email || 'Unknown'}</div>
          <div className="font-mono font-medium tabular-nums text-console-text">{formatCurrency(price, currency as Currency)}</div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <PaymentMethodBadge method={paymentMethod} />
          <div className="font-mono text-xs tabular-nums text-console-mut">
            {purchasedAt ? new Date(purchasedAt).toLocaleDateString() : '-'}
          </div>
        </div>
      </div>
    )
  }

  const ordersToolbar = (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Orders</h2>
        <p className="font-mono text-xs tabular-nums text-console-mut">
          {pagination.totalCount.toLocaleString()} total orders
          {filters.search && ` • Filtered`}
        </p>
      </div>
      <button
        onClick={() => fetchOrders(pagination.page)}
        className="p-2 text-console-mut hover:text-console-text transition-colors"
        title="Refresh"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Summary — plain figures, not boxed */}
      {summary && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
          <div>
            <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Total Orders</div>
            <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{summary.totalOrders.toLocaleString()}</div>
            <div className="mt-1 font-mono text-xs tabular-nums text-console-mut">Today: {summary.todayOrders}</div>
          </div>
          <div>
            <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Revenue (30d)</div>
            <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{formatCurrency(summary.last30Days.revenueUSD, 'USD')}</div>
            <div className="mt-1 font-mono text-xs tabular-nums text-console-mut">{formatCurrency(summary.last30Days.revenueHTG, 'HTG')}</div>
          </div>
          <div>
            <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Avg Order Value</div>
            <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{formatCurrency(summary.last30Days.avgOrderValueUSD, 'USD')}</div>
            <div className="mt-1 font-mono text-xs tabular-nums text-console-mut">{summary.last30Days.orders} orders (30d)</div>
          </div>
          <div>
            <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Confirmed</div>
            <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{summary.byStatus.confirmed.toLocaleString()}</div>
            <div className="mt-1 font-mono text-xs tabular-nums text-console-mut">{summary.byStatus.pending} pending • {summary.byStatus.refunded} refunded</div>
          </div>
        </div>
      )}

      {/* Search and Filter Bar */}
      <div className="rounded-lg bg-console-panel p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-console-faint" />
            <input
              type="text"
              placeholder="Search by email, name, or order ID..."
              value={filters.search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-4 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
            />
          </div>

          {/* Quick Date Filters */}
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'all', label: 'All Time' },
              { value: 'today', label: 'Today' },
              { value: 'week', label: '7 Days' },
              { value: 'month', label: '30 Days' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => handleDateRangeChange(option.value)}
                className={`px-3 py-2 rounded text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut ${
                  filters.dateRange === option.value
                    ? 'bg-console-raise text-console-text'
                    : 'text-console-mut hover:text-console-text'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Filter Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut ${
              showFilters || activeFiltersCount > 0
                ? 'bg-console-raise text-console-text'
                : 'text-console-mut hover:text-console-text'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFiltersCount > 0 && (
              <span className="font-mono text-xs tabular-nums text-console-text">{activeFiltersCount}</span>
            )}
          </button>

          {/* Export Button */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-console-raise text-sm font-medium text-console-mut hover:text-console-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>

        {/* Extended Filters Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-console-raise grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Status Filter */}
            <div>
              <label className="label-mono block text-[10px] uppercase tracking-wide text-console-faint mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="all">All Statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>

            {/* Payment Method Filter */}
            <div>
              <label className="label-mono block text-[10px] uppercase tracking-wide text-console-faint mb-1">Payment Method</label>
              <select
                value={filters.paymentMethod}
                onChange={(e) => setFilters(prev => ({ ...prev, paymentMethod: e.target.value }))}
                className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="all">All Methods</option>
                <option value="stripe">Stripe</option>
                <option value="moncash">MonCash</option>
                <option value="natcash">NatCash</option>
              </select>
            </div>

            {/* Currency Filter */}
            <div>
              <label className="label-mono block text-[10px] uppercase tracking-wide text-console-faint mb-1">Currency</label>
              <select
                value={filters.currency}
                onChange={(e) => setFilters(prev => ({ ...prev, currency: e.target.value }))}
                className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="all">All Currencies</option>
                <option value="USD">USD</option>
                <option value="HTG">HTG</option>
              </select>
            </div>

            {/* Sort By */}
            <div>
              <label className="label-mono block text-[10px] uppercase tracking-wide text-console-faint mb-1">Sort By</label>
              <select
                value={filters.sortBy}
                onChange={(e) => setFilters(prev => ({ ...prev, sortBy: e.target.value }))}
                className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest">Highest Amount</option>
                <option value="lowest">Lowest Amount</option>
              </select>
            </div>

            {/* Custom Date Range */}
            <div className="sm:col-span-2 lg:col-span-4 flex gap-4 items-end">
              <div className="flex-1">
                <label className="label-mono block text-[10px] uppercase tracking-wide text-console-faint mb-1">Start Date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value, dateRange: 'custom' }))}
                  className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                />
              </div>
              <div className="flex-1">
                <label className="label-mono block text-[10px] uppercase tracking-wide text-console-faint mb-1">End Date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value, dateRange: 'custom' }))}
                  className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                />
              </div>
              <button
                onClick={resetFilters}
                className="px-4 py-2 text-sm text-console-mut hover:text-console-text transition-colors"
              >
                Reset All
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Orders Table */}
      {loadError && !loading ? (
        <div className="rounded-lg bg-console-panel p-12 text-center">
          <p className="mb-4 text-sm text-console-red">{loadError}</p>
          <ConsoleButton type="button" variant="quiet" onClick={() => fetchOrders(pagination.page)}>
            Retry
          </ConsoleButton>
        </div>
      ) : (
      <DataTable<Order>
        columns={columns}
        rows={orders}
        rowKey={(order) => order.id}
        toolbar={ordersToolbar}
        loading={loading}
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(p) => fetchOrders(p)}
        variant="console"
        renderMobileCard={renderOrderMobileCard}
        empty={
          <div className="text-center">
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">No orders found</p>
            <p className="text-sm text-console-faint mt-1">Try adjusting your filters</p>
          </div>
        }
      />
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSelectedOrder(null)} />
          <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-console-panel shadow-xl z-50 flex flex-col overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between">
              <h3 className="label-mono text-[12px] font-bold uppercase tracking-[0.14em] text-console-text">Order Details</h3>
              <button onClick={() => setSelectedOrder(null)} className="p-1 text-console-mut hover:text-console-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Order Info */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-console-mut">
                  <Ticket className="w-4 h-4" />
                  <span>Order ID</span>
                </div>
                <div className="font-mono text-sm tabular-nums bg-console-ground text-console-text px-3 py-2 rounded break-all">
                  {selectedOrder.id}
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-console-mut">Status</span>
                <StatusBadge status={selectedOrder.status || ''} />
              </div>

              {/* Event */}
              <div className="rounded-lg bg-console-ground p-4">
                <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-2">Event</div>
                <div className="text-console-text">{selectedOrder.event_name || 'Unknown Event'}</div>
                <div className="text-xs text-console-faint mt-1">
                  Ticket Type: {selectedOrder.ticket_type || selectedOrder.ticketType || 'General'}
                </div>
                {(selectedOrder.event_id || selectedOrder.eventId) && (
                  <Link
                    href={`/events/${selectedOrder.event_id || selectedOrder.eventId}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 mt-2 text-sm text-console-mut hover:text-console-text"
                  >
                    View Event Page <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>

              {/* Attendee */}
              <div className="rounded-lg bg-console-ground p-4">
                <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-2">Attendee</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-console-faint" />
                    <span className="text-console-text">{selectedOrder.attendee_name || selectedOrder.attendeeName || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-console-faint" />
                    <span className="text-sm text-console-text break-all">
                      {selectedOrder.attendee_email || selectedOrder.attendeeEmail || selectedOrder.email || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment */}
              <div className="rounded-lg bg-console-ground p-4">
                <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-2">Payment</div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-console-mut">Amount</span>
                    <span className="font-mono text-lg font-semibold tabular-nums text-console-text">
                      {formatCurrency(
                        selectedOrder.price_paid || selectedOrder.pricePaid || 0,
                        (selectedOrder.currency || 'USD') as Currency
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-console-mut">Method</span>
                    <PaymentMethodBadge method={selectedOrder.payment_method || selectedOrder.paymentMethod || ''} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-console-mut">Date</span>
                    <span className="font-mono text-sm tabular-nums text-console-text">
                      {(selectedOrder.purchased_at || selectedOrder.purchasedAt)
                        ? new Date(selectedOrder.purchased_at || selectedOrder.purchasedAt || '').toLocaleString()
                        : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Check-in Status */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-console-ground">
                <div className="flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-console-mut" />
                  <span className="text-console-mut">Check-in Status</span>
                </div>
                {(selectedOrder.checked_in || selectedOrder.checkedIn) ? (
                  <ConsoleState tone="good">Checked In</ConsoleState>
                ) : (
                  <span className="text-console-faint">Not checked in</span>
                )}
              </div>

              {/* QR Code */}
              {(selectedOrder.qr_code || selectedOrder.qrCode) && (
                <div className="text-center">
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-2">QR Code</div>
                  <div className="inline-block p-4 rounded-lg bg-console-ground">
                    <Image
                      src={selectedOrder.qr_code ?? selectedOrder.qrCode ?? ''}
                      alt="Ticket QR Code"
                      width={128}
                      height={128}
                      className="w-32 h-32"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
