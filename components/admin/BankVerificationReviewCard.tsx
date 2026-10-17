'use client'

import { useState } from 'react'
import { Check, X, FileText, CreditCard, AlertCircle, ExternalLink } from 'lucide-react'
import { ConsoleButton, ConsoleInput, ConsoleState } from '@/components/admin/console'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useToast } from '@/components/ui/Toast'

interface BankVerification {
  organizerId: string
  organizerName: string
  organizerEmail: string
  destinationId: string
  isPrimary?: boolean
  bankDetails: {
    accountName: string
    accountNumber: string
    bankName: string
    routingNumber?: string
  }
  verificationDoc: {
    type: string
    verificationType: string
    status: string
    submittedAt: string
    documentPath?: string
    documentName: string
    documentSize: number
  }
}

interface Props {
  verification: BankVerification
}

export default function BankVerificationReviewCard({ verification }: Props) {
  const confirmDialog = useConfirm()
  const { showToast } = useToast()
  const [processing, setProcessing] = useState(false)
  const [expanded, setExpanded] = useState(verification.verificationDoc.status === 'pending')
  const [isOpeningDocument, setIsOpeningDocument] = useState(false)
  // Inline rejection reason (replaces the browser prompt()).
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const openDocument = async () => {
    const path = verification.verificationDoc.documentPath
    if (!path) return

    setIsOpeningDocument(true)
    try {
      const res = await fetch(`/api/admin/verification-image?path=${encodeURIComponent(path)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to open document')
      if (!data?.url) throw new Error('Signed URL missing')

      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: e instanceof Error ? e.message : 'Failed to open document',
      })
    } finally {
      setIsOpeningDocument(false)
    }
  }

  const handleApprove = async () => {
    const ok = await confirmDialog({
      title: 'Approve this bank account verification?',
      description: `Payouts to ${verification.organizerName}'s ${verification.bankDetails.bankName} account will be enabled.`,
      confirmLabel: 'Approve',
      variant: 'default',
    })
    if (!ok) return

    setProcessing(true)
    try {
      const response = await fetch('/api/admin/approve-bank-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizerId: verification.organizerId,
          destinationId: verification.destinationId,
          decision: 'approve',
        }),
      })

      const data = await response.json().catch(() => ({} as any))
      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to approve')
      }

      showToast({
        type: 'success',
        title: 'Verification approved',
        message: 'Bank verification approved!',
      })
      window.location.reload()
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: 'Failed to approve verification',
      })
      console.error(error)
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    const reason = rejectReason.trim()
    if (!reason) return

    setProcessing(true)
    try {
      const response = await fetch('/api/admin/approve-bank-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizerId: verification.organizerId,
          destinationId: verification.destinationId,
          decision: 'reject',
          reason,
        }),
      })

      const data = await response.json().catch(() => ({} as any))
      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to reject')
      }

      showToast({
        type: 'success',
        title: 'Verification rejected',
        message: 'Bank verification rejected',
      })
      window.location.reload()
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: 'Failed to reject verification',
      })
      console.error(error)
    } finally {
      setProcessing(false)
    }
  }

  const getStatusBadge = () => {
    switch (verification.verificationDoc.status) {
      case 'verified':
        return <ConsoleState tone="good">Verified</ConsoleState>
      case 'failed':
        return <ConsoleState tone="bad">Failed</ConsoleState>
      default:
        return <ConsoleState tone="warn">Pending Review</ConsoleState>
    }
  }

  const getDocumentTypeLabel = () => {
    switch (verification.verificationDoc.verificationType) {
      case 'bank_statement':
        return 'Bank Statement'
      case 'void_check':
        return 'Voided Check'
      case 'utility_bill':
        return 'Utility Bill + Bank Letter'
      default:
        return verification.verificationDoc.verificationType
    }
  }

  return (
    <div className="bg-console-panel rounded-lg overflow-hidden">
      {/* Header - Always Visible */}
      <div
        className="p-6 cursor-pointer hover:bg-console-raise transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-bold text-console-text">{verification.organizerName}</h3>
              {getStatusBadge()}
            </div>
            <p className="text-sm text-console-mut">{verification.organizerEmail}</p>
            <p className="text-xs text-console-faint mt-1">
              Bank account: {verification.isPrimary ? 'Primary' : 'Additional'} ({verification.destinationId})
            </p>
            <p className="text-xs text-console-faint mt-1">
              Submitted {new Date(verification.verificationDoc.submittedAt).toLocaleString()}
            </p>
          </div>
          <div className="text-2xl text-console-faint">
            {expanded ? '−' : '+'}
          </div>
        </div>
      </div>

      {/* Expandable Details */}
      {expanded && (
        <div className="p-6 pt-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Bank Details Submitted */}
            <div className="bg-console-ground rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-console-mut" />
                </div>
                <div>
                  <h4 className="label-mono text-[11px] font-bold uppercase tracking-[0.14em] text-console-text">Bank Account Details</h4>
                  <p className="text-xs text-console-faint">Information provided by organizer</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                    Bank Name
                  </div>
                  <div className="text-base font-medium text-console-text">
                    {verification.bankDetails.bankName}
                  </div>
                </div>

                <div>
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                    Account Holder Name
                  </div>
                  <div className="text-base font-medium text-console-text">
                    {verification.bankDetails.accountName}
                  </div>
                </div>

                <div>
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                    Account Number
                  </div>
                  <div className="text-base font-mono font-medium text-console-text">
                    {verification.bankDetails.accountNumber}
                  </div>
                </div>

                {verification.bankDetails.routingNumber && (
                  <div>
                    <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                      Routing Number
                    </div>
                    <div className="text-base font-mono font-medium text-console-text">
                      {verification.bankDetails.routingNumber}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Proof Document */}
            <div className="bg-console-ground rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-console-mut" />
                </div>
                <div>
                  <h4 className="label-mono text-[11px] font-bold uppercase tracking-[0.14em] text-console-text">Proof Document</h4>
                  <p className="text-xs text-console-faint">Document submitted for verification</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                    Document Type
                  </div>
                  <div className="text-base font-medium text-console-text">
                    {getDocumentTypeLabel()}
                  </div>
                </div>

                <div>
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                    File Name
                  </div>
                  <div className="text-sm font-medium text-console-text break-all">
                    {verification.verificationDoc.documentName}
                  </div>
                </div>

                <div>
                  <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint mb-1">
                    File Size
                  </div>
                  <div className="text-base font-medium text-console-text">
                    {(verification.verificationDoc.documentSize / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>

                {/* In production, this would be a Firebase Storage URL */}
                <div className="pt-3">
                  <ConsoleButton
                    className="w-full flex items-center justify-center gap-2"
                    onClick={openDocument}
                    disabled={!verification.verificationDoc.documentPath || isOpeningDocument}
                  >
                    <ExternalLink className="w-4 h-4" />
                    {isOpeningDocument ? 'Opening…' : 'View Document'}
                  </ConsoleButton>
                  <p className="text-xs text-console-faint text-center mt-2">
                    {verification.verificationDoc.documentPath
                      ? 'Opens a secure, time-limited link to the uploaded proof.'
                      : 'Document unavailable (older submission)'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Instructions */}
          <div className="mt-6 p-4 bg-console-ground rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-console-amber flex-shrink-0 mt-0.5" />
              <div className="text-sm text-console-amber">
                <p className="font-semibold mb-2">Review Checklist:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Bank name matches between form and document</li>
                  <li>Account holder name matches (or is similar)</li>
                  <li>Account number visible in document and matches</li>
                  <li>Document is recent (less than 3 months old)</li>
                  <li>Document appears authentic (not edited/fake)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Actions */}
          {verification.verificationDoc.status === 'pending' && rejecting && (
            <div className="mt-6 space-y-3">
              <label htmlFor={`reject-reason-${verification.destinationId}`} className="block text-[13px] text-console-mut">
                Reason for rejection (will be sent to organizer)
              </label>
              <ConsoleInput
                id={`reject-reason-${verification.destinationId}`}
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && rejectReason.trim()) handleReject()
                  if (e.key === 'Escape') setRejecting(false)
                }}
              />
              <div className="flex gap-4">
                <ConsoleButton
                  variant="quiet"
                  onClick={() => setRejecting(false)}
                  disabled={processing}
                  className="flex-1"
                >
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  variant="danger"
                  onClick={handleReject}
                  disabled={processing || !rejectReason.trim()}
                  className="flex-1 flex items-center justify-center gap-2"
                >
                  <X className="w-4 h-4" />
                  {processing ? 'Processing...' : 'Send rejection'}
                </ConsoleButton>
              </div>
            </div>
          )}
          {verification.verificationDoc.status === 'pending' && !rejecting && (
            <div className="mt-6 flex gap-4">
              <ConsoleButton
                variant="primary"
                onClick={handleApprove}
                disabled={processing}
                className="flex-1 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                {processing ? 'Processing...' : 'Approve Verification'}
              </ConsoleButton>
              <ConsoleButton
                variant="danger"
                onClick={() => setRejecting(true)}
                disabled={processing}
                className="flex-1 flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                {processing ? 'Processing...' : 'Reject Verification'}
              </ConsoleButton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
