'use client'

import { ConsolePanel } from '@/components/admin/console'
import { formatDate, safeString } from './format'

/** What the organizer submitted and where the review of it stands. */
export function OrganizerVerificationRequestCard({ verificationRequest }: { verificationRequest: any }) {
  return (
    <ConsolePanel className="p-4 sm:p-5">
      <h2 className="label-mono mb-4 text-eyebrow uppercase tracking-[0.18em] text-console-faint">
        Verification Request
      </h2>

      <dl className="space-y-3">
        <div>
          <dt className="text-xs text-console-mut">Status</dt>
          <dd
            className={`label-mono uppercase mt-1 text-sm font-semibold ${
              safeString(verificationRequest.status) === 'approved'
                ? 'text-console-green'
                : safeString(verificationRequest.status) === 'rejected'
                  ? 'text-console-red'
                  : 'text-console-amber'
            }`}
          >
            {safeString(verificationRequest.status, 'pending')}
          </dd>
        </div>

        {verificationRequest.business_name && typeof verificationRequest.business_name === 'string' && (
          <div>
            <dt className="text-xs text-console-mut">Business Name</dt>
            <dd className="text-sm text-console-text">{verificationRequest.business_name}</dd>
          </div>
        )}

        {verificationRequest.business_type && typeof verificationRequest.business_type === 'string' && (
          <div>
            <dt className="text-xs text-console-mut">Business Type</dt>
            <dd className="text-sm text-console-text">{verificationRequest.business_type}</dd>
          </div>
        )}

        <div>
          <dt className="text-xs text-console-mut">Submitted</dt>
          <dd className="font-mono tabular-nums text-sm text-console-text">
            {formatDate(verificationRequest.submitted_at || verificationRequest.createdAt)}
          </dd>
        </div>

        {verificationRequest.reviewed_at && (
          <div>
            <dt className="text-xs text-console-mut">Reviewed</dt>
            <dd className="font-mono tabular-nums text-sm text-console-text">
              {formatDate(verificationRequest.reviewed_at)}
            </dd>
          </div>
        )}

        {verificationRequest.rejection_reason && typeof verificationRequest.rejection_reason === 'string' && (
          <div>
            <dt className="text-xs text-console-mut">Rejection Reason</dt>
            <dd className="text-sm text-console-red">{verificationRequest.rejection_reason}</dd>
          </div>
        )}
      </dl>
    </ConsolePanel>
  )
}

/**
 * The identity / bank / phone documents behind the request.
 *
 * A document is either a plain URL or a private storage path; the path case has
 * to be exchanged for a signed URL through the admin API, which is why opening
 * one is a button rather than a link. The URL is never rendered into the page —
 * it is fetched at click time and opened, so a signed link to someone's ID does
 * not sit in the DOM of a page an admin may leave open.
 */
export function OrganizerVerificationDocsCard({ verificationDocs }: { verificationDocs: any[] }) {
  const openDocument = async (doc: any) => {
    if (doc.url) {
      window.open(doc.url, '_blank')
      return
    }
    if (!doc.documentPath) return
    try {
      const res = await fetch(`/api/admin/verification-image?path=${encodeURIComponent(doc.documentPath)}`)
      const data = await res.json()
      if (data?.url) window.open(data.url, '_blank')
    } catch (e) {
      console.error('Failed to open document:', e)
    }
  }

  return (
    <ConsolePanel className="p-4 sm:p-5">
      <h2 className="label-mono mb-4 text-eyebrow uppercase tracking-[0.18em] text-console-faint">
        Verification Documents ({verificationDocs.length})
      </h2>

      <div className="space-y-3">
        {verificationDocs.map((doc) => {
          const docType = doc.id || 'unknown'
          const docTypeLabel = docType.charAt(0).toUpperCase() + docType.slice(1)
          const status = typeof doc.status === 'string' ? doc.status : 'pending'

          return (
            <div key={doc.id} className="rounded-lg bg-console-raise p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-console-text">{docTypeLabel} Verification</p>
                  {doc.submittedAt && (
                    <p className="font-mono tabular-nums text-xs text-console-mut">
                      Submitted {formatDate(doc.submittedAt, false)}
                    </p>
                  )}
                  {doc.uploadedAt && !doc.submittedAt && (
                    <p className="font-mono tabular-nums text-xs text-console-mut">
                      Uploaded {formatDate(doc.uploadedAt, false)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`label-mono uppercase text-xs font-semibold ${
                      status === 'verified' || status === 'approved'
                        ? 'text-console-green'
                        : status === 'rejected' || status === 'failed'
                          ? 'text-console-red'
                          : 'text-console-amber'
                    }`}
                  >
                    {status}
                  </span>
                  {(doc.url || doc.documentPath) && (
                    <button
                      type="button"
                      onClick={() => openDocument(doc)}
                      className="text-xs font-medium text-console-mut hover:text-console-text"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </ConsolePanel>
  )
}
