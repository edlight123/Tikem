'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { ExportButtons } from '@/components/exports/ExportButtons'
import { downloadAdminTable } from '@/lib/exports/download'
import PayoutReceiptUpload from '@/components/admin/PayoutReceiptUpload'
import { formatCurrency as formatMoney, type Currency } from '@/lib/currency'
import { ConsoleButton, ConsolePanel, ConsoleState, consoleTone } from '@/components/admin/console'

interface Payout {
  id: string
  organizerId: string
  amount: number
  status: string
  method: string
  createdAt: string
  scheduledDate: string
  ticketIds?: string[]
  periodStart?: string
  periodEnd?: string
  currency?: string
  organizer: {
    id: string
    name: string
    email: string
  }
  payoutConfig: any
}

interface AdminPayoutQueueProps {
  initialPayouts: Payout[]
}

export default function AdminPayoutQueue({ initialPayouts }: AdminPayoutQueueProps) {
  const [payouts, setPayouts] = useState(initialPayouts)
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'approve' | 'decline' | 'mark-paid'>('approve')
  const [paymentRef, setPaymentRef] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)

  // Payout amounts are stored in cents. Delegate to the shared formatter (major
  // units) so money renders consistently with the other disbursement tabs.
  const formatCurrency = (cents: number, currency: string = 'HTG') =>
    formatMoney((cents || 0) / 100, String(currency || 'HTG').toUpperCase() as Currency)

  const pendingCount = payouts.filter((p) => p.status === 'pending').length
  const approvedCount = payouts.filter((p) => p.status === 'approved').length

  const openModal = (payout: Payout, mode: 'approve' | 'decline' | 'mark-paid') => {
    setSelectedPayout(payout)
    setModalMode(mode)
    setShowModal(true)
    setError(null)
    setPaymentRef('')
    setDeclineReason('')
    setPaymentNotes('')
    setReceiptUrl(null)
  }

  const closeModal = () => {
    setShowModal(false)
    setSelectedPayout(null)
    setPaymentRef('')
    setDeclineReason('')
    setPaymentNotes('')
    setError(null)
    setReceiptUrl(null)
  }

  const handleApprove = async () => {
    if (!selectedPayout) return

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/payouts/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizerId: selectedPayout.organizerId,
          payoutId: selectedPayout.id,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to approve payout')
      }

      // Keep the payout visible in an "approved / awaiting payment" state so it
      // can still be marked paid — removing it here would lose track of money
      // that has been approved but not yet disbursed.
      setPayouts(payouts.map(p => (p.id === selectedPayout.id ? { ...p, status: 'approved' } : p)))
      closeModal()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDecline = async () => {
    if (!selectedPayout || !declineReason.trim()) {
      setError('Please provide a reason for declining')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/payouts/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizerId: selectedPayout.organizerId,
          payoutId: selectedPayout.id,
          reason: declineReason,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to decline payout')
      }

      setPayouts(payouts.filter(p => p.id !== selectedPayout.id))
      closeModal()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleMarkPaid = async () => {
    if (!selectedPayout || !paymentRef.trim()) {
      setError('Payment reference ID is required')
      return
    }

    if (!receiptUrl) {
      setError('Please upload a payment receipt before marking as paid')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/payouts/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizerId: selectedPayout.organizerId,
          payoutId: selectedPayout.id,
          paymentReferenceId: paymentRef,
          paymentMethod: selectedPayout.method,
          paymentNotes,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to mark payout as paid')
      }

      setPayouts(payouts.filter(p => p.id !== selectedPayout.id))
      closeModal()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  // The queue as Excel / PDF (rendered by /api/admin/exports/render).
  const exportQueue = (format: 'pdf' | 'xlsx') =>
    downloadAdminTable(
      format,
      {
        title: 'Payout queue',
        reportLabel: 'Disbursements',
        subtitle: [`${pendingCount} pending · ${approvedCount} awaiting payment`],
        sections: [
          {
            name: 'Payout queue',
            totals: true,
            columns: [
              { key: 'organizer', header: 'Organizer', width: 22 },
              { key: 'email', header: 'Email', width: 26 },
              { key: 'amount', header: 'Amount', kind: 'money', total: true },
              { key: 'method', header: 'Method', width: 16 },
              { key: 'status', header: 'Status', kind: 'status' },
              { key: 'requested', header: 'Requested', kind: 'date' },
              { key: 'scheduled', header: 'Scheduled', kind: 'date' },
              { key: 'tickets', header: 'Tickets', kind: 'integer' },
              { key: 'periodStart', header: 'Period from', kind: 'date', pdf: false },
              { key: 'periodEnd', header: 'Period to', kind: 'date', pdf: false },
            ],
            rows: payouts.map((p) => ({
              organizer: p.organizer.name,
              email: p.organizer.email,
              amount: { amount: p.amount / 100, currency: p.currency || 'HTG' },
              method: p.method === 'mobile_money' ? 'MonCash/NatCash' : 'Bank transfer',
              status: { label: p.status === 'approved' ? 'Awaiting payment' : p.status === 'pending' ? 'Pending' : p.status, tone: p.status === 'approved' ? 'warning' : p.status === 'pending' ? 'warning' : 'neutral' },
              requested: p.createdAt,
              scheduled: p.scheduledDate,
              tickets: p.ticketIds?.length || 0,
              periodStart: p.periodStart || null,
              periodEnd: p.periodEnd || null,
            })),
          },
        ],
      },
      'Payout queue'
    )

  return (
    <div className="space-y-4">
      {/* Summary figures */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
          <div>
            <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Pending Requests</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{pendingCount}</p>
          </div>
          <div>
            <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Awaiting Payment</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{approvedCount}</p>
          </div>
          <div>
            <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Total in Queue</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-console-text">
              {formatCurrency(payouts.reduce((sum, p) => sum + p.amount, 0))}
            </p>
          </div>
        </div>
        <ExportButtons
          variant="console"
          onExport={exportQueue}
          disabled={payouts.length === 0}
          onError={(e: any) => showToast({ type: 'error', title: 'Export failed', message: e?.message || 'Could not build the file' })}
          labels={{ pdf: 'PDF', excel: 'Excel', group: 'Export payout queue' }}
        />
      </div>

      {/* Payouts Table */}
      <ConsolePanel className="overflow-hidden">
        <div className="px-4 py-3">
          <h2 className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Payout Queue</h2>
        </div>

        {payouts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-console-mut">No payouts in the queue</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-console-raise">
              <thead>
                <tr>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Organizer</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Amount</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Method</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Tickets</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Requested</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Scheduled</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Status</th>
                  <th className="label-mono px-6 py-3 text-left text-eyebrow uppercase tracking-[0.14em] text-console-faint">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-console-raise">
                {payouts.map((payout) => (
                  <tr key={payout.id} className="hover:bg-console-raise">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-console-text">{payout.organizer.name}</div>
                      <div className="text-sm text-console-mut">{payout.organizer.email}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-medium tabular-nums text-console-text">
                      {formatCurrency(payout.amount, payout.currency)}
                    </td>
                    <td className="px-6 py-4 text-sm text-console-mut">
                      {payout.method === 'mobile_money' ? 'MonCash/Natcash' : 'Bank Transfer'}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm tabular-nums text-console-mut">
                      {payout.ticketIds?.length || 0}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm tabular-nums text-console-mut">
                      {new Date(payout.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm tabular-nums text-console-mut">
                      {new Date(payout.scheduledDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      {payout.status === 'approved' ? (
                        <ConsoleState tone={consoleTone('approved')}>Awaiting payment</ConsoleState>
                      ) : (
                        <ConsoleState tone={consoleTone('pending')}>Pending</ConsoleState>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm space-x-3">
                      {payout.status === 'pending' && (
                        <button
                          onClick={() => openModal(payout, 'approve')}
                          className="font-medium text-console-green hover:opacity-80"
                        >
                          Approve
                        </button>
                      )}
                      {payout.status === 'approved' && (
                        <button
                          onClick={() => openModal(payout, 'mark-paid')}
                          className="font-medium text-console-text hover:opacity-80"
                        >
                          Mark Paid
                        </button>
                      )}
                      <button
                        onClick={() => openModal(payout, 'decline')}
                        className="font-medium text-console-red hover:opacity-80"
                      >
                        Decline
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsolePanel>

      {/* Modal */}
      {showModal && selectedPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-scrim p-4">
          <div className="my-8 w-full max-w-2xl rounded-lg bg-console-panel p-6 shadow-xl">
            <h3 className="label-mono mb-4 text-body font-bold uppercase tracking-[0.14em] text-console-text">
              {modalMode === 'approve' && 'Approve Payout'}
              {modalMode === 'decline' && 'Decline Payout'}
              {modalMode === 'mark-paid' && 'Mark Payout as Paid'}
            </h3>

            {error && (
              <div className="mb-4 rounded-lg bg-console-ground p-3">
                <p className="text-sm text-console-red">{error}</p>
              </div>
            )}

            <div className="mb-6 space-y-3 rounded-lg bg-console-ground p-4 text-sm text-console-mut">
              <div>
                <span className="font-medium text-console-faint">Organizer:</span>{' '}
                <span className="text-console-text">{selectedPayout.organizer.name}</span>
              </div>
              <div>
                <span className="font-medium text-console-faint">Amount:</span>{' '}
                <span className="font-mono tabular-nums text-console-text">{formatCurrency(selectedPayout.amount, selectedPayout.currency)}</span>
              </div>
              <div>
                <span className="font-medium text-console-faint">Method:</span>{' '}
                <span className="text-console-text">{selectedPayout.method === 'mobile_money' ? 'MonCash/Natcash' : 'Bank Transfer'}</span>
              </div>
            </div>

            {modalMode === 'decline' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-console-mut mb-2">
                  Reason for Declining *
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                  className="w-full rounded bg-console-ground px-3 py-2 text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                  placeholder="Explain why this payout is being declined..."
                />
              </div>
            )}

            {modalMode === 'mark-paid' && (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-console-mut mb-2">
                    Payment Reference ID *
                  </label>
                  <input
                    type="text"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    className="w-full rounded bg-console-ground px-3 py-2 text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                    placeholder="Bank transaction ID or MonCash reference"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-console-mut mb-2">
                    Notes (optional)
                  </label>
                  <textarea
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded bg-console-ground px-3 py-2 text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
                    placeholder="Additional notes about this payment..."
                  />
                </div>

                {/* Receipt Upload */}
                <div className="mb-4">
                  <PayoutReceiptUpload
                    payoutId={selectedPayout.id}
                    organizerId={selectedPayout.organizerId}
                    onUploadComplete={(url) => setReceiptUrl(url)}
                  />
                </div>
              </>
            )}

            <div className="flex gap-3">
              <ConsoleButton
                onClick={closeModal}
                disabled={isProcessing}
                className="flex-1"
              >
                Cancel
              </ConsoleButton>
              <ConsoleButton
                onClick={() => {
                  if (modalMode === 'approve') handleApprove()
                  else if (modalMode === 'decline') handleDecline()
                  else handleMarkPaid()
                }}
                disabled={isProcessing}
                variant={modalMode === 'decline' ? 'danger' : 'primary'}
                className="flex-1"
              >
                {isProcessing ? 'Processing...' : modalMode === 'approve' ? 'Approve' : modalMode === 'decline' ? 'Decline' : 'Mark Paid'}
              </ConsoleButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
