'use client'

/**
 * Share an event (web). Compact numbered steps under ONE title, send at the
 * bottom. The flyer is the only thing required; once it is up, the flyer
 * reader (POST /api/flyers/read, lib/flyer/parse) fills the empty fields and
 * the member checks them. Everything goes to POST /api/community/submissions
 * and waits for an admin; nothing is published from here.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import ImageUpload from '@/components/ImageUpload'
import { CATEGORIES } from '@/lib/filters/config'
import type { FlyerRead } from '@/lib/flyer/parse'

const COUNTRIES = ['HT', 'US', 'CA', 'FR'] as const
const CURRENCIES = ['HTG', 'USD', 'CAD', 'EUR'] as const

const field =
  'w-full rounded bg-surface px-3 py-2.5 text-body text-fg placeholder:text-fg-subtle [color-scheme:dark] focus:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand-400/50'
const label = 'mb-1.5 block text-meta text-fg-muted'
const chip = (on: boolean) =>
  `rounded px-3 py-1.5 text-meta font-medium transition-colors ${on ? 'bg-inverse text-on-inverse' : 'bg-surface text-fg-muted hover:text-fg'}`

interface Form {
  title: string
  date: string
  start_time: string
  end_time: string
  venue_name: string
  address: string
  city: string
  country: (typeof COUNTRIES)[number] | ''
  free: boolean | null
  price: string
  currency: (typeof CURRENCIES)[number] | ''
  ticket_url: string
  category: string
  source_url: string
  organizer_name: string
  organizer_handle: string
  note: string
}

const EMPTY: Form = {
  title: '',
  date: '',
  start_time: '',
  end_time: '',
  venue_name: '',
  address: '',
  city: '',
  country: '',
  free: null,
  price: '',
  currency: '',
  ticket_url: '',
  category: '',
  source_url: '',
  organizer_name: '',
  organizer_handle: '',
  note: '',
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h2 className="mb-3 flex items-baseline gap-2 text-body font-semibold text-fg">
        <span className="label-mono text-meta tabular-nums text-fg-subtle">{n}</span>
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export default function ShareEventClient() {
  const { t } = useTranslation('common')
  const [form, setForm] = useState<Form>(EMPTY)
  const [image, setImage] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [filled, setFilled] = useState<string[] | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  // Live right away (passed the safety checks) or held for review (lib/community/publish).
  const [sentResult, setSentResult] = useState<{ status: 'published' | 'pending'; eventId?: string } | null>(null)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function readFlyer(url: string) {
    setReading(true)
    setFilled(null)
    try {
      const res = await fetch('/api/flyers/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const body = await res.json().catch(() => null)
      const r = body?.read as FlyerRead | undefined
      if (!res.ok || !r) return
      const got: string[] = []
      setForm((f) => {
        const next = { ...f }
        const take = (k: keyof Form, v: string | null, name: string) => {
          if (v && !String(next[k] ?? '').trim()) {
            ;(next as any)[k] = v
            got.push(name)
          }
        }
        take('title', r.title, 'title')
        take('date', r.date, 'date')
        take('start_time', r.start_time, 'start_time')
        take('end_time', r.end_time, 'end_time')
        take('venue_name', r.venue_name, 'venue_name')
        take('address', r.address, 'address')
        take('city', r.city, 'city')
        if (next.free === null && r.price_type !== 'unknown') {
          next.free = r.price_type === 'free'
          if (r.price_type === 'paid' && r.price && !next.price) next.price = String(r.price)
          if (r.currency && !next.currency) next.currency = r.currency
          got.push('price')
        }
        return next
      })
      setFilled(got)
    } catch {
      /* the member fills it in */
    } finally {
      setReading(false)
    }
  }

  async function send() {
    if (!image || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/community/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: image,
          source_url: form.source_url,
          organizer_name: form.organizer_name,
          organizer_handle: form.organizer_handle,
          note: form.note,
          details: {
            title: form.title,
            date: form.date,
            start_time: form.start_time,
            end_time: form.end_time,
            venue_name: form.venue_name,
            address: form.address,
            city: form.city,
            country: form.country,
            free: form.free,
            price: form.price,
            currency: form.currency,
            ticket_url: form.ticket_url,
            category: form.category,
          },
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const code = String(body?.code || '')
        setError(t(`community.share.errors.${['rate_limited', 'bad_image', 'forbidden'].includes(code) ? code : 'generic'}`))
        return
      }
      setSentResult(body?.status === 'published' && body?.eventId ? { status: 'published', eventId: String(body.eventId) } : { status: 'pending' })
      setSent(true)
    } catch {
      setError(t('community.share.errors.generic'))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div>
        <h1 className="font-display italic lowercase !text-[clamp(28px,4vw,40px)] !leading-[1.04] text-fg">{t('community.share.title')}</h1>
        <p className="mt-6 flex items-center gap-2 text-body text-fg">
          <Check className="h-4 w-4 text-brand-400" aria-hidden />
          {sentResult?.status === 'published' ? t('community.share.live') : t('community.share.review')}
        </p>
        <p className="mt-2 text-meta text-fg-muted">
          {sentResult?.status === 'published' && sentResult.eventId ? (
            <Link href={`/events/${encodeURIComponent(sentResult.eventId)}`} className="font-semibold text-fg underline underline-offset-4">
              {t('community.share.see_event')}
            </Link>
          ) : null}
          {sentResult?.status === 'published' ? ' · ' : null}
          <Link href="/share-event/mine" className="font-semibold text-fg underline underline-offset-4">
            {t('community.share.mine')}
          </Link>
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY)
              setImage(null)
              setFilled(null)
              setSent(false)
              setSentResult(null)
            }}
            className="h-10 rounded bg-surface px-4 text-meta font-semibold text-fg hover:bg-surface-high"
          >
            {t('community.share.another')}
          </button>
          <Link href="/discover" className="inline-flex h-10 items-center rounded px-4 text-meta font-semibold text-fg-muted hover:text-fg">
            {t('community.share.done')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 font-display italic lowercase !text-[clamp(28px,4vw,40px)] !leading-[1.04] text-fg">{t('community.share.title')}</h1>

      <div className="space-y-6">
        <Step n={1} title={t('community.share.steps.flyer')}>
          <div className="max-w-[240px]">
            <ImageUpload
              variant="flyer"
              library={false}
              currentImage={image}
              onImageUploaded={(url) => {
                setImage(url)
                void readFlyer(url)
              }}
            />
          </div>
          {reading && <p className="text-meta text-fg-subtle">{t('community.share.reading')}</p>}
          {filled && !reading && (
            <p className="text-meta text-fg-subtle">{filled.length ? t('community.share.filled') : t('community.share.nothing_read')}</p>
          )}
          <div>
            <label className={label} htmlFor="se-title">{t('community.share.fields.title')}</label>
            <input id="se-title" className={field} value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />
          </div>
        </Step>

        <Step n={2} title={t('community.share.steps.when_where')}>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 sm:col-span-1">
              <label className={label} htmlFor="se-date">{t('community.share.fields.date')}</label>
              <input id="se-date" type="date" className={field} value={form.date} onChange={(e) => set('date', e.target.value)} />
            </div>
            <div className="col-span-3 grid grid-cols-2 gap-2 sm:col-span-2">
              <div>
                <label className={label} htmlFor="se-start">{t('community.share.fields.start')}</label>
                <input id="se-start" type="time" className={field} value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="se-end">{t('community.share.fields.end')}</label>
                <input id="se-end" type="time" className={field} value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
              </div>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="se-venue">{t('community.share.fields.venue')}</label>
            <input id="se-venue" className={field} value={form.venue_name} maxLength={120} onChange={(e) => set('venue_name', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="se-city">{t('community.share.fields.city')}</label>
              <input id="se-city" className={field} value={form.city} maxLength={80} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="se-country">{t('community.share.fields.country')}</label>
              <select id="se-country" className={field} value={form.country} onChange={(e) => set('country', e.target.value as Form['country'])}>
                <option value="">{t('community.share.not_sure')}</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{t(`community.share.countries.${c}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </Step>

        <Step n={3} title={t('community.share.steps.tickets')}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('community.share.steps.tickets')}>
            <button type="button" className={chip(form.free === true)} onClick={() => set('free', form.free === true ? null : true)}>
              {t('community.share.free')}
            </button>
            <button type="button" className={chip(form.free === false)} onClick={() => set('free', form.free === false ? null : false)}>
              {t('community.share.paid')}
            </button>
          </div>
          {form.free === false && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor="se-price">{t('community.share.fields.price')}</label>
                <input id="se-price" inputMode="decimal" className={field} value={form.price} onChange={(e) => set('price', e.target.value.replace(/[^\d.,]/g, ''))} />
              </div>
              <div>
                <label className={label} htmlFor="se-currency">{t('community.share.fields.currency')}</label>
                <select id="se-currency" className={field} value={form.currency} onChange={(e) => set('currency', e.target.value as Form['currency'])}>
                  <option value="">{t('community.share.not_sure')}</option>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className={label} htmlFor="se-tickets">{t('community.share.fields.ticket_url')}</label>
            <input id="se-tickets" type="url" inputMode="url" placeholder="https://" className={field} value={form.ticket_url} onChange={(e) => set('ticket_url', e.target.value)} />
          </div>
          <div>
            <span className={label}>{t('community.share.fields.category')}</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.filter((c) => c !== 'Other').map((c) => (
                <button key={c} type="button" className={chip(form.category === c)} onClick={() => set('category', form.category === c ? '' : c)}>
                  {t(`categories.${c}`, { defaultValue: c })}
                </button>
              ))}
            </div>
          </div>
        </Step>

        <Step n={4} title={t('community.share.steps.source')}>
          <div>
            <label className={label} htmlFor="se-source">{t('community.share.fields.source_url')}</label>
            <input id="se-source" type="url" inputMode="url" placeholder="https://instagram.com/p/…" className={field} value={form.source_url} onChange={(e) => set('source_url', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="se-org">{t('community.share.fields.organizer')}</label>
              <input id="se-org" className={field} value={form.organizer_name} maxLength={120} onChange={(e) => set('organizer_name', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="se-handle">{t('community.share.fields.handle')}</label>
              <input id="se-handle" className={field} placeholder="@" value={form.organizer_handle} maxLength={42} onChange={(e) => set('organizer_handle', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="se-note">{t('community.share.fields.note')}</label>
            <textarea id="se-note" rows={3} className={field} value={form.note} maxLength={500} onChange={(e) => set('note', e.target.value)} />
          </div>
        </Step>

        <div className="border-t border-line pt-5">
          {error && <p className="mb-3 text-meta text-danger-soft">{error}</p>}
          <button
            type="button"
            disabled={!image || sending}
            onClick={send}
            className="h-10 w-full rounded bg-inverse text-meta font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? t('community.share.sending') : t('community.share.send')}
          </button>
          <p className="mt-3 text-center text-xs text-fg-subtle">{t('community.share.footnote')}</p>
        </div>
      </div>
    </div>
  )
}
