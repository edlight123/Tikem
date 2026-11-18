'use client'

import { ConsolePanel } from '@/components/admin/console'
import { formatDate, safeString } from './format'

/**
 * Where this organizer's money is configured to go: every payout destination
 * they have registered, the legacy single-account shape that predates them, and
 * the state of the verification that gates paying any of it out.
 *
 * Read-only. Nothing here writes — the release overrides live in
 * OrganizerPayoutReleaseCard and the ban/verify actions live on the header.
 *
 * NOTE (pre-existing, preserved deliberately): the blocks below marked
 * `payoutConfig.` — Verification Status and Payout Status — dereference
 * `payoutConfig` without a null guard, while the surrounding condition also
 * admits the case where `payoutConfig` is null and only `payoutDestinations` is
 * populated. That combination throws. It is reported rather than patched here
 * so the fix lands as its own reviewed change.
 */
export default function OrganizerPayoutSummaryCard({
  payoutConfig,
  payoutDestinations,
}: {
  payoutConfig: any
  payoutDestinations?: any[]
}) {
  const hasAnything = payoutConfig || (payoutDestinations && payoutDestinations.length > 0)

  return (
    <ConsolePanel className="p-4 sm:p-5">
      <h2 className="label-mono mb-4 text-eyebrow uppercase tracking-[0.18em] text-console-faint">
        Bank Account &amp; Payouts
      </h2>

      {hasAnything ? (
        <div className="space-y-4">
          {/* All Payout Destinations (Multiple Bank Accounts) */}
          {payoutDestinations && payoutDestinations.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-console-mut">Payout Destinations ({payoutDestinations.length})</p>
              {payoutDestinations.map((dest, index) => (
                <div key={dest.id || index} className="rounded-lg bg-console-raise p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
                    <span className="label-mono uppercase text-console-mut">
                      {safeString(dest.type || 'bank').replace(/_/g, ' ')}
                    </span>
                    {(dest.isPrimary || dest.isDefault) && (
                      <span className="label-mono uppercase text-console-green">Primary</span>
                    )}
                    {dest.status && (
                      <span
                        className={`label-mono uppercase ${
                          dest.status === 'active' || dest.status === 'verified'
                            ? 'text-console-green'
                            : dest.status === 'pending'
                              ? 'text-console-amber'
                              : 'text-console-red'
                        }`}
                      >
                        {safeString(dest.status)}
                      </span>
                    )}
                  </div>

                  <dl className="space-y-1 text-sm">
                    {(dest.accountName || dest.bankDetails?.accountName) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Account Name</dt>
                        <dd className="text-console-text font-medium">
                          {safeString(dest.accountName || dest.bankDetails?.accountName)}
                        </dd>
                      </div>
                    )}
                    {(dest.bankName || dest.bankDetails?.bankName) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Bank</dt>
                        <dd className="text-console-text capitalize">
                          {safeString(dest.bankName || dest.bankDetails?.bankName)}
                        </dd>
                      </div>
                    )}
                    {(dest.accountNumberLast4 ||
                      dest.accountNumber ||
                      dest.bankDetails?.accountNumberLast4 ||
                      dest.bankDetails?.accountNumber) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Account #</dt>
                        <dd className="text-console-text font-mono">
                          ****
                          {safeString(
                            dest.accountNumberLast4 ||
                              dest.bankDetails?.accountNumberLast4 ||
                              dest.accountNumber ||
                              dest.bankDetails?.accountNumber,
                          )}
                        </dd>
                      </div>
                    )}
                    {(dest.routingNumber || dest.bankDetails?.routingNumber) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Routing #</dt>
                        <dd className="text-console-text font-mono">
                          {safeString(dest.routingNumber || dest.bankDetails?.routingNumber)}
                        </dd>
                      </div>
                    )}
                    {(dest.accountLocation || dest.bankDetails?.accountLocation) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Location</dt>
                        <dd className="text-console-text capitalize">
                          {safeString(dest.accountLocation || dest.bankDetails?.accountLocation)}
                        </dd>
                      </div>
                    )}
                    {(dest.provider || dest.mobileMoneyDetails?.provider) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Provider</dt>
                        <dd className="text-console-text">
                          {safeString(dest.provider || dest.mobileMoneyDetails?.provider)}
                        </dd>
                      </div>
                    )}
                    {(dest.phoneNumber || dest.mobileMoneyDetails?.phoneNumber) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-console-mut">Phone</dt>
                        <dd className="text-console-text font-mono">
                          {safeString(dest.phoneNumber || dest.mobileMoneyDetails?.phoneNumber)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              ))}
            </div>
          )}

          {/* Legacy Bank Details from payoutConfig */}
          {payoutConfig?.bankDetails && !payoutDestinations?.length && (
            <div className="rounded-lg bg-console-raise p-4">
              <div className="mb-3">
                <p className="text-sm font-medium text-console-text">
                  {safeString(payoutConfig.bankDetails?.accountName, 'N/A')}
                </p>
                <p className="mt-1 text-xs text-console-mut">Account Holder</p>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-console-mut">Bank</dt>
                  <dd className="text-console-text font-medium">
                    {safeString(payoutConfig.bankDetails?.bankName, 'N/A')}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-console-mut">Account Number</dt>
                  <dd className="text-console-text font-mono">
                    {typeof payoutConfig.bankDetails?.accountNumber === 'string' &&
                    payoutConfig.bankDetails.accountNumber
                      ? payoutConfig.bankDetails.accountNumber
                      : 'N/A'}
                  </dd>
                </div>
                {payoutConfig.bankDetails?.routingNumber && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-console-mut">Routing Number</dt>
                    <dd className="text-console-text font-mono">
                      {safeString(payoutConfig.bankDetails.routingNumber)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-console-mut">Location</dt>
                  <dd className="text-console-text">
                    {safeString(payoutConfig.accountLocation || payoutConfig.bankDetails?.accountLocation, 'N/A')}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Verification Status */}
          {payoutConfig?.verificationStatus && typeof payoutConfig.verificationStatus === 'object' && (
            <div className="rounded-lg bg-console-raise p-4">
              <p className="mb-3 text-sm font-medium text-console-text">Verification Status</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                {['identity', 'bank', 'phone'].map((type) => {
                  const status = payoutConfig.verificationStatus?.[type]
                  if (!status) return null
                  return (
                    <span
                      key={type}
                      className={`label-mono uppercase ${
                        status === 'verified'
                          ? 'text-console-green'
                          : status === 'failed'
                            ? 'text-console-red'
                            : 'text-console-amber'
                      }`}
                    >
                      {type}: {status}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Payout Status — gated on the config existing.
              This card renders when `payoutConfig || payoutDestinations.length`,
              so an organizer with destinations but no payout_config doc reached
              here with `payoutConfig` null and every `payoutConfig.status`
              below threw, white-screening the whole detail page. */}
          {payoutConfig && (
          <div className="rounded-lg bg-console-raise p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-console-text">Payout Status</p>
              <span
                className={`label-mono uppercase text-xs font-semibold ${
                  payoutConfig.status === 'active'
                    ? 'text-console-green'
                    : payoutConfig.status === 'pending_verification'
                      ? 'text-console-amber'
                      : payoutConfig.status === 'on_hold'
                        ? 'text-console-red'
                        : 'text-console-mut'
                }`}
              >
                {safeString(payoutConfig.status, 'not_setup').replace(/_/g, ' ')}
              </span>
            </div>
            {payoutConfig.method && (
              <p className="mt-1 text-xs text-console-mut">
                Method: {safeString(payoutConfig.method).replace(/_/g, ' ')}
              </p>
            )}
            {payoutConfig.payoutProvider && (
              <p className="text-xs text-console-mut">
                Provider: {safeString(payoutConfig.payoutProvider).replace(/_/g, ' ')}
              </p>
            )}
          </div>
          )}

          {/* Mobile Money Details */}
          {payoutConfig?.mobileMoneyDetails && (
            <div className="rounded-lg bg-console-raise p-4">
              <p className="mb-2 text-sm font-medium text-console-text">Mobile Money</p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-console-mut">Provider</dt>
                  <dd className="text-console-text">{safeString(payoutConfig.mobileMoneyDetails.provider)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-console-mut">Phone</dt>
                  <dd className="text-console-text font-mono">
                    {safeString(payoutConfig.mobileMoneyDetails.phoneNumber)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-console-mut">Account Name</dt>
                  <dd className="text-console-text">{safeString(payoutConfig.mobileMoneyDetails.accountName)}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Timestamps */}
          {(payoutConfig.createdAt || payoutConfig.updatedAt) && (
            <div className="space-y-1 font-mono tabular-nums text-xs text-console-mut">
              {payoutConfig.createdAt && <p>Created: {formatDate(payoutConfig.createdAt)}</p>}
              {payoutConfig.updatedAt && <p>Updated: {formatDate(payoutConfig.updatedAt)}</p>}
            </div>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-console-mut">No payout configuration</p>
      )}
    </ConsolePanel>
  )
}
