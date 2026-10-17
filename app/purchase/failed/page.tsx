import Link from 'next/link'
import PurchasePopupBridge from '@/components/PurchasePopupBridge'
import { resolveServerLanguage, tServer } from '@/lib/serverT'

export default async function PurchaseFailedPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise. A hand-written non-Promise type here
  // still typechecks but silently yields undefined at runtime.
  searchParams: Promise<{ reason?: string }>
}) {
  const reason = (await searchParams).reason || 'unknown'
  const lang = await resolveServerLanguage()
  const t = (path: string, fallback: string) => tServer(lang, path, fallback)

  const messages: Record<string, { title: string; description: string }> = {
    missing_transaction: {
      title: t('purchase.failed.missing_transaction.title', 'Transaction Not Found'),
      description: t(
        'purchase.failed.missing_transaction.description',
        "We couldn't find your payment transaction. Please try purchasing again."
      ),
    },
    transaction_not_found: {
      title: t('purchase.failed.transaction_not_found.title', 'Transaction Not Found'),
      description: t(
        'purchase.failed.transaction_not_found.description',
        'This transaction ID was not found in our system.'
      ),
    },
    payment_failed: {
      title: t('purchase.failed.payment_failed.title', 'Payment Failed'),
      description: t(
        'purchase.failed.payment_failed.description',
        'Your payment was not successful. Please check your payment method and try again.'
      ),
    },
    sold_out: {
      title: t('purchase.failed.sold_out.title', 'Sold Out'),
      description: t(
        'purchase.failed.sold_out.description',
        'This event sold out before your payment completed. If you were charged, you will be refunded automatically. No ticket was issued.'
      ),
    },
    amount_mismatch: {
      title: t('purchase.failed.amount_mismatch.title', 'Payment Amount Mismatch'),
      description: t(
        'purchase.failed.amount_mismatch.description',
        'The amount paid did not match the ticket price, so we could not complete your order. If you were charged, please contact support and we will help right away.'
      ),
    },
    ticket_creation_failed: {
      title: t('purchase.failed.ticket_creation_failed.title', 'Ticket Creation Failed'),
      description: t(
        'purchase.failed.ticket_creation_failed.description',
        "Payment was successful but we couldn't create your ticket. Please contact support."
      ),
    },
    processing_error: {
      title: t('purchase.failed.processing_error.title', 'Processing Error'),
      description: t(
        'purchase.failed.processing_error.description',
        'An error occurred while processing your payment. Please try again.'
      ),
    },
    missing_order: {
      title: t('purchase.failed.missing_order.title', 'Order Not Found'),
      description: t(
        'purchase.failed.missing_order.description',
        "We couldn't find your order. Please try purchasing again."
      ),
    },
    capacity_exceeded: {
      title: t('purchase.failed.capacity_exceeded.title', 'Sold Out'),
      description: t(
        'purchase.failed.capacity_exceeded.description',
        'This event sold out before your payment completed. If you were charged, you will be refunded automatically. No ticket was issued.'
      ),
    },
    unknown: {
      title: t('purchase.failed.unknown.title', 'Purchase Failed'),
      description: t('purchase.failed.unknown.description', 'Something went wrong with your purchase. Please try again.'),
    },
  }

  const message = messages[reason] || messages.unknown

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <PurchasePopupBridge status="failed" reason={reason} />
      <div className="max-w-md w-full">
        <div className="bg-white/[0.055] rounded-2xl p-6 md:p-8 text-center">
          {/* Error Icon */}
          <div className="w-14 h-14 md:w-16 md:h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-7 h-7 md:w-8 md:h-8 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <h1 className="font-display lowercase italic !text-[28px] md:!text-[32px] !leading-tight text-white mb-2">
            {message.title}
          </h1>

          <p className="text-sm md:text-base text-white/65 mb-6 md:mb-8">
            {message.description}
          </p>

          <div className="space-y-2.5">
            <Link
              href="/"
              className="flex h-12 w-full items-center justify-center bg-white hover:bg-white/90 text-black font-semibold px-6 rounded-full transition-colors text-base"
            >
              {t('purchase.browse_events', 'Browse Events')}
            </Link>

            <Link
              href="/tickets"
              className="flex h-12 w-full items-center justify-center bg-white/[0.07] hover:bg-white/[0.12] text-white font-semibold px-6 rounded-full transition-colors text-base"
            >
              {t('purchase.view_my_tickets', 'View My Tickets')}
            </Link>
          </div>

          {reason === 'ticket_creation_failed' && (
            <div className="mt-5 p-3.5 md:p-4 bg-amber-500/10 rounded-xl text-left">
              <p className="text-[13px] md:text-sm text-amber-200">
                <strong>{t('purchase.important_label', 'Important:')}</strong>{' '}
                {t('purchase.ticket_creation_failed_contact', 'Your payment was processed. Please contact support at')}{' '}
                <a href="mailto:support@tikem.co" className="underline font-semibold">
                  support@tikem.co
                </a>{' '}
                {t('purchase.ticket_creation_failed_contact_suffix', 'to resolve this issue.')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
