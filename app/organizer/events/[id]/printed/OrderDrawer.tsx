'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CreditCard, Download, ImagePlus, Smartphone, Wallet, X } from 'lucide-react'
import { Drawer, FormField } from '@/components/organizer/ui'
import { quoteBatch, templateSurcharge, type PhysicalTicketsConfig } from '@/lib/physical/config'
import { showBalanceOption } from '@/lib/physical/rules'
import { MAX_LOGOS, OVERRIDE_LIMITS, type Lang, type TicketTemplate } from '@/lib/physical/design/registry'

/**
 * Order a printed batch (lib/physical): choose a ticket design from the
 * gallery, its colour, the artist photo and logos, optional wording; look at
 * the proof (drawn server-side by the SAME code that draws the print PDF) and
 * approve it; then the quantity and the upfront payment. The server refuses
 * an order whose proof was not approved.
 */

export interface BalanceInfo {
  canUse: boolean
  availableHtg: number
}

export interface OrderTier {
  id: string
  name: string
  price: number
  remaining: number | null
}

interface Proof {
  template: string
  color: string
  front: string
  back?: string
}

const field =
  'w-full rounded bg-surface px-4 py-3 text-base text-fg placeholder-fg-faint focus:outline-none focus:ring-2 focus:ring-brand-500/60 sm:text-sm'
const btnPrimary =
  'inline-flex h-10 items-center justify-center gap-2 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'
const btnQuiet =
  'inline-flex h-10 items-center justify-center gap-2 rounded bg-surface-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'

const nf = (n: number) => new Intl.NumberFormat().format(n)

/** The proof SVGs name these families; the files are the ones the print PDF embeds. */
const FONT_FACES = [
  ['TkAnton', 'Anton-Regular.ttf'],
  ['TkSerif', 'InstrumentSerif-Regular.ttf'],
  ['TkSerifItalic', 'InstrumentSerif-Italic.ttf'],
  ['TkSans', 'PlusJakartaSans-Regular.ttf'],
  ['TkSansBold', 'PlusJakartaSans-SemiBold.ttf'],
]
  .map(([family, file]) => `@font-face{font-family:${family};src:url(/api/physical/fonts/${file}) format('truetype');font-display:block}`)
  .join('')

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">
          <span className="mr-2 font-mono text-fg-subtle">{n}</span>
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-caption text-fg-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** Our own server's SVG (user text escaped there), shown inline so it uses the ticket fonts. */
function Svg({ markup, label }: { markup: string; label: string }) {
  return <div role="img" aria-label={label} className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: markup }} />
}

