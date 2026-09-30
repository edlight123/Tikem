'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatCurrency } from '@/lib/fees'
import { formatAge } from '@/lib/admin/age'
import {
  ConsoleButton,
  ConsolePanel,
  ConsoleState,
  consoleAgeClass,
  consoleTone,
  useConsoleNow,
} from '@/components/admin/console'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useToast } from '@/components/ui/Toast'
import { PAYEE_REASON_CODES, PAYEE_REASON_LABELS, type PayeeReasonCode } from '@/lib/payouts/payee-reasons'

interface Withdrawal {
  id: string
  organizerId: string
  eventId: string
  amount: number
  method: 'moncash' | 'bank'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  moncashNumber?: string
  bankDetails?: {
    accountNumber: string
    bankName: string
    accountHolder: string
    swiftCode?: string
    routingNumber?: string
  }
  createdAt: string
  processedAt?: string
  completedAt?: string
  failureReason?: string
  prefundingUsed?: boolean
  needsReconciliation?: boolean
  reconciliationReason?: string
  reconciliationStatusCheck?: string
  moncashTransactionId?: string
  adminNote?: string
  completionNote?: string
  payeeReasonCode?: string | null
  payeeReasonText?: string | null
  event: {
    id: string
    title: string
    date: string
  } | null
  organizer: {
    id: string
    name: string
    email: string
  } | null
}

const TIMESTAMP_FIELDS = ['createdAt', 'requestedAt', 'created_at', 'updatedAt'] as const

/**
 * Withdrawal rows reach this page from a few different writers, so the request
 * timestamp is not reliably under one key. Try each known spelling and take the
 * first that actually parses; formatAge renders '—' when none do.
 */
function requestedTimestamp(withdrawal: Withdrawal): string | null {
  const record = withdrawal as unknown as Record<string, unknown>
  for (const field of TIMESTAMP_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) return value
  }
  return null
}

interface WithdrawalsViewProps {
  embedded?: boolean
  showHeader?: boolean
}

