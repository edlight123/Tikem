'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ticket } from 'lucide-react'
import { FormField, SectionHeader, StatusChip } from '@/components/organizer/ui'
import { SALE_METHODS, cleanHolderName, parsePhysicalQr } from '@/lib/physical/rules'

const field =
  'w-full rounded bg-surface px-4 py-3 text-base text-fg placeholder-fg-faint focus:outline-none focus:ring-2 focus:ring-brand-500/60 sm:text-sm'

type Outcome = { ok: true; text: string } | { ok: false; text: string }

export default function SellClient({ eventId, eventTitle }: { eventId: string; eventTitle: string; isSeller: boolean }) {
  const { t } = useTranslation('common')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cleanHolderName(name)) {
      setOutcome({ ok: false, text: t('physical.activate.errors.NAME_REQUIRED') })
      return
    }
    setBusy(true)
    setOutcome(null)
    const raw = code.trim()
    const body = parsePhysicalQr(raw) ? { code: raw } : { serial: raw }
    try {
      const res = await fetch(`/api/staff/events/${eventId}/physical/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, name, phone, method }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        setOutcome({ ok: true, text: t('physical.activate.done', { serial: data.serial, name: data.holderName }) })
        setCode('')
        setName('')
        setPhone('')
      } else if (res.ok && data?.code) {
        setOutcome({ ok: false, text: t(`physical.activate.errors.${data.code}`, { name: data.holderName || '' }) })
      } else {
        setOutcome({ ok: false, text: String(data?.error || t('physical.generic_error')) })
      }
    } catch {
      setOutcome({ ok: false, text: t('physical.generic_error') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeader className="mb-2" eyebrow={eventTitle} title={t('physical.activate.title')} />
      <p className="mb-8 text-sm text-fg-muted">{t('physical.activate.intro')}</p>
      <form onSubmit={submit} className="space-y-5">
        <FormField label={t('physical.activate.code')} htmlFor="sell-code" required>
          <input
            id="sell-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('physical.activate.code_ph')}
            autoCapitalize="characters"
            autoComplete="off"
            className={`${field} font-mono`}
            required
          />
        </FormField>
        <FormField label={t('physical.activate.name')} htmlFor="sell-name" required>
          <input id="sell-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={field} required />
        </FormField>
        <FormField label={t('physical.activate.phone')} htmlFor="sell-phone">
          <input id="sell-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
        </FormField>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-soft">{t('physical.activate.method')}</legend>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            {SALE_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={`h-10 rounded px-4 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  method === m ? 'bg-surface-high text-fg' : 'bg-surface text-fg-muted hover:bg-surface-raised'
                }`}
              >
                {t(`physical.activate.method_${m}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
        >
          <Ticket className="h-4 w-4" strokeWidth={1.75} />
          {t('physical.activate.submit')}
        </button>
      </form>
      {outcome && (
        <div className="mt-6 rounded bg-surface px-4 py-3">
          <StatusChip className="!normal-case !text-sm" tone={outcome.ok ? 'success' : 'danger'}>
            {outcome.text}
          </StatusChip>
        </div>
      )}
    </>
  )
}