export default function OrderDrawer({
  eventId,
  currency,
  tiers,
  config,
  balance,
  templates,
  posterUrl,
  onClose,
  onPaid,
}: {
  eventId: string
  currency: string
  tiers: OrderTier[]
  config: PhysicalTicketsConfig
  balance: BalanceInfo | null
  templates: TicketTemplate[]
  posterUrl: string | null
  onClose: () => void
  onPaid: () => Promise<void>
}) {
  const { t, i18n } = useTranslation('common')
  const lang: Lang = i18n.language?.startsWith('fr') ? 'fr' : i18n.language?.startsWith('ht') ? 'ht' : 'en'
  const [tierId, setTierId] = useState(tiers[0]?.id || '')
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id || '')
  const template = templates.find((x) => x.id === templateId) || templates[0]
  const [color, setColor] = useState(template?.swatches[0]?.id || '')
  const [photoUrl, setPhotoUrl] = useState<string | null>(posterUrl)
  const [logos, setLogos] = useState<string[]>([])
  const [overrides, setOverrides] = useState({ title: '', priceLine: '', phone: '' })
  const [uploading, setUploading] = useState<'photo' | 'logo' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [proof, setProof] = useState<Proof | null>(null)
  const [proofState, setProofState] = useState<'idle' | 'loading' | 'error'>('loading')
  const [approved, setApproved] = useState(false)
  const [qty, setQty] = useState(String(config.minBatch))
  const [method, setMethod] = useState<'moncash' | 'card' | 'balance'>('moncash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  const design = useMemo(
    () => ({
      template: templateId,
      color,
      photoUrl: template?.usesPhoto ? photoUrl : null,
      logos,
      overrides: Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim())),
    }),
    [templateId, color, template?.usesPhoto, photoUrl, logos, overrides]
  )
  // Anything that changes the print un-approves the proof.
  const designKey = JSON.stringify({ design, tierId })
  useEffect(() => setApproved(false), [designKey])

  const post = useCallback(
    async (body: Record<string, unknown>) =>
      fetch(`/api/organizer/events/${eventId}/physical-batches/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, ...body }),
      }),
    [eventId, tierId]
  )

  // Gallery thumbnails: every template with this event's facts and art.
  const artKey = JSON.stringify({ tierId, photoUrl, logos, overrides })
  useEffect(() => {
    let live = true
    const timer = setTimeout(async () => {
      try {
        const res = await post({ design: { ...design, template: templates[0]?.id, color: undefined, photoUrl }, templates: templates.map((x) => x.id) })
        const data = await res.json()
        if (live && res.ok) setThumbs(Object.fromEntries((data.proofs as Proof[]).map((p) => [p.template, p.front])))
      } catch {
        /* thumbnails are a nicety: the names still show */
      }
    }, 350)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artKey])

  // The proof of the chosen design, front and back.
  useEffect(() => {
    let live = true
    setProofState('loading')
    const timer = setTimeout(async () => {
      try {
        const res = await post({ design, backs: true })
        const data = await res.json()
        if (!live) return
        if (!res.ok) throw new Error(data?.error)
        setProof((data.proofs as Proof[])[0] || null)
        setProofState('idle')
      } catch {
        if (live) setProofState('error')
      }
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designKey])

  const chooseTemplate = (id: string) => {
    const next = templates.find((x) => x.id === id)
    setTemplateId(id)
    if (next && !next.swatches.some((s) => s.id === color)) setColor(next.swatches[0].id)
  }

  const upload = async (file: File | undefined, kind: 'photo' | 'logo') => {
    if (!file) return
    setUploading(kind)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches/upload`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) throw new Error(data?.error || t('print_design.upload_failed'))
      if (kind === 'photo') setPhotoUrl(data.url)
      else setLogos((l) => [...l, data.url].slice(0, MAX_LOGOS))
    } catch (e: any) {
      setUploadError(String(e?.message || t('print_design.upload_failed')))
    } finally {
      setUploading(null)
    }
  }

  const downloadProof = async () => {
    try {
      const res = await post({ design, format: 'pdf', paper: 'letter' })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'tikem-proof.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch {
      setError(t('print_design.proof_error'))
    }
  }

  const quantity = Math.round(Number(qty))
  const quote = useMemo(() => quoteBatch(config, quantity, templateId), [config, quantity, templateId])
  const tier = tiers.find((x) => x.id === tierId)
  const overCapacity = tier?.remaining != null && quantity > tier.remaining
  const balanceShown = quote.ok && showBalanceOption(balance, quote.totalHtg)
  const chosen = method === 'balance' && !balanceShown ? 'moncash' : method

  const quoteError = !quote.ok
    ? quote.code === 'below_minimum'
      ? t('physical.min_batch', { min: nf(config.minBatch) })
      : quote.code === 'above_maximum'
        ? t('physical.max_batch', { max: nf(config.maxBatch) })
        : quote.code === 'disabled'
          ? t('physical.disabled')
          : t('physical.whole_number')
    : overCapacity
      ? t('physical.over_capacity', { remaining: nf(tier!.remaining!) })
      : null

  const submit = async () => {
    if (!quote.ok || overCapacity) return
    if (!approved) {
      setError(t('print_design.approve_required'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, quantity, method: chosen, design, approveProof: approved }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.paid) {
        await onPaid()
        return
      }
      if (!res.ok || !data?.redirectUrl) throw new Error(data?.error || t('physical.generic_error'))
      window.location.href = data.redirectUrl
    } catch (e: any) {
      setError(String(e?.message || t('physical.generic_error')))
      setBusy(false)
    }
  }

  const tierLabel = (x: TicketTemplate) => (x.tier === 'print_shop' ? t('print_design.tier_print_shop') : t('print_design.tier_cybercafe'))
  const colourHint =
    template?.swatchRole === 'stock'
      ? t('print_design.colour_stock_hint')
      : template?.swatchRole === 'background'
        ? t('print_design.colour_background_hint')
        : t('print_design.colour_accent_hint')
  const surcharge = templateSurcharge(config, templateId)

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('physical.order_title')}
      size="xl"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button type="button" className={btnQuiet} onClick={onClose}>
            {t('physical.cancel')}
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !!quoteError || !tierId || !approved} onClick={submit}>
            {quote.ok
              ? chosen === 'balance'
                ? t('physical.pay_from_balance_total', { total: nf(quote.totalHtg) })
                : t('physical.pay_total', { total: nf(quote.totalHtg) })
              : t('physical.pay')}
          </button>
        </div>
      }
    >
      <style>{FONT_FACES}</style>
      <div className="space-y-8 p-5 sm:p-6">
        <p className="text-sm text-fg-muted">{t('print_design.intro')}</p>

        <Step n={1} title={t('physical.ticket_type')}>
          <select id="phys-tier" aria-label={t('physical.ticket_type')} value={tierId} onChange={(e) => setTierId(e.target.value)} className={field}>
            {tiers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.remaining != null ? ` · ${t('physical.left', { count: x.remaining })}` : ''}
              </option>
            ))}
          </select>
        </Step>

        <Step n={2} title={t('print_design.step_design')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {templates.map((x) => {
              const extra = templateSurcharge(config, x.id)
              const selected = x.id === templateId
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseTemplate(x.id)}
                  className={`group min-w-0 rounded bg-surface p-2 text-left transition-colors hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    selected ? 'ring-2 ring-brand-500' : ''
                  }`}
                >
                  <div className="mx-auto aspect-[528/1344] w-full max-w-[150px] overflow-hidden rounded bg-surface-low">
                    {thumbs[x.id] ? <Svg markup={thumbs[x.id]} label={x.name[lang]} /> : <div className="h-full w-full animate-pulse bg-surface-low" />}
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-fg">{x.name[lang]}</p>
                  <p className="truncate text-caption text-fg-subtle">
                    {tierLabel(x)}
                    {extra > 0 ? ` · ${t('print_design.surcharge', { amount: nf(extra) })}` : ''}
                  </p>
                </button>
              )
            })}
          </div>
        </Step>

        {template && (
          <Step n={3} title={t('print_design.step_colour')} hint={colourHint}>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t('print_design.step_colour')}>
              {template.swatches.map((s) => {
                const on = s.id === color
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setColor(s.id)}
                    className={`flex h-10 items-center gap-2 rounded px-2 pr-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      on ? 'bg-surface-high text-fg' : 'bg-surface text-fg-muted hover:bg-surface-raised'
                    }`}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded" style={{ backgroundColor: s.hex }}>
                      {on && <Check className="h-3.5 w-3.5 text-shade" strokeWidth={2.5} />}
                    </span>
                    {s.name[lang]}
                  </button>
                )
              })}
            </div>
          </Step>
        )}

        <Step n={4} title={template?.usesPhoto ? t('print_design.step_art') : t('print_design.step_logos')} hint={t('print_design.art_hint')}>
          {template?.usesPhoto && (
            <div className="flex flex-wrap gap-2">
              {posterUrl && (
                <button type="button" aria-pressed={photoUrl === posterUrl} onClick={() => setPhotoUrl(posterUrl)} className={`${btnQuiet} ${photoUrl === posterUrl ? '!bg-surface-high' : ''}`}>
                  {photoUrl === posterUrl && <Check className="h-4 w-4" strokeWidth={1.75} />}
                  {t('print_design.use_poster')}
                </button>
              )}
              <button type="button" className={btnQuiet} disabled={uploading !== null} onClick={() => photoInput.current?.click()}>
                <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                {uploading === 'photo' ? t('print_design.uploading') : photoUrl && photoUrl !== posterUrl ? t('print_design.replace_photo') : t('print_design.upload_photo')}
              </button>
              {photoUrl && (
                <button type="button" className={btnQuiet} onClick={() => setPhotoUrl(null)}>
                  {t('print_design.no_photo')}
                </button>
              )}
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0], 'photo')} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {logos.map((url, i) => (
              <span key={url} className="inline-flex h-10 items-center gap-2 rounded bg-surface pl-2 pr-1 text-sm text-fg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-7 w-auto max-w-[72px] rounded object-contain" />
                <button
                  type="button"
                  aria-label={t('print_design.remove_logo', { n: i + 1 })}
                  onClick={() => setLogos((l) => l.filter((x) => x !== url))}
                  className="grid h-8 w-8 place-items-center rounded text-fg-subtle hover:bg-surface-raised hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </span>
            ))}
            {logos.length < MAX_LOGOS && (
              <button type="button" className={btnQuiet} disabled={uploading !== null} onClick={() => logoInput.current?.click()}>
                <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                {uploading === 'logo' ? t('print_design.uploading') : t('print_design.add_logo', { max: MAX_LOGOS })}
              </button>
            )}
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0], 'logo')} />
          </div>
          {uploadError && <p className="text-sm text-danger-soft">{uploadError}</p>}
        </Step>

        <Step n={5} title={t('print_design.step_wording')} hint={t('print_design.wording_hint')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('print_design.title_override')} htmlFor="pd-title" className="sm:col-span-2">
              <input id="pd-title" className={field} maxLength={OVERRIDE_LIMITS.title} value={overrides.title} onChange={(e) => setOverrides({ ...overrides, title: e.target.value })} />
            </FormField>
            <FormField label={t('print_design.price_override')} htmlFor="pd-price">
              <input id="pd-price" className={field} maxLength={OVERRIDE_LIMITS.priceLine} value={overrides.priceLine} onChange={(e) => setOverrides({ ...overrides, priceLine: e.target.value })} />
            </FormField>
            <FormField label={t('print_design.phone_override')} htmlFor="pd-phone">
              <input id="pd-phone" className={field} inputMode="tel" maxLength={OVERRIDE_LIMITS.phone} placeholder="+509" value={overrides.phone} onChange={(e) => setOverrides({ ...overrides, phone: e.target.value })} />
            </FormField>
          </div>
        </Step>

        <Step n={6} title={t('print_design.step_proof')} hint={t('print_design.proof_intro')}>
          <div className="rounded bg-surface p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {(['front', 'back'] as const).map((side) => (
                <figure key={side} className="min-w-0">
                  <div className={`aspect-[528/1344] w-full overflow-hidden ${proofState === 'loading' ? 'opacity-60' : ''}`}>
                    {proof?.[side] ? <Svg markup={proof[side]!} label={t(`print_design.${side}`)} /> : <div className="h-full w-full animate-pulse rounded bg-surface-low" />}
                  </div>
                  <figcaption className="mt-2 text-center text-caption text-fg-subtle">{t(`print_design.${side}`)}</figcaption>
                </figure>
              ))}
            </div>
            {proofState === 'error' && <p className="mt-3 text-sm text-danger-soft">{t('print_design.proof_error')}</p>}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-start gap-3 text-sm text-fg">
              <input
                type="checkbox"
                checked={approved}
                disabled={proofState !== 'idle' || !proof}
                onChange={(e) => setApproved(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-500"
              />
              <span>
                {t('print_design.approve')}
                <span className="block text-caption text-fg-subtle">{t('print_design.approve_hint')}</span>
              </span>
            </label>
            <button type="button" className={`${btnQuiet} shrink-0`} disabled={proofState !== 'idle'} onClick={downloadProof}>
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {t('print_design.download_proof')}
            </button>
          </div>
        </Step>

        <Step n={7} title={t('print_design.step_order')}>
          <FormField label={t('physical.quantity')} htmlFor="phys-qty" error={quoteError || undefined}>
            <input
              id="phys-qty"
              type="number"
              inputMode="numeric"
              min={config.minBatch}
              max={config.maxBatch}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={field}
            />
          </FormField>

          <div className="rounded bg-surface p-4">
            <p className="text-caption text-fg-subtle">{t('physical.price_list')}</p>
            <ul className="mt-2 space-y-1">
              {config.tiers.map((tierRow, i) => {
                const next = config.tiers[i + 1]
                const active = quote.ok && quote.tierIndex === i
                return (
                  <li key={tierRow.minQty} className={`flex justify-between text-sm ${active ? 'text-fg' : 'text-fg-subtle'}`}>
                    <span>
                      {next
                        ? t('physical.tier_range', { from: nf(tierRow.minQty), to: nf(next.minQty - 1) })
                        : t('physical.tier_from', { from: nf(tierRow.minQty) })}
                    </span>
                    <span className="font-mono tabular-nums">{t('physical.per_ticket', { price: nf(tierRow.priceHtgPerTicket) })}</span>
                  </li>
                )
              })}
              {surcharge > 0 && (
                <li className="flex justify-between text-sm text-fg-muted">
                  <span>{t('print_design.quote_design', { name: template?.name[lang] || '' })}</span>
                  <span className="font-mono tabular-nums">{t('print_design.surcharge', { amount: nf(surcharge) })}</span>
                </li>
              )}
            </ul>
            {quote.ok && (
              <div className="mt-4 flex items-baseline justify-between bg-surface-raised px-3 py-2">
                <span className="text-sm text-fg-muted">
                  {nf(quote.quantity)} × {nf(quote.unitPriceHtg)} HTG
                </span>
                <span className="font-mono text-lead tabular-nums text-fg">{nf(quote.totalHtg)} HTG</span>
              </div>
            )}
            {quote.ok &&
              Object.entries(quote.display).map(([cur, v]) => (
                <p key={cur} className="mt-1 text-right text-caption text-fg-subtle">
                  ≈ {v.total.toFixed(2)} {cur}
                </p>
              ))}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg-soft">{t('physical.pay_with')}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { id: 'moncash', icon: Smartphone, label: t('physical.method_moncash') },
                  { id: 'card', icon: CreditCard, label: t('physical.method_card') },
                  ...(balanceShown ? [{ id: 'balance', icon: Wallet, label: t('physical.method_balance') }] : []),
                ] as Array<{ id: 'moncash' | 'card' | 'balance'; icon: typeof Wallet; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={chosen === m.id}
                  onClick={() => setMethod(m.id)}
                  className={`flex h-10 items-center gap-2 rounded px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    m.id === 'balance' ? 'col-span-2' : ''
                  } ${chosen === m.id ? 'bg-surface-high text-fg' : 'bg-surface text-fg-muted hover:bg-surface-raised'}`}
                >
                  <m.icon className="h-4 w-4" strokeWidth={1.75} />
                  {m.label}
                </button>
              ))}
            </div>
            {chosen === 'card' && <p className="mt-2 text-caption text-fg-subtle">{t('physical.card_note')}</p>}
            {chosen === 'balance' && balance && (
              <p className="mt-2 text-caption text-fg-subtle">{t('physical.balance_note', { amount: nf(balance.availableHtg) })}</p>
            )}
            {currency !== 'HTG' && <p className="mt-2 text-caption text-fg-subtle">{t('physical.htg_note')}</p>}
          </fieldset>

          <p className="text-caption text-fg-subtle">{t('physical.no_fee_note')}</p>
          {!approved && <p className="text-caption text-fg-subtle">{t('print_design.approve_required')}</p>}
          {error && <p className="text-sm text-danger-soft">{error}</p>}
        </Step>
      </div>
    </Drawer>
  )
}
