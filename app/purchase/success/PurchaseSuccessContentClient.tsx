'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, QrCode } from 'lucide-react'
import { StatusChip } from '@/components/ui/kit'

type Props = {
  hasTicket: boolean
  ticketIdShort: string | null
  eventTitle: string
  startDateIso: string | null
  location: string | null
  amountPaid: number | null
  amountCurrency: string | null
  qrCodeDataUrl: string | null
}

function getLocaleFromLanguage(language: string): string {
  const lng = String(language || '').toLowerCase()
  if (lng.startsWith('fr')) return 'fr-FR'
  if (lng.startsWith('ht')) return 'fr-HT'
  return 'en-US'
}

export default function PurchaseSuccessContentClient(props: Props) {
  const { t, i18n } = useTranslation(['tickets', 'common'])
  const locale = getLocaleFromLanguage(i18n.language)

  const startText = (() => {
    if (!props.startDateIso) return t('tickets:purchase_success.date_tba')
    const d = new Date(props.startDateIso)
    if (Number.isNaN(d.getTime())) return t('tickets:purchase_success.date_tba')
    return d.toLocaleDateString(locale, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  })()

  const amountText = (() => {
    if (props.amountPaid === null || !Number.isFinite(props.amountPaid)) return null
    const currency = props.amountCurrency || 'USD'

    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(props.amountPaid)
    } catch {
      // Fallback if currency code is unsupported
      const prefix = props.amountCurrency ? `${props.amountCurrency} ` : '$'
      return `${prefix}${props.amountPaid.toFixed(2)}`
    }
  })()

  // An unknown value reads as a quiet middle dot, not as punctuation.
  const empty = <span className="text-white/35" aria-hidden="true">·</span>

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 md:w-20 md:h-20 rounded bg-green-500/10 mb-4">
          <svg className="w-8 h-8 md:w-10 md:h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-display lowercase italic !text-[32px] md:!text-[40px] !leading-tight text-white mb-2">
          {t('tickets:purchase_success.title')}
        </h1>
        <p className="text-base md:text-lg text-white/65">{t('tickets:purchase_success.subtitle')}</p>
      </div>

      {props.hasTicket && (
        <div className="bg-white/[0.055] rounded-2xl overflow-hidden mb-6">
          <div className="p-4 md:p-6 pb-0 md:pb-0 text-white">
            <h2 className="text-lg md:text-xl lg:text-2xl font-bold mb-1.5 md:mb-2 line-clamp-2">{props.eventTitle}</h2>
            <p className="text-sm md:text-base text-white/60">{startText}</p>
          </div>

          <div className="p-4 md:p-6 space-y-3 md:space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
              <span className="text-[13px] font-medium text-white/65">{t('tickets:purchase_success.ticket_id_label')}</span>
              <span className="font-mono text-sm text-white">{props.ticketIdShort || empty}</span>
            </div>

            <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
              <span className="text-[13px] font-medium text-white/65">{t('tickets:purchase_success.location_label')}</span>
              <span className="text-sm text-white text-right truncate max-w-[60%]">{props.location || empty}</span>
            </div>

            <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
              <span className="text-[13px] font-medium text-white/65">{t('tickets:purchase_success.amount_paid_label')}</span>
              <span className="text-base md:text-lg font-bold text-white">{amountText ?? empty}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-[13px] font-medium text-white/65">{t('tickets:purchase_success.status_label')}</span>
              <StatusChip tone="success">
                {t('tickets:purchase_success.status_confirmed')}
              </StatusChip>
            </div>
          </div>

          <div className="p-4 md:p-6 pt-0 md:pt-0">
            {props.qrCodeDataUrl ? (
              <div className="flex flex-col items-center justify-center bg-white/[0.06] rounded-xl p-4 md:p-6">
                <Image
                  src={props.qrCodeDataUrl}
                  alt={t('tickets:purchase_success.qr_alt')}
                  width={208}
                  height={208}
                  className="w-44 h-44 md:w-52 md:h-52 rounded-xl"
                  unoptimized
                />
                <p className="text-sm text-white/65 mt-3">{t('tickets:purchase_success.qr_title')}</p>
                <p className="text-[11px] md:text-xs text-white/50 mt-1">{t('tickets:purchase_success.qr_subtitle')}</p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 md:h-48 bg-white/[0.06] rounded-xl">
                <div className="text-center">
                  <QrCode className="w-12 h-12 md:w-16 md:h-16 mx-auto text-white/40 mb-2" strokeWidth={1.5} aria-hidden="true" />
                  <p className="text-sm text-white/65">{t('tickets:purchase_success.qr_title')}</p>
                  <p className="text-[11px] md:text-xs text-white/50 mt-1">{t('tickets:purchase_success.qr_subtitle')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!props.hasTicket && (
        <div className="bg-white/[0.055] rounded-2xl p-8 md:p-12 text-center mb-6">
          <p className="text-sm md:text-base text-white/65">{t('tickets:purchase_success.no_ticket_message')}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/tickets"
          className="inline-flex h-12 items-center justify-center px-6 md:px-8 rounded bg-white text-black text-base font-semibold hover:bg-white/90 transition-colors text-center"
        >
          {t('tickets:purchase_success.view_tickets')}
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center px-6 md:px-8 rounded bg-white/[0.07] text-white text-base font-semibold hover:bg-white/[0.12] transition-colors text-center"
        >
          {t('tickets:purchase_success.find_more_events')}
        </Link>
      </div>

      <div className="mt-8 bg-white/[0.055] rounded-2xl p-4 md:p-6">
        <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white mb-2.5">{t('tickets:purchase_success.next_steps_title')}</h3>
        <ul className="space-y-2 text-[13px] md:text-sm text-white/70">
          <li className="flex items-start">
            <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 mr-2 flex-shrink-0 mt-0.5 text-white/50" aria-hidden="true" />
            {t('tickets:purchase_success.next_steps.check_email')}
          </li>
          <li className="flex items-start">
            <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 mr-2 flex-shrink-0 mt-0.5 text-white/50" aria-hidden="true" />
            {t('tickets:purchase_success.next_steps.save_ticket')}
          </li>
          <li className="flex items-start">
            <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 mr-2 flex-shrink-0 mt-0.5 text-white/50" aria-hidden="true" />
            {t('tickets:purchase_success.next_steps.arrive_early')}
          </li>
        </ul>
      </div>
    </div>
  )
}
