'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Share2, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isLiveTicketStatus } from '@/lib/tickets/status'

/**
 * Surface pass. Nothing about the transfer flow changed — only what it looks
 * like.
 *
 * The defects: the dialog was a 3% white fill with a white/10 hairline drawn
 * around it, behind a black scrim, so a sheet meant to float above the page read as
 * an outline of one; every field and secondary button repeated the same 3%
 * fill + hairline; and the three status banners plus the expiry reminder had a
 * coloured border with NO fill at all, which is the exact "box outlined around
 * nothing" the owner has rejected (docs/POSH_DESIGN_BRIEF.md). Fills now carry
 * all of it, stepping up the ladder for anything sitting on the sheet.
 */

/** A field or a secondary button on the dialog sheet. */
const SHEET_FIELD = 'rounded-lg bg-white/[0.06] text-white'
/** The one primary action inside the dialog. */
const PRIMARY_BTN =
  'rounded-lg bg-white font-bold text-black transition-colors hover:bg-white/90 disabled:opacity-50'

/** The holder's own unexpired transfer (lib/tickets/transfers.ts). */
export interface PendingTransferInfo {
  id: string
  toEmail: string
  token: string
  expiresAt: string | null
}

interface TicketActionsProps {
  ticketId: string
  ticketStatus: string
  checkedIn: boolean
  eventTitle: string
  pendingTransfer?: PendingTransferInfo | null
}