export default function WithdrawalsView({ embedded = false, showHeader = true }: WithdrawalsViewProps) {
  const confirmDialog = useConfirm()
  const { showToast } = useToast()
  const now = useConsoleNow()
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('pending')
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<Withdrawal | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [payeeReasonCode, setPayeeReasonCode] = useState<PayeeReasonCode | ''>('')
  const [payeeReasonText, setPayeeReasonText] = useState('')
  const resetActionFields = () => {
    setActionNote('')
    setPayeeReasonCode('')
    setPayeeReasonText('')
  }
  const [processing, setProcessing] = useState(false)

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch('/api/admin/withdrawals?status=all&limit=200')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setLoadError(data.error || `Failed to load withdrawals (${response.status})`)
        setWithdrawals([])
        return
      }
      setWithdrawals(data.withdrawals || [])
    } catch (error) {
      console.error('Failed to fetch withdrawals:', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load withdrawals')
      setWithdrawals([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWithdrawals()
  }, [fetchWithdrawals])

  const visibleWithdrawals = filter === 'all'
    ? withdrawals
    : withdrawals.filter(w => w.status === filter)

  const handleAction = async (withdrawalId: string, action: 'approve' | 'reject' | 'complete' | 'fail') => {
    const isDestructive = action === 'reject' || action === 'fail'
    // The payee is told why; that message must be chosen deliberately, never
    // taken from the internal note.
    if (isDestructive && (!payeeReasonCode || (payeeReasonCode === 'other' && !payeeReasonText.trim()))) {
      showToast({
        type: 'error',
        title: 'Reason required',
        message: 'Choose the reason the payee will see (or write it under “Other”).',
      })
      return
    }
    const ok = await confirmDialog({
      title: `${action.charAt(0).toUpperCase() + action.slice(1)} this withdrawal?`,
      description: 'This updates the withdrawal status and may trigger a payout. Please confirm the details are correct.',
      confirmLabel: action.charAt(0).toUpperCase() + action.slice(1),
      variant: isDestructive ? 'danger' : 'default',
    })
    if (!ok) return

    setProcessing(true)
    try {
      const response = await fetch(`/api/admin/withdrawals/${withdrawalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          withdrawalId,
          action,
          internalNote: actionNote,
          ...(isDestructive ? { payeeReasonCode, payeeReasonText } : {}),
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} withdrawal`)
      }

      showToast({
        type: 'success',
        title: 'Withdrawal updated',
        message: `Withdrawal ${action}d successfully`,
      })
      setSelectedWithdrawal(null)
      resetActionFields()
      fetchWithdrawals()
    } catch (error: any) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: error.message,
      })
    } finally {
      setProcessing(false)
    }
  }

  const getStatusBadge = (status: string) => {
    if (!['completed', 'processing', 'pending', 'failed'].includes(status)) return null
    return (
      <ConsoleState tone={consoleTone(status)}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </ConsoleState>
    )
  }

  const getMethodIcon = (method: string) => {
    return method === 'moncash' ? '📱' : '🏦'
  }

  const containerClassName = embedded
    ? ''
    : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6'

  return (
    <div className={containerClassName}>
      {showHeader && (
        <header className="mb-5">
          <h1 className="label-mono text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">
            Withdrawals
          </h1>
          <p className="mt-1 text-[13px] text-console-mut">Review and process organizer withdrawal requests</p>
        </header>
      )}

      {/* Filter Tabs */}
      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2">
        {['pending', 'processing', 'completed', 'failed', 'all'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab as any)}
            className={`label-mono border-b-2 pb-1.5 text-[11px] uppercase tracking-[0.14em] transition-colors ${
              filter === tab
                ? 'border-console-text text-console-text'
                : 'border-transparent text-console-mut hover:text-console-text'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className="ml-2 tabular-nums">
              ({tab === 'all' ? withdrawals.length : withdrawals.filter(w => w.status === tab).length})
            </span>
          </button>
        ))}
      </div>

      {/* Withdrawals List */}
      {loading ? (
        <ConsolePanel className="p-12 text-center">
          <div className="text-console-mut">Loading...</div>
        </ConsolePanel>
      ) : loadError ? (
        <ConsolePanel className="p-12 text-center">
          <p className="mb-4 text-sm text-console-red">{loadError}</p>
          <ConsoleButton onClick={() => void fetchWithdrawals()}>
            Retry
          </ConsoleButton>
        </ConsolePanel>
      ) : visibleWithdrawals.length === 0 ? (
        <ConsolePanel className="p-12 text-center">
          <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">No Withdrawals</p>
          <p className="mt-1 text-[13px] text-console-faint">No {filter !== 'all' ? filter : ''} withdrawal requests found</p>
        </ConsolePanel>
      ) : (
        <ConsolePanel className="overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-console-ground">
                <tr>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Organizer</th>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Event</th>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Amount</th>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Method</th>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Status</th>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Date</th>
                  <th className="label-mono px-4 py-3 text-right text-[10px] uppercase tracking-[0.14em] text-console-faint">Waiting</th>
                  <th className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-console-faint">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-console-ground">
                {visibleWithdrawals.map((withdrawal) => (
                  <tr key={withdrawal.id} className="hover:bg-console-raise">
                    <td className="px-4 py-4">
                      <div>
                        <div className="font-medium text-console-text">{withdrawal.organizer?.name || 'Unknown'}</div>
                        <div className="text-sm text-console-mut">{withdrawal.organizer?.email}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-console-text">{withdrawal.event?.title || 'Unknown Event'}</div>
                      <div className="font-mono text-sm tabular-nums text-console-mut">
                        {withdrawal.event?.date ? new Date(withdrawal.event.date).toLocaleDateString() : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-mono font-bold tabular-nums text-console-text">{formatCurrency(withdrawal.amount)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span>{getMethodIcon(withdrawal.method)}</span>
                        <span className="text-sm font-medium text-console-mut">
                          {withdrawal.method === 'moncash' ? 'MonCash' : 'Bank'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">{getStatusBadge(withdrawal.status)}</td>
                    <td className="px-4 py-4">
                      <div className="font-mono text-sm tabular-nums text-console-mut">
                        {new Date(withdrawal.createdAt).toLocaleDateString()}
                      </div>
                      <div className="font-mono text-xs tabular-nums text-console-faint">
                        {new Date(withdrawal.createdAt).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span
                        className={`label-mono text-[13px] tabular-nums ${
                          now ? consoleAgeClass(requestedTimestamp(withdrawal), now) : 'text-console-faint'
                        }`}
                      >
                        {now ? formatAge(requestedTimestamp(withdrawal), now) : '·'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => setSelectedWithdrawal(withdrawal)}
                        className="text-sm font-medium text-console-mut hover:text-console-text"
                      >
                        View Details →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-console-ground">
            {visibleWithdrawals.map((withdrawal) => (
              <div
                key={withdrawal.id}
                className="p-4 hover:bg-console-raise cursor-pointer"
                onClick={() => setSelectedWithdrawal(withdrawal)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-medium text-console-text">{withdrawal.organizer?.name || 'Unknown'}</div>
                    <div className="text-sm text-console-mut">{withdrawal.event?.title}</div>
                  </div>
                  {getStatusBadge(withdrawal.status)}
                </div>
                <div className="flex justify-between items-center">
                  <div className="font-mono font-bold tabular-nums text-console-text">{formatCurrency(withdrawal.amount)}</div>
                  <div className="text-sm text-console-mut">
                    {getMethodIcon(withdrawal.method)} {withdrawal.method === 'moncash' ? 'MonCash' : 'Bank'}
                  </div>
                </div>
                <div className="font-mono text-xs tabular-nums text-console-faint mt-2">
                  {new Date(withdrawal.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </ConsolePanel>
      )}

      {/* Detail Modal */}
      {selectedWithdrawal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-console-panel shadow-xl rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start mb-6">
              <h2 className="label-mono text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">
                Withdrawal Details
              </h2>
              <button
                onClick={() => {
                  setSelectedWithdrawal(null)
                  resetActionFields()
                }}
                className="text-console-mut hover:text-console-text text-2xl"
              >
                ×
              </button>
            </div>

            {/* Status & Amount */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="rounded-lg bg-console-ground p-4">
                <div className="text-sm text-console-mut mb-1">Status</div>
                <div>{getStatusBadge(selectedWithdrawal.status)}</div>
              </div>
              <div className="rounded-lg bg-console-ground p-4">
                <div className="label-mono text-sm text-console-mut mb-1">Amount</div>
                <div className="font-mono text-2xl font-bold tabular-nums text-console-text">{formatCurrency(selectedWithdrawal.amount)}</div>
              </div>
            </div>

            {/* Organizer Info */}
            <div className="mb-6">
              <h3 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">Organizer</h3>
              <div className="rounded-lg bg-console-ground p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-console-mut">Name:</span>
                  <span className="font-medium text-console-text">{selectedWithdrawal.organizer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-console-mut">Email:</span>
                  <span className="font-medium text-console-text">{selectedWithdrawal.organizer?.email}</span>
                </div>
              </div>
            </div>

            {/* Event Info */}
            <div className="mb-6">
              <h3 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">Event</h3>
              <div className="rounded-lg bg-console-ground p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-console-mut">Title:</span>
                  <span className="font-medium text-console-text">{selectedWithdrawal.event?.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-console-mut">Date:</span>
                  <span className="font-mono font-medium tabular-nums text-console-text">
                    {selectedWithdrawal.event?.date ? new Date(selectedWithdrawal.event.date).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Details */}
            <div className="mb-6">
              <h3 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">
                Payment Method
              </h3>
              <div className="rounded-lg bg-console-ground p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-console-mut">Method:</span>
                  <span className="font-medium text-console-text">
                    {selectedWithdrawal.method === 'moncash' ? 'MonCash' : 'Bank Transfer'}
                  </span>
                </div>
                {selectedWithdrawal.method === 'moncash' && selectedWithdrawal.moncashNumber && (
                  <div className="flex justify-between">
                    <span className="text-console-mut">Phone:</span>
                    <span className="font-mono font-medium tabular-nums text-console-text">{selectedWithdrawal.moncashNumber}</span>
                  </div>
                )}
                {selectedWithdrawal.method === 'bank' && selectedWithdrawal.bankDetails && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-console-mut">Account Holder:</span>
                      <span className="font-medium text-console-text">{selectedWithdrawal.bankDetails.accountHolder}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-console-mut">Bank:</span>
                      <span className="font-medium text-console-text">{selectedWithdrawal.bankDetails.bankName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-console-mut">Account #:</span>
                      <span className="font-mono font-medium tabular-nums text-console-text">{selectedWithdrawal.bankDetails.accountNumber}</span>
                    </div>
                    {selectedWithdrawal.bankDetails.routingNumber && (
                      <div className="flex justify-between">
                        <span className="text-console-mut">Routing:</span>
                        <span className="font-mono font-medium tabular-nums text-console-text">{selectedWithdrawal.bankDetails.routingNumber}</span>
                      </div>
                    )}
                    {selectedWithdrawal.bankDetails.swiftCode && (
                      <div className="flex justify-between">
                        <span className="text-console-mut">SWIFT:</span>
                        <span className="font-mono font-medium tabular-nums text-console-text">{selectedWithdrawal.bankDetails.swiftCode}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Timestamps */}
            <div className="mb-6">
              <h3 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">Timeline</h3>
              <div className="rounded-lg bg-console-ground p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-console-mut">Requested:</span>
                  <span className="font-mono font-medium tabular-nums text-console-text">
                    {new Date(selectedWithdrawal.createdAt).toLocaleString()}
                  </span>
                </div>
                {selectedWithdrawal.processedAt && (
                  <div className="flex justify-between">
                    <span className="text-console-mut">Processed:</span>
                    <span className="font-mono font-medium tabular-nums text-console-text">
                      {new Date(selectedWithdrawal.processedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {selectedWithdrawal.completedAt && (
                  <div className="flex justify-between">
                    <span className="text-console-mut">Completed:</span>
                    <span className="font-mono font-medium tabular-nums text-console-text">
                      {new Date(selectedWithdrawal.completedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Instant (prefunded) transfer whose outcome is unknown */}
            {selectedWithdrawal.needsReconciliation && (
              <div className="mb-6 rounded-lg bg-console-ground p-4">
                <div className="font-bold text-console-red mb-1">Needs reconciliation — do not fail blindly</div>
                <div className="text-sm text-console-mut">
                  An instant MonCash transfer was sent (reference <span className="font-mono">{selectedWithdrawal.id}</span>) but its outcome
                  is unknown, so the organizer&apos;s balance is still reserved. Check this reference in the MonCash
                  prefunded portal (or POST /api/admin/moncash-prefunded/status). If it was paid, Complete it; only
                  Fail it (which restores the balance) if MonCash confirms no money moved.
                </div>
                {selectedWithdrawal.reconciliationReason && (
                  <div className="mt-2 text-xs font-mono text-console-mut">Error: {selectedWithdrawal.reconciliationReason}</div>
                )}
                {selectedWithdrawal.reconciliationStatusCheck && (
                  <div className="mt-1 text-xs font-mono text-console-mut">Status check: {selectedWithdrawal.reconciliationStatusCheck}</div>
                )}
              </div>
            )}

            {/* Failure Reason */}
            {selectedWithdrawal.failureReason && (
              <div className="mb-6 rounded-lg bg-console-ground p-4">
                <div className="font-bold text-console-red mb-1">Reason (shown to the payee)</div>
                <div className="text-console-red">{selectedWithdrawal.failureReason}</div>
              </div>
            )}

            {/* Payee-facing reason vs internal note — kept strictly apart */}
            {selectedWithdrawal.status === 'pending' || selectedWithdrawal.status === 'processing' ? (
              <div className="mb-6 space-y-4">
                <div className="rounded-lg bg-console-ground p-4">
                  <label className="block text-sm font-medium text-console-text mb-1">
                    Reason shown to the payee
                  </label>
                  <p className="text-xs text-console-mut mb-3">
                    Required to {selectedWithdrawal.status === 'pending' ? 'reject' : 'mark failed'}. Sent in their notification and email, translated for presets.
                  </p>
                  <select
                    value={payeeReasonCode}
                    onChange={(e) => setPayeeReasonCode(e.target.value as PayeeReasonCode | '')}
                    className="w-full rounded bg-console-panel px-4 py-2 text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut"
                  >
                    <option value="">Choose a reason…</option>
                    {PAYEE_REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {PAYEE_REASON_LABELS[code]}
                      </option>
                    ))}
                  </select>
                  {payeeReasonCode === 'other' && (
                    <textarea
                      value={payeeReasonText}
                      onChange={(e) => setPayeeReasonText(e.target.value)}
                      placeholder="Written exactly as the payee will read it"
                      maxLength={500}
                      className="mt-3 w-full rounded bg-console-panel px-4 py-2 text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                      rows={2}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-console-mut mb-2">
                    Internal note — admins only (optional)
                  </label>
                  <textarea
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Never shown to the payee"
                    className="w-full rounded bg-console-ground px-4 py-2 text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                    rows={3}
                  />
                </div>
              </div>
            ) : null}

            {/* Past internal notes */}
            {(selectedWithdrawal.adminNote || selectedWithdrawal.completionNote) && (
              <div className="mb-6 rounded-lg bg-console-ground p-4 text-sm">
                <div className="font-bold text-console-mut mb-1">Internal note (admins only)</div>
                <div className="text-console-text whitespace-pre-wrap">
                  {[selectedWithdrawal.adminNote, selectedWithdrawal.completionNote].filter(Boolean).join('\n')}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              {selectedWithdrawal.status === 'pending' && (
                <>
                  <ConsoleButton
                    variant="primary"
                    onClick={() => handleAction(selectedWithdrawal.id, 'approve')}
                    disabled={processing}
                    className="flex-1"
                  >
                    ✓ Approve & Process
                  </ConsoleButton>
                  <ConsoleButton
                    variant="danger"
                    onClick={() => handleAction(selectedWithdrawal.id, 'reject')}
                    disabled={processing}
                    className="flex-1"
                  >
                    ✗ Reject
                  </ConsoleButton>
                </>
              )}
              {selectedWithdrawal.status === 'processing' && (
                <>
                  <ConsoleButton
                    variant="primary"
                    onClick={() => handleAction(selectedWithdrawal.id, 'complete')}
                    disabled={processing}
                    className="flex-1"
                  >
                    ✓ Mark Complete
                  </ConsoleButton>
                  <ConsoleButton
                    variant="danger"
                    onClick={() => handleAction(selectedWithdrawal.id, 'fail')}
                    disabled={processing}
                    className="flex-1"
                  >
                    ✗ Mark Failed
                  </ConsoleButton>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
