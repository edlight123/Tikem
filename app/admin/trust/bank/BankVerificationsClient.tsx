'use client'

import { useState, useEffect, useCallback } from 'react'
import BankVerificationReviewCard from '@/components/admin/BankVerificationReviewCard'
import { ConsoleButton } from '@/components/admin/console'

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

export default function BankVerificationsClient() {
  const [verifications, setVerifications] = useState<BankVerification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchVerifications = useCallback(async (loadMore = false, currentCursor: string | null = null) => {
    try {
      setLoading(true)
      setLoadError(null)
      const params = new URLSearchParams({ status: statusFilter })
      if (loadMore && currentCursor) {
        params.append('cursor', currentCursor)
      }

      const response = await fetch(`/api/admin/bank-verifications?${params}`)
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setLoadError(data.error || `Failed to load bank verifications (${response.status})`)
        if (!loadMore) setVerifications([])
        return
      }

      if (loadMore) {
        setVerifications((prev) => [...prev, ...(data.verifications || [])])
      } else {
        setVerifications(data.verifications || [])
      }

      setHasMore(data.hasMore)
      setCursor(data.nextCursor)
    } catch (error) {
      console.error('Error fetching verifications:', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load bank verifications')
      if (!loadMore) setVerifications([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchVerifications()
  }, [fetchVerifications])

  const handleStatusChange = (newStatus: string) => {
    setStatusFilter(newStatus)
    setCursor(null)
  }

  return (
    <>
      {/* Status filter — an in-page filter, not a second nav strip: the hub's tabs are the navigation. */}
      <div className="mb-6 flex flex-wrap gap-6">
        {['pending', 'approved', 'rejected'].map((status) => (
          <button
            key={status}
            onClick={() => handleStatusChange(status)}
            className={`label-mono border-b-2 px-1 pb-2 text-caption uppercase tracking-[0.14em] transition-colors ${
              statusFilter === status
                ? 'border-console-text text-console-text'
                : 'border-transparent text-console-mut hover:text-console-text'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading && verifications.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-console-mut"></div>
          <p className="mt-4 text-console-mut">Loading verifications...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && loadError && verifications.length === 0 && (
        <div className="rounded-lg bg-console-panel p-12 text-center">
          <p className="mb-4 text-sm text-console-red">{loadError}</p>
          <ConsoleButton onClick={() => fetchVerifications()}>
            Retry
          </ConsoleButton>
        </div>
      )}

      {/* Empty State */}
      {!loading && !loadError && verifications.length === 0 && (
        <div className="rounded-lg bg-console-panel p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-console-faint"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="label-mono mt-3 text-caption uppercase tracking-[0.14em] text-console-mut">
            No {statusFilter} verifications
          </h3>
          <p className="mt-1 text-meta text-console-faint">
            There are no {statusFilter} bank verifications at this time.
          </p>
        </div>
      )}

      {/* Verifications List */}
      {verifications.length > 0 && (
        <div className="space-y-6">
          {verifications.map((verification, index) => (
            <BankVerificationReviewCard
              key={`${verification.organizerId}-${verification.destinationId}-${index}`}
              verification={verification}
            />
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="mt-6 text-center">
          <ConsoleButton
            onClick={() => fetchVerifications(true, cursor)}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load More'}
          </ConsoleButton>
        </div>
      )}
    </>
  )
}