export default function TicketActions({ ticketId, ticketStatus, checkedIn, eventTitle, pendingTransfer = null }: TicketActionsProps) {
  const { t, i18n } = useTranslation('tickets')
  const [pending, setPending] = useState<PendingTransferInfo | null>(pendingTransfer)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const router = useRouter()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Transfer form state
  const [transferEmail, setTransferEmail] = useState('')
  const [transferMessage, setTransferMessage] = useState('')
  const [transferLink, setTransferLink] = useState('')
  const [showTransferLink, setShowTransferLink] = useState(false)

  function closeTransferModal() {
    setShowTransferModal(false)
    setShowTransferLink(false)
    setTransferLink('')
  }

  // Dialog behavior: close on Escape and focus the first element when opened.
  useEffect(() => {
    if (!showTransferModal) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeTransferModal()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    // Focus the first meaningful control inside the dialog.
    const focusTarget = emailInputRef.current || closeButtonRef.current
    focusTarget?.focus()

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showTransferModal, showTransferLink])

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch('/api/tickets/transfer/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          toEmail: transferEmail,
          message: transferMessage
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Transfer failed')
      }

      // Generate transfer link if token is returned
      if (data.transfer?.transferToken) {
        const link = `${window.location.origin}/tickets/transfer/${data.transfer.transferToken}`
        setTransferLink(link)
        setShowTransferLink(true)
        setPending({
          id: String(data.transfer.id),
          toEmail: String(data.transfer.toEmail || transferEmail),
          token: String(data.transfer.transferToken),
          expiresAt: data.transfer.expiresAt || null,
        })
      }

      setMessage({ type: 'success', text: t('detail.transfer_success') })
      setTransferEmail('')
      setTransferMessage('')
      
      // Don't auto-close modal if we're showing the transfer link
      if (!data.transfer?.transferToken) {
        setTimeout(() => {
          setShowTransferModal(false)
          router.refresh()
        }, 2000)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('detail.transfer_error') })
    } finally {
      setLoading(false)
    }
  }

  // The API at /api/tickets/transfer/request accepts valid | confirmed |
  // active, but this test omitted `confirmed` — so a holder the server
  // would happily let transfer never saw the button. `confirmed` is not
  // hypothetical: fulfillment and the MonCash callback both record having
  // written it. Routed through the canonical helper so the UI and the
  // permission cannot drift apart again.
  const canTransfer = isLiveTicketStatus(ticketStatus) && !checkedIn

  const pendingLink = pending && typeof window !== 'undefined' ? `${window.location.origin}/tickets/transfer/${pending.token}` : ''
  const pendingWhen = (() => {
    if (!pending?.expiresAt) return ''
    const d = new Date(pending.expiresAt)
    if (Number.isNaN(d.getTime())) return ''
    try {
      return d.toLocaleString(i18n.language === 'ht' ? 'fr-HT' : i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
      return d.toLocaleString()
    }
  })()

  async function copyPendingLink() {
    if (!pendingLink) return
    try {
      await navigator.clipboard.writeText(pendingLink)
      setMessage({ type: 'success', text: t('detail.transfer_link_copied') })
      setTimeout(() => setMessage(null), 2000)
    } catch {
      // Clipboard blocked: the link is selectable in the field above.
    }
  }

  async function cancelPendingTransfer() {
    if (!pending) return
    setCancelling(true)
    setMessage(null)
    try {
      const res = await fetch('/api/tickets/transfer/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: pending.id }),
      })
      const data = await res.json().catch(() => ({}))
      // 'expired' also frees the ticket: the server just marked it so.
      if (res.ok || /expired/i.test(String(data?.error || ''))) {
        setPending(null)
        setConfirmingCancel(false)
        setMessage({ type: 'success', text: t('detail.transfer_cancelled') })
        router.refresh()
      } else {
        setMessage({ type: 'error', text: t('detail.transfer_cancel_failed') })
      }
    } catch {
      setMessage({ type: 'error', text: t('detail.transfer_cancel_failed') })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* A banner is a surface: it gets a tinted FILL, not a coloured outline
          around empty space. */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-300'
            : 'bg-red-500/10 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {/* Transfer Button. Secondary by design: Add to Wallet is the primary
          action of this stack, and teal is semantic in this app, never a button
          surface — so this is the grey pill, not a teal one. */}
      {/* A transfer in flight: the holder can re-share the link or take it back.
          A filled surface, not an outline; the clock dot marks the state. */}
      {pending && !showTransferModal && (
        <div className="rounded bg-white/[0.055] p-4 text-left">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-300">
            <Clock className="h-4 w-4" />
            {t('detail.transfer_pending_title')}
          </div>
          <p className="mb-3 text-sm text-white/70">
            {t('detail.transfer_pending_body', { email: pending.toEmail, when: pendingWhen || '24h' })}
          </p>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={pendingLink}
              readOnly
              aria-label={t('detail.transfer_link_label')}
              className={`${SHEET_FIELD} min-w-0 flex-1 px-3 py-2.5 text-[16px] text-white/80`}
            />
            <button
              type="button"
              onClick={copyPendingLink}
              className="shrink-0 rounded bg-white/[0.08] px-4 py-2.5 font-medium text-white transition-colors hover:bg-white/[0.14]"
            >
              {t('detail.transfer_copy_link')}
            </button>
          </div>
          {confirmingCancel ? (
            <div className="rounded bg-red-500/10 p-3">
              <p className="mb-3 text-sm text-red-200">{t('detail.transfer_cancel_confirm')}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={cancelling}
                  className="flex-1 rounded bg-white/[0.08] px-4 py-2.5 font-medium text-white/80 transition-colors hover:bg-white/[0.14] disabled:opacity-50"
                >
                  {t('detail.transfer_cancel')}
                </button>
                <button
                  type="button"
                  onClick={cancelPendingTransfer}
                  disabled={cancelling}
                  className="flex-1 rounded bg-red-500/20 px-4 py-2.5 font-semibold text-red-100 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                >
                  {cancelling ? t('detail.transfer_cancelling') : t('detail.transfer_cancel_transfer')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="w-full rounded bg-white/[0.06] px-4 py-2.5 font-medium text-red-300 transition-colors hover:bg-red-500/10"
            >
              {t('detail.transfer_cancel_transfer')}
            </button>
          )}
        </div>
      )}

      {canTransfer && !pending && (
        <button
          onClick={() => setShowTransferModal(true)}
          className="w-full px-4 py-3 bg-white/[0.08] text-white font-semibold rounded-lg hover:bg-white/[0.14] transition-colors flex items-center justify-center gap-2"
        >
          <Share2 className="w-4 h-4" />
          {t('detail.transfer_ticket')}
        </button>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={closeTransferModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-modal-title"
            onClick={(e) => e.stopPropagation()}
            // A sheet floating over a black scrim needs to be an ELEVATED
            // surface, not a 3% wash of the page: #1c1c1c is the brief's
            // surface-2 (the sheet rung).
            className="bg-[#1c1c1c] rounded-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
          >
            {/* Serif lowercase, the house voice — and `!text-2xl` because
                `.mobile-typography h2` (0,1,1) collapsed it to 18px on a phone. */}
            <h2
              id="transfer-modal-title"
              className="font-display lowercase !text-2xl !leading-[1.04] text-white mb-4"
            >
              {t('detail.transfer_title')}
            </h2>
            
            {!showTransferLink ? (
              <>
                <p className="text-white/60 mb-6">
                  {t('detail.transfer_intro')}
                  <span className="block mt-2 text-sm text-amber-300 font-medium">
                    {t('detail.transfer_expiry_note')}
                  </span>
                </p>

                <form onSubmit={handleTransfer} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      {t('detail.transfer_to_email')}
                    </label>
                    <input
                      ref={emailInputRef}
                      type="email"
                      value={transferEmail}
                      onChange={(e) => setTransferEmail(e.target.value)}
                      placeholder="friend@example.com"
                      className={`${SHEET_FIELD} w-full px-4 py-2.5 text-[16px] placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500`}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      {t('detail.transfer_message')}
                    </label>
                    <textarea
                      value={transferMessage}
                      onChange={(e) => setTransferMessage(e.target.value)}
                      placeholder={t('detail.transfer_message_placeholder')}
                      className={`${SHEET_FIELD} w-full px-4 py-2.5 text-[16px] placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500`}
                      rows={3}
                      maxLength={500}
                    />
                  </div>

                  {message && (
                    <div className={`p-3 rounded-lg ${
                      message.type === 'success'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-red-500/10 text-red-300'
                    }`}>
                      {message.text}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      ref={closeButtonRef}
                      type="button"
                      onClick={closeTransferModal}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-white/[0.06] text-white/70 font-medium transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-50"
                      disabled={loading}
                    >
                      {t('detail.transfer_cancel')}
                    </button>
                    <button
                      type="submit"
                      className={`${PRIMARY_BTN} flex-1 px-4 py-2.5`}
                      disabled={loading || !transferEmail}
                    >
                      {loading ? t('detail.transfer_sending') : t('detail.transfer_send')}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <p className="text-white/60 mb-4">
                  {t('detail.transfer_share')}
                </p>

                <div className="space-y-3 mb-6">
                  {/* Copy Link */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={transferLink}
                      readOnly
                      // 16px, not text-sm: iOS zooms the page when a control
                      // under 16px takes focus, and a readonly input still can.
                      className={`${SHEET_FIELD} min-w-0 flex-1 px-3 py-2.5 text-[16px]`}
                    />
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(transferLink)
                        setMessage({ type: 'success', text: t('detail.transfer_link_copied') })
                        setTimeout(() => setMessage(null), 2000)
                      }}
                      className="shrink-0 px-4 py-2.5 rounded-lg bg-white/[0.06] text-white font-medium transition-colors hover:bg-white/[0.12]"
                    >
                      {t('detail.transfer_copy_link')}
                    </button>
                  </div>

                  {/* Share via WhatsApp */}
                  <button
                    onClick={() => {
                      const text = t('detail.transfer_share_text', { event: eventTitle })
                      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + transferLink)}`
                      window.open(whatsappUrl, '_blank')
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 transition"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    {t('detail.transfer_share_whatsapp')}
                  </button>

                  {/* Share via SMS */}
                  <button
                    onClick={() => {
                      const text = `${t('detail.transfer_share_text', { event: eventTitle })} ${transferLink}`
                      window.location.href = `sms:?&body=${encodeURIComponent(text)}`
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/[0.06] text-white font-medium transition-colors hover:bg-white/[0.12]"
                  >
                    {t('detail.transfer_share_sms')}
                  </button>
                </div>

                {/* The reminder was an amber outline around nothing; the tint
                    is what makes it read as a warning at a glance. */}
                <div className="rounded-lg bg-amber-500/10 p-3 mb-4">
                  <p className="text-sm text-amber-300">
                    {t('detail.transfer_reminder')}
                  </p>
                </div>

                {message && (
                  <div className={`p-3 rounded-lg mb-4 ${
                    message.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : 'bg-red-500/10 text-red-300'
                  }`}>
                    {message.text}
                  </div>
                )}

                <button
                  onClick={() => {
                    closeTransferModal()
                    router.refresh()
                  }}
                  className={`${PRIMARY_BTN} w-full px-4 py-2.5`}
                >
                  {t('detail.transfer_done')}
                </button>
              </>
            )}
          </div>
        </div>
      )}


    </div>
  )
}
