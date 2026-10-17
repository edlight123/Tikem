'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/currency'
import { ConsolePanel, ConsoleState, consoleTone } from '@/components/admin/console'
import { useToast } from '@/components/ui/Toast'
import {
  AlertCircle,
  Building2,
  Smartphone,
  Copy,
  Eye,
  Send
} from 'lucide-react'

interface EventDisbursementInfo {
  eventId: string
  eventTitle: string
  organizerId: string
  organizerName: string
  organizerEmail: string
  startDate: Date
  endDate: Date
  daysEnded: number
  totalTicketsSold: number
  grossRevenue: number
  platformFee: number
  netRevenue: number
  currency: string
  hasPendingPayout: boolean
  hasCompletedPayout: boolean
  payoutEligible: boolean
  payoutMethod?: string
  bankInfo?: {
    accountName?: string
    accountNumber?: string
    accountNumberFull?: string
    bankName?: string
    routingNumber?: string
    swift?: string
    iban?: string
    mobileNumber?: string
    provider?: string
    mobileAccountName?: string
  }
}

interface Stats {
  eventsEndedLast7Days: number
  pendingPayouts: number
  approvedPayouts: number
  totalPendingAmount: number
}

interface Props {
  endedEvents: EventDisbursementInfo[]
  stats: Stats
}

