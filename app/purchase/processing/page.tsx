'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'

// How long to keep polling before showing a "we'll keep working on it" message.
const MAX_POLL_MS = 45_000
const POLL_INTERVAL_MS = 2_500

export default function PurchaseProcessingPage() {
  const { t } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams.get('orderId') || ''
  const provider = searchParams.get('provider') || 'sogepay'
  // A signed, short-lived status token (MonCash): lets a WebView without the
  // order cookie poll this one order.
  const statusToken = searchParams.get('st') || ''

  const [timedOut, setTimedOut] = useState(false)
  const startedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!orderId) {
      router.replace('/purchase/failed?reason=missing_order')
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const res = await fetch(
          `/api/${provider}/status?orderId=${encodeURIComponent(orderId)}${statusToken ? `&st=${encodeURIComponent(statusToken)}` : ''}`,
          { credentials: 'include', cache: 'no-store' }
        )

        if (res.ok) {
          const data = await res.json()
          if (data.status === 'completed') {
            router.replace(data.ticketId ? `/purchase/success?ticketId=${encodeURIComponent(data.ticketId)}` : '/purchase/success')
            return
          }
          if (data.status === 'failed') {
            const reason = data.failureReason ? `?reason=${encodeURIComponent(data.failureReason)}` : '?reason=payment_failed'
            router.replace(`/purchase/failed${reason}`)
            return
          }
        }
      } catch {
        // Ignore transient/auth errors and keep polling until the timeout.
      }

      if (Date.now() - startedAtRef.current > MAX_POLL_MS) {
        setTimedOut(true)
        return
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [orderId, provider, statusToken, router])

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white/[0.055] rounded-2xl p-6 md:p-8 text-center">
          {!timedOut ? (
            <>
              <div className="w-14 h-14 md:w-16 md:h-16 mx-auto mb-4 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-white/15 border-t-white rounded-full animate-spin" />
              </div>
              <h1 className="font-display lowercase italic !text-[28px] md:!text-[32px] !leading-tight text-white mb-2">
                {t('purchase.confirming_payment', { defaultValue: 'Confirming your payment…' })}
              </h1>
              <p className="text-sm md:text-base text-white/65">
                {t('purchase.confirming_payment_detail', {
                  defaultValue:
                    'Please wait while we confirm your payment and issue your ticket. This usually takes a few seconds.',
                })}
              </p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 md:w-16 md:h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 md:w-8 md:h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="font-display lowercase italic !text-[28px] md:!text-[32px] !leading-tight text-white mb-2">
                {t('purchase.still_confirming_payment', { defaultValue: 'Still confirming your payment' })}
              </h1>
              <p className="text-sm md:text-base text-white/65 mb-6">
                {t('purchase.still_confirming_payment_detail_pre', {
                  defaultValue: 'Your payment is being processed. If it was successful, your ticket will appear under',
                })}{' '}
                <strong>{t('purchase.my_tickets_label', { defaultValue: 'My Tickets' })}</strong>{' '}
                {t('purchase.still_confirming_payment_detail_post', {
                  defaultValue: 'shortly. No need to pay again.',
                })}
              </p>
              <Link
                href="/tickets"
                className="flex h-12 w-full items-center justify-center bg-white hover:bg-white/90 text-black font-semibold px-6 rounded-full transition-colors text-base"
              >
                {t('purchase.view_my_tickets', { defaultValue: 'View My Tickets' })}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
