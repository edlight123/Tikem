'use client'

import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ArrowLeft, Calendar, MapPin, User, Clock, Sparkles, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import Badge from '@/components/ui/Badge'
import QRCodeDisplay from './QRCodeDisplay'
import TicketActions from './TicketActions'
import AddToWalletButton from '@/components/AddToWalletButton'

interface TicketDetailContentProps {
  ticket: any
  event: any
  user: any
}

export default function TicketDetailContent({ ticket, event, user }: TicketDetailContentProps) {
  const { t } = useTranslation('tickets')

  const cleanTitle = (event?.title || '').replace(/^\[[^\]]*\]\s*/, '')

  const getStatusBadge = () => {
    if (ticket.checked_in_at) {
      return (
        <Badge variant="success" className="text-sm px-4 py-2">
          {t('detail.status.used')}
        </Badge>
      )
    }

    const status = String(ticket.status || '').toLowerCase()

    if (status === 'active' || status === 'valid') {
      return (
        <Badge variant="success" className="text-sm px-4 py-2">
          {t('detail.status.valid')}
        </Badge>
      )
    }

    // Map known statuses to friendly labels; fall back to a safe generic
    // label so internal enum strings are never shown to the user.
    const statusLabels: Record<string, string> = {
      used: t('detail.status.used'),
      transferred: t('status.transferred'),
      cancelled: t('status.cancelled'),
      canceled: t('status.cancelled'),
      refunded: 'Refunded',
      expired: 'Expired',
      pending: 'Pending',
    }

    return (
      <Badge variant="neutral" className="text-sm px-4 py-2">
        {statusLabels[status] || 'Inactive'}
      </Badge>
    )
  }

  return (
    <>
      {/* Back Button */}
      <Link 
        href="/tickets"
        className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{t('detail.back')}</span>
      </Link>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Left Column - QR & Actions */}
        <div className="space-y-4 sm:space-y-6">
          {/* QR Code Card */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 sm:p-6 lg:p-8 flex flex-col items-center">
            <div className="flex items-center justify-between w-full mb-4">
              {getStatusBadge()}
            </div>

            <div className="mb-6 text-center w-full">
              <p className="label-mono text-[11px] text-white/70 uppercase mb-2">
                {t('detail.ticket_code')}
              </p>
              <div className="flex justify-center">
                {/* The ticket's CURRENT code: after a transfer it is a signed
                    payload (lib/tickets/qr.ts) and the bare id is refused. */}
                <QRCodeDisplay
                  value={String(ticket.qr_code_data || ticket.qr_code || ticket.id)}
                  size={280}
                />
              </div>
            </div>

            {ticket.checked_in_at && (
              <div className="w-full border border-green-500/30 rounded-lg p-3 sm:p-4 mb-4">
                <p className="text-xs sm:text-sm font-semibold text-emerald-300 text-center">
                  {t('detail.checked_in')} {t('detail.checked_in_at', { 
                    time: format(new Date(ticket.checked_in_at), 'MMM d, yyyy • h:mm a') 
                  })}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="w-full space-y-3">
              <AddToWalletButton 
                ticket={ticket}
                event={event}
              />
              
              <TicketActions 
                ticketId={ticket.id}
                ticketStatus={ticket.status}
                checkedIn={!!ticket.checked_in_at}
                eventTitle={event.title}
              />
            </div>
          </div>
        </div>

        {/* Right Column - Event Details */}
        <div className="space-y-4 sm:space-y-6">
          {/* Event Banner Card */}
          <div className="bg-white/[0.03] border border-white/10 rounded-none overflow-hidden">
            {event.banner_image_url ? (
              <div className="relative w-full h-40 sm:h-48">
                <Image
                  src={event.banner_image_url}
                  alt={cleanTitle}
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <div className="relative w-full h-40 sm:h-48 bg-gradient-to-br from-brand-700 to-[#0C5E57] flex items-center justify-center">
                <span className="font-display text-5xl text-[#F8F5EE]">T</span>
              </div>
            )}
            
            <div className="p-4 sm:p-6">
              <h1 className="font-display italic text-2xl sm:text-3xl text-white mb-2">{cleanTitle}</h1>
              <a
                href={`/events/${event.id}`}
                className="text-sm text-brand-300 hover:text-brand-300 font-medium inline-flex items-center gap-1"
              >
                {t('detail.view_event')} →
              </a>

              <div className="space-y-3 mt-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-brand-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="label-mono text-[10px] text-white/70 uppercase mb-1.5">
                      {t('detail.date')}
                    </p>
                    <p className="label-mono text-white text-[13px]">
                      {format(new Date(event.start_datetime || event.date), 'MMM d, yyyy')}
                    </p>
                    <p className="label-mono text-[13px] text-white/60">
                      {format(new Date(event.start_datetime || event.date), 'h:mm a')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-brand-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="label-mono text-[10px] text-white/70 uppercase mb-1.5">
                      {t('detail.venue')}
                    </p>
                    <p className="label-mono text-white text-[13px]">
                      {event.venue_name || event.location}
                    </p>
                    <p className="label-mono text-[13px] text-white/60">{event.commune}, {event.city}</p>
                    <div className="flex gap-2 mt-2">
                      <a
                        href={`https://maps.apple.com/?q=${encodeURIComponent(event.address || `${event.venue_name || event.location}, ${event.commune}, ${event.city}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-300 hover:text-brand-300 font-medium flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3" />
                        {t('detail.apple_maps')}
                      </a>
                      <span className="text-white/70">|</span>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address || `${event.venue_name || event.location}, ${event.commune}, ${event.city}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-300 hover:text-brand-300 font-medium flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3" />
                        {t('detail.google_maps')}
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-brand-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="label-mono text-[10px] text-white/70 uppercase mb-1.5">
                      {t('detail.attendee')}
                    </p>
                    <p className="font-bold text-white text-sm">{user.full_name || user.email}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-brand-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="label-mono text-[10px] text-white/70 uppercase mb-1.5">
                      {t('detail.purchased')}
                    </p>
                    <p className="label-mono text-white text-[13px]">
                      {format(new Date(ticket.purchased_at), 'MMM d, yyyy')}
                    </p>
                    <p className="label-mono text-[13px] text-white/60">
                      {format(new Date(ticket.purchased_at), 'h:mm a')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Instructions Card */}
          <div className="border border-white/10 rounded-2xl p-4 sm:p-6">
            <div className="flex items-start gap-3 mb-3 sm:mb-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white mb-1">
                  {t('detail.how_to_use_title')}
                </h3>
                <p className="text-xs sm:text-sm text-white/60">{t('detail.how_to_use_subtitle')}</p>
              </div>
            </div>
            <ul className="space-y-2 text-xs sm:text-sm text-white/70">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-300" />
                <span>{t('detail.how_to_use_steps.show_qr')}</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-300" />
                <span>{t('detail.how_to_use_steps.save_wallet')}</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-300" />
                <span>{t('detail.how_to_use_steps.one_entry')}</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-300" />
                <span>{t('detail.how_to_use_steps.digital_print')}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}