export function AdminDisbursementDashboard({ endedEvents, stats }: Props) {
  const [selectedEvent, setSelectedEvent] = useState<EventDisbursementInfo | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [filter, setFilter] = useState<'all' | 'eligible' | 'pending' | 'completed'>('eligible')
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const { showToast } = useToast()

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      window.setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1500)
    } catch {
      // Clipboard may be blocked by browser settings; say so and show the value
      // so it can be copied by hand (no browser prompt()).
      showToast({ type: 'warning', title: 'Copy blocked', message: `Copy it manually: ${value}` })
    }
  }

  const getPayoutMethodLabel = (method?: string) => {
    if (method === 'bank_transfer') return 'Bank Transfer'
    if (method === 'mobile_money') return 'Mobile Money'
    return 'Not configured'
  }

  const hasBankDetails = (bankInfo?: EventDisbursementInfo['bankInfo']) => {
    if (!bankInfo) return false
    return Boolean(
      bankInfo.accountNumber ||
      bankInfo.accountNumberFull ||
      bankInfo.bankName ||
      bankInfo.accountName ||
      bankInfo.routingNumber ||
      bankInfo.swift ||
      bankInfo.iban
    )
  }

  const hasMobileDetails = (bankInfo?: EventDisbursementInfo['bankInfo']) => {
    if (!bankInfo) return false
    return Boolean(bankInfo.mobileNumber || bankInfo.provider || bankInfo.mobileAccountName)
  }

  const filteredEvents = endedEvents.filter(event => {
    if (filter === 'eligible') return event.payoutEligible && !event.hasPendingPayout
    if (filter === 'pending') return event.hasPendingPayout
    if (filter === 'completed') return event.hasCompletedPayout
    return true
  })

  const viewDetails = (event: EventDisbursementInfo) => {
    setSelectedEvent(event)
    setShowModal(true)
  }

  const statItems = [
    { label: 'Events Ended (7d)', value: String(stats.eventsEndedLast7Days) },
    { label: 'Pending Payouts', value: String(stats.pendingPayouts) },
    { label: 'Approved Payouts', value: String(stats.approvedPayouts) },
    { label: 'Pending Amount', value: formatCurrency(stats.totalPendingAmount, 'HTG') },
  ]

  const filterButtonClass = (active: boolean) =>
    `rounded px-3 py-1.5 text-[13px] font-semibold transition-colors ${
      active ? 'bg-console-raise text-console-text' : 'text-console-mut hover:text-console-text'
    }`

  return (
    <div className="space-y-6">
      {/* Summary figures */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
        {statItems.map((item) => (
          <div key={item.label}>
            <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{item.label}</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('all')} className={filterButtonClass(filter === 'all')}>
          All Events ({endedEvents.length})
        </button>
        <button onClick={() => setFilter('eligible')} className={filterButtonClass(filter === 'eligible')}>
          Eligible for Payout ({endedEvents.filter(e => e.payoutEligible && !e.hasPendingPayout).length})
        </button>
        <button onClick={() => setFilter('pending')} className={filterButtonClass(filter === 'pending')}>
          Pending Payout ({endedEvents.filter(e => e.hasPendingPayout).length})
        </button>
        <button onClick={() => setFilter('completed')} className={filterButtonClass(filter === 'completed')}>
          Completed ({endedEvents.filter(e => e.hasCompletedPayout).length})
        </button>
      </div>

      {/* Events Table */}
      <ConsolePanel className="overflow-hidden">
        <div className="px-4 py-3">
          <h2 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Ended Events</h2>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-console-mut">No events match the current filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-console-raise">
              <thead>
                <tr>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Event</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Organizer</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Ended</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Tickets</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">To Send</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Payment Method</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Status</th>
                  <th className="label-mono px-6 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-console-raise">
                {filteredEvents.map((event) => (
                  <tr key={event.eventId} className="hover:bg-console-raise">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-console-text">{event.eventTitle}</div>
                      <div className="font-mono text-xs tabular-nums text-console-faint">{event.eventId.substring(0, 8)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-console-text">{event.organizerName}</div>
                      <div className="text-xs text-console-mut">{event.organizerEmail}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm tabular-nums text-console-mut">
                      {event.daysEnded} day{event.daysEnded !== 1 ? 's' : ''} ago
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-medium tabular-nums text-console-text">
                      {event.totalTicketsSold}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm font-semibold tabular-nums text-console-text">
                        {formatCurrency(event.netRevenue, event.currency as any)}
                      </div>
                      <div className="font-mono text-xs tabular-nums text-console-mut">
                        Gross: {formatCurrency(event.grossRevenue, event.currency as any)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        {event.payoutMethod === 'bank_transfer' && (
                          <div className="flex items-center gap-1 text-sm text-console-mut">
                            <Building2 className="w-4 h-4" />
                            Bank Transfer
                          </div>
                        )}
                        {event.payoutMethod === 'mobile_money' && (
                          <div className="flex items-center gap-1 text-sm text-console-mut">
                            <Smartphone className="w-4 h-4" />
                            Mobile Money
                          </div>
                        )}
                        {!event.payoutMethod && (
                          <div className="flex items-center gap-1 text-sm text-console-red">
                            <AlertCircle className="w-4 h-4" />
                            Not configured
                          </div>
                        )}

                        {event.payoutMethod === 'bank_transfer' && hasBankDetails(event.bankInfo) && (
                          <div className="text-xs text-console-mut">
                            <div>{event.bankInfo?.bankName || 'Bank'}</div>
                            {event.bankInfo?.accountNumber && (
                              <div className="font-mono tabular-nums">Acct: {event.bankInfo.accountNumber}</div>
                            )}
                            {event.bankInfo?.routingNumber && (
                              <div className="font-mono tabular-nums">Routing: {event.bankInfo.routingNumber}</div>
                            )}
                          </div>
                        )}

                        {event.payoutMethod === 'mobile_money' && hasMobileDetails(event.bankInfo) && (
                          <div className="text-xs text-console-mut">
                            <div>{event.bankInfo?.provider || 'Provider'}</div>
                            {event.bankInfo?.mobileNumber && (
                              <div className="font-mono tabular-nums">{event.bankInfo.mobileNumber}</div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {event.hasCompletedPayout && (
                        <ConsoleState tone={consoleTone('paid')}>Paid</ConsoleState>
                      )}
                      {event.hasPendingPayout && !event.hasCompletedPayout && (
                        <ConsoleState tone={consoleTone('pending')}>Pending</ConsoleState>
                      )}
                      {event.payoutEligible && !event.hasPendingPayout && !event.hasCompletedPayout && (
                        <ConsoleState tone="warn">Ready</ConsoleState>
                      )}
                      {!event.payoutEligible && !event.hasPendingPayout && !event.hasCompletedPayout && (
                        <ConsoleState tone="neutral">Not Eligible</ConsoleState>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => viewDetails(event)}
                        className="mr-3 text-sm font-medium text-console-text hover:opacity-80"
                      >
                        <Eye className="w-4 h-4 inline mr-1" />
                        View
                      </button>
                      {event.payoutEligible && !event.hasPendingPayout && !event.hasCompletedPayout && (
                        <span
                          className="inline-flex cursor-not-allowed items-center gap-1 text-sm text-console-faint"
                          title="Manual payout creation isn't available yet, organizers request payouts from their dashboard"
                        >
                          <Send className="w-4 h-4" />
                          Create Payout
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsolePanel>

      {/* Details Modal */}
      {showModal && selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-console-panel p-6 shadow-xl">
            <h3 className="label-mono mb-4 text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">{selectedEvent.eventTitle}</h3>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Organizer</p>
                <p className="font-medium text-console-text">{selectedEvent.organizerName}</p>
                <p className="text-xs text-console-mut">{selectedEvent.organizerEmail}</p>
              </div>
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Event Dates</p>
                <p className="font-mono text-sm tabular-nums text-console-text">Start: {new Date(selectedEvent.startDate).toLocaleDateString()}</p>
                <p className="font-mono text-sm tabular-nums text-console-text">End: {new Date(selectedEvent.endDate).toLocaleDateString()}</p>
                <p className="font-mono text-xs tabular-nums text-console-mut">Ended {selectedEvent.daysEnded} days ago</p>
              </div>
            </div>

            <div className="mb-6 rounded-lg bg-console-ground p-4">
              <h4 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">Financial Summary</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-console-mut">Tickets Sold:</span>
                  <span className="font-mono font-medium tabular-nums text-console-text">{selectedEvent.totalTicketsSold}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-console-mut">Gross Revenue:</span>
                  <span className="font-mono font-medium tabular-nums text-console-text">{formatCurrency(selectedEvent.grossRevenue, selectedEvent.currency as any)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-console-mut">Platform Fee (5%):</span>
                  <span className="font-mono font-medium tabular-nums text-console-red">-{formatCurrency(selectedEvent.platformFee, selectedEvent.currency as any)}</span>
                </div>
                <div className="flex justify-between border-t border-console-raise pt-2">
                  <span className="font-semibold text-console-text">Amount to Send:</span>
                  <span className="font-mono font-bold tabular-nums text-console-text">{formatCurrency(selectedEvent.netRevenue, selectedEvent.currency as any)}</span>
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-lg bg-console-ground p-4">
              <h4 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Preferred Transfer</h4>
              <div className="flex items-center gap-2 text-sm">
                {selectedEvent.payoutMethod === 'bank_transfer' ? (
                  <Building2 className="w-4 h-4 text-console-mut" />
                ) : selectedEvent.payoutMethod === 'mobile_money' ? (
                  <Smartphone className="w-4 h-4 text-console-mut" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-console-red" />
                )}
                <span className={selectedEvent.payoutMethod ? 'text-console-text' : 'text-console-red'}>
                  {getPayoutMethodLabel(selectedEvent.payoutMethod)}
                </span>
              </div>
              {!selectedEvent.payoutMethod && (
                <p className="mt-2 text-xs text-console-mut">
                  This organizer has no Haiti payout method on file yet.
                </p>
              )}
            </div>

            {selectedEvent.payoutMethod === 'bank_transfer' && hasBankDetails(selectedEvent.bankInfo) && (
              <div className="mb-6 rounded-lg bg-console-ground p-4">
                <h4 className="label-mono mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
                  <><Building2 className="w-4 h-4" /> Bank Account Details</>
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-console-mut">Account Name:</span>
                    <span className="font-medium text-console-text">{selectedEvent.bankInfo?.accountName || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-console-mut">Account Number:</span>
                    {(() => {
                      const value =
                        selectedEvent.bankInfo?.accountNumberFull ||
                        selectedEvent.bankInfo?.accountNumber ||
                        ''

                      if (!value) return <span className="font-mono font-medium tabular-nums text-console-text">N/A</span>

                      return (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(value)}
                          className="font-mono font-medium tabular-nums inline-flex items-center gap-2 text-console-text hover:opacity-80"
                          title="Click to copy"
                        >
                          <span>{value}</span>
                          <Copy className="w-4 h-4" />
                          {copiedValue === value && (
                            <span className="text-xs text-console-mut">Copied</span>
                          )}
                        </button>
                      )
                    })()}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-console-mut">Bank Name:</span>
                    <span className="font-medium text-console-text">{selectedEvent.bankInfo?.bankName || 'N/A'}</span>
                  </div>
                  {selectedEvent.bankInfo?.routingNumber && (
                    <div className="flex justify-between">
                      <span className="text-console-mut">Routing Number:</span>
                      <span className="font-mono font-medium tabular-nums text-console-text">{selectedEvent.bankInfo.routingNumber}</span>
                    </div>
                  )}
                  {selectedEvent.bankInfo?.swift && (
                    <div className="flex justify-between">
                      <span className="text-console-mut">SWIFT:</span>
                      <span className="font-mono font-medium tabular-nums text-console-text">{selectedEvent.bankInfo.swift}</span>
                    </div>
                  )}
                  {selectedEvent.bankInfo?.iban && (
                    <div className="flex justify-between">
                      <span className="text-console-mut">IBAN:</span>
                      <span className="font-mono font-medium tabular-nums text-console-text">{selectedEvent.bankInfo.iban}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedEvent.payoutMethod === 'mobile_money' && hasMobileDetails(selectedEvent.bankInfo) && (
              <div className="mb-6 rounded-lg bg-console-ground p-4">
                <h4 className="label-mono mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
                  <><Smartphone className="w-4 h-4" /> Mobile Money Details</>
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-console-mut">Mobile Number:</span>
                    <span className="font-mono font-medium tabular-nums text-console-text">{selectedEvent.bankInfo?.mobileNumber || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-console-mut">Provider:</span>
                    <span className="font-medium text-console-text">{selectedEvent.bankInfo?.provider || 'N/A'}</span>
                  </div>
                  {selectedEvent.bankInfo?.mobileAccountName && (
                    <div className="flex justify-between">
                      <span className="text-console-mut">Account Name:</span>
                      <span className="font-medium text-console-text">{selectedEvent.bankInfo.mobileAccountName}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 rounded bg-console-raise px-4 py-2 text-[13px] font-semibold text-console-mut transition-colors hover:text-console-text"
              >
                Close
              </button>
              {selectedEvent.payoutEligible && !selectedEvent.hasPendingPayout && (
                <button
                  type="button"
                  disabled
                  title="Manual payout creation isn't available yet, organizers request payouts from their dashboard"
                  className="flex-1 cursor-not-allowed rounded bg-console-raise px-4 py-2 text-[13px] font-semibold text-console-faint opacity-50"
                >
                  Create Payout (coming soon)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
