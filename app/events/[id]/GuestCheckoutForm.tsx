'use client'

// The whole of "buying without an account": three fields, no password.
//
// Phone is a first-class identifier here, not an afterthought. For a Haiti event it is
// REQUIRED and the ticket is texted as well as emailed — in Haiti a phone number
// reaches people far more reliably than an inbox does. Everywhere else it is offered
// as an optional second channel.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PhoneField from '@/components/ui/PhoneField'

export interface GuestContactInput {
  name: string
  email: string
  phone: string
}

/**
 * The all-in total for the order this form is collecting details for.
 *
 * A guest is asked for their details BEFORE payment, so this is one of the surfaces
 * that must not quote a face value the buyer won't actually be charged: in a
 * buyer-pays market the fee is itemized here and the total is the charge.
 */
export interface GuestOrderSummary {
  subtotal: number
  fee: number
  total: number
  currency: string
}

export default function GuestCheckoutForm({
  requirePhone,
  submitLabel,
  busy = false,
  initial,
  orderSummary,
  feesAddedOnTop = false,
  onSubmit,
  onCancel,
}: {
  /** True for Haiti events. */
  requirePhone: boolean
  submitLabel: string
  busy?: boolean
  initial?: Partial<GuestContactInput>
  /** Present once a concrete order exists; omitted before tickets are chosen. */
  orderSummary?: GuestOrderSummary | null
  /**
   * True in a buyer-pays market. When there is no `orderSummary` yet (the buyer
   * hasn't picked tickets), this at least tells them a fee is coming rather than
   * letting the ticket price they saw stand as the total.
   */
  feesAddedOnTop?: boolean
  onSubmit: (contact: GuestContactInput) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation('common')
  const [name, setName] = useState(initial?.name || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [phone, setPhone] = useState(initial?.phone || '')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedPhone = phone.trim()

    // Client-side checks are a courtesy only — the server validates and normalizes
    // all three fields again before anything is created.
    if (!trimmedName) {
      setError(t('checkout.guest_name_required', { defaultValue: 'Please enter your name.' }))
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      setError(
        t('checkout.guest_email_required', { defaultValue: 'Please enter a valid email address.' })
      )
      return
    }
    if (requirePhone && !trimmedPhone) {
      setError(
        t('checkout.guest_phone_required', { defaultValue: 'Please enter your phone number.' })
      )
      return
    }

    setError(null)
    onSubmit({ name: trimmedName, email: trimmedEmail, phone: trimmedPhone })
  }

  // A real fill, matching the PhoneField below it and the house rule (see
  // docs/POSH_DESIGN_BRIEF, "Surfaces"). This was a hairline over a 3% fill,
  // which next to the filled phone control read as two different form systems
  // in one sheet. 16px so iOS does not zoom the sheet on focus.
  const inputClass =
    'w-full rounded-lg bg-white/[0.06] px-4 py-3 text-[16px] text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/50 disabled:opacity-50'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-white/60 leading-relaxed">
        {t('checkout.guest_intro', {
          defaultValue:
            'No account needed. We send your ticket and QR code straight to you, and you can create an account afterwards if you want.',
        })}
      </p>

      {orderSummary ? (
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-4 space-y-2 text-sm">
          {orderSummary.fee > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-white/60">
                  {t('events.subtotal', { defaultValue: 'Subtotal' })}
                </span>
                <span className="text-white">
                  {orderSummary.subtotal.toLocaleString()} {orderSummary.currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">
                  {t('checkout.service_fee', { defaultValue: 'Service fee' })}
                </span>
                <span className="text-white">
                  {orderSummary.fee.toLocaleString()} {orderSummary.currency}
                </span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-white/10 pt-2 font-semibold">
            <span className="text-white/80">
              {t('checkout.you_pay', { defaultValue: "You'll pay" })}
            </span>
            <span className="text-brand-300">
              {orderSummary.total.toLocaleString()} {orderSummary.currency}
            </span>
          </div>
          {orderSummary.fee > 0 && (
            <p className="text-xs text-white/45">
              {t('checkout.service_fee_nonrefundable', {
                defaultValue: 'Service fee is non-refundable unless the event is cancelled.',
              })}
            </p>
          )}
        </div>
      ) : (
        feesAddedOnTop && (
          <p className="text-xs text-white/45">
            {t('checkout.fee_added_notice', {
              defaultValue:
                'A service fee is added to the ticket price. You will see the full total before you pay.',
            })}{' '}
            {t('checkout.service_fee_nonrefundable', {
              defaultValue: 'Service fee is non-refundable unless the event is cancelled.',
            })}
          </p>
        )
      )}

      <div>
        <label htmlFor="guest-name" className="block text-xs uppercase tracking-wider text-white/50 mb-1.5">
          {t('checkout.guest_name', { defaultValue: 'Full name' })}
        </label>
        <input
          id="guest-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className={inputClass}
          placeholder={t('checkout.guest_name_placeholder', { defaultValue: 'Your name' })}
        />
      </div>

      <div>
        <label htmlFor="guest-email" className="block text-xs uppercase tracking-wider text-white/50 mb-1.5">
          {t('checkout.guest_email', { defaultValue: 'Email' })}
        </label>
        <input
          id="guest-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className={inputClass}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="guest-phone" className="block text-xs uppercase tracking-wider text-white/50 mb-1.5">
          {t('checkout.guest_phone', { defaultValue: 'Phone' })}
          {!requirePhone && (
            <span className="ml-1 normal-case tracking-normal text-white/35">
              {t('common.optional', { defaultValue: 'optional' })}
            </span>
          )}
        </label>
        {/* The same picker as sign-up. This is the field a MonCash number is
            typed into, so the country has to be explicit and the stored value
            canonical — "3412 3456" and "+509 3412 3456" were both accepted
            here and only one of them can be texted. */}
        <PhoneField
          id="guest-phone"
          name="guest-phone"
          value={phone}
          onChange={setPhone}
          required={requirePhone}
          disabled={busy}
        />
        <p className="mt-1.5 text-xs text-white/40">
          {requirePhone
            ? t('checkout.guest_phone_hint_ht', {
                defaultValue: 'We text your ticket here too, so you always have it.',
              })
            : t('checkout.guest_phone_hint', {
                defaultValue: 'Add it and we can text you your ticket as well.',
              })}
        </p>
      </div>

      {error && (
        <div className="border border-red-200/40 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="block w-full bg-brand-600 hover:bg-brand-700 text-white text-center font-semibold py-3 px-5 rounded-lg transition-colors disabled:opacity-50 min-h-[44px]"
      >
        {busy ? t('events.processing') : submitLabel}
      </button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="w-full px-4 py-3 border border-white/10 rounded-lg font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
      )}

      <p className="text-center text-xs text-white/40">
        {t('checkout.guest_signin_hint', { defaultValue: 'Already have an account?' })}{' '}
        <a href="/auth/login" className="text-brand-400 underline underline-offset-2">
          {t('nav.signIn')}
        </a>
      </p>
    </form>
  )
}
