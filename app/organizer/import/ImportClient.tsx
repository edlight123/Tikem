'use client'

import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader, SectionHeader } from '@/components/organizer/ui'
import EventbriteSection from './EventbriteSection'
import { buttonPrimary, DoneList, PickList, useWhen, type Created } from './ImportParts'

type Found = { uid: string; title: string; start: string; venue: string; city: string; online: boolean; image: string | null; price: number | null; currency: string | null }

/**
 * Paste a link, see what we found, pick, import as drafts. Then Eventbrite,
 * when the Eventbrite app is configured.
 */
export default function ImportClient({ eventbriteAvailable }: { eventbriteAvailable: boolean }) {
  const { t } = useTranslation('organizer')
  const when = useWhen()
  const [url, setUrl] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Created[] | null>(null)

  const call = async (body: object) => {
    setBusy(true)
    setError('')
    const res = await fetch('/api/organizer/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const d = await res?.json().catch(() => ({}))
    setBusy(false)
    if (!res?.ok) {
      setError(d?.code ? t(`import_page.errors.${d.code}`, { defaultValue: t('import_page.error_generic') }) : t('import_page.error_generic'))
      return null
    }
    return d
  }

  const find = async (e: React.FormEvent) => {
    e.preventDefault()
    setDone(null)
    setFound(null)
    const d = await call({ url: url.trim() })
    if (d?.events) {
      setFound(d.events)
      setPicked(new Set(d.events.map((x: Found) => x.uid)))
    }
  }

  const importNow = async () => {
    const d = await call({ url: url.trim(), uids: [...picked] })
    if (d?.created) setDone(d.created)
  }

  const price = (f: Found) => (f.price == null ? '' : f.price === 0 ? t('import_page.free') : `${f.price} ${f.currency || ''}`.trim())

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <PageHeader eyebrow={t('import_page.eyebrow')} title={t('import_page.title')} subtitle={t('import_page.intro')} />

        <section className="mt-8">
          <SectionHeader title={t('import_page.link_title')} description={t('import_page.link_body')} />
          <form onSubmit={find} className="mt-4 flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t('import_page.link_label')}</span>
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
              <input
                className="h-10 w-full rounded bg-surface pl-9 pr-3 text-base text-fg placeholder:text-fg-faint focus:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.eventbrite.com/e/…"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </label>
            <button type="submit" disabled={busy || !url.trim()} className={buttonPrimary}>
              {busy && !found ? t('import_page.finding') : t('import_page.find')}
            </button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          {done ? (
            <div className="mt-6">
              <DoneList items={done} />
            </div>
          ) : (
            found && (
              <div className="mt-6">
                <PickList
                  items={found.map((f) => ({
                    id: f.uid,
                    title: f.title,
                    meta: [when(f.start), f.online ? t('import_page.online') : f.venue || f.city, price(f)].filter(Boolean).join(' · '),
                  }))}
                  picked={picked}
                  onToggle={(id) => {
                    const n = new Set(picked)
                    if (n.has(id)) n.delete(id)
                    else n.add(id)
                    setPicked(n)
                  }}
                  onAll={() => setPicked(picked.size === found.length ? new Set() : new Set(found.map((f) => f.uid)))}
                />
                <button type="button" onClick={importNow} disabled={busy || picked.size === 0} className={`${buttonPrimary} mt-4 w-full`}>
                  {busy ? t('import_page.importing') : t('import_page.import_drafts', { count: picked.size })}
                </button>
              </div>
            )
          )}
        </section>

        {eventbriteAvailable && <EventbriteSection />}
      </div>
    </div>
  )
}
