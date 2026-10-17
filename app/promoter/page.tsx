// The promoter portal: every promoter record this account has claimed, across all
// events, with lifetime totals per currency. A promoter who never signs up loses
// nothing — each tokenized stats page keeps working on its own.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers, cookies } from 'next/headers'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { promoterTokenFor } from '@/lib/promoters'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import PromoterWalletCard from './PromoterWalletCard'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Promoter portal · Tikèm',
  robots: { index: false, follow: false },
}

function fmtMoney(cents: number, currency: string): string {
  return `${(Math.round(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

// Server component — no useTranslation() hook available, so the reader's
// language is resolved from the same i18nextLng cookie the client writes
// (see app/layout.tsx) and copy is picked from a small inline map.
type Lang = 'en' | 'fr' | 'ht'

const COPY: Record<Lang, {
  eyebrow: string
  title: string
  commissionEarned: (count: number) => string
  emptyTitle: string
  emptyDesc: string
  owesYou: string
  active: string
  paused: string
  tickets: string
  sales: string
  commission: string
  openStatsPage: string
  footerNote: string
  defaultOrganizerName: string
  defaultEventTitle: string
}> = {
  en: {
    eyebrow: 'Promoter portal',
    title: 'Everything you promote',
    commissionEarned: (count) => `Commission earned · ${count} ticket${count !== 1 ? 's' : ''}`,
    emptyTitle: 'Nothing here yet.',
    emptyDesc:
      'When an organizer makes you a promoter, they send you a personal stats link. Open it and choose “add to my account” and it will show up here.',
    owesYou: 'owes you',
    active: 'Active',
    paused: 'Paused',
    tickets: 'Tickets',
    sales: 'Sales',
    commission: 'Commission',
    openStatsPage: 'Open stats page',
    footerNote:
      "New commission collects in your wallet above and unlocks when each event's funds release. Amounts earned before wallets launched are settled with you directly by the organizer.",
    defaultOrganizerName: 'Organizer',
    defaultEventTitle: 'Event',
  },
  fr: {
    eyebrow: 'Portail promoteur',
    title: 'Tout ce que vous promouvez',
    commissionEarned: (count) => `Commission gagnée · ${count} billet${count !== 1 ? 's' : ''}`,
    emptyTitle: 'Rien ici pour l’instant.',
    emptyDesc:
      'Quand un organisateur fait de vous un promoteur, il vous envoie un lien personnel de statistiques. Ouvrez-le et choisissez « ajouter à mon compte », il apparaîtra ici.',
    owesYou: 'vous doit',
    active: 'Actif',
    paused: 'En pause',
    tickets: 'Billets',
    sales: 'Ventes',
    commission: 'Commission',
    openStatsPage: 'Ouvrir la page de statistiques',
    footerNote:
      "La nouvelle commission se rassemble dans votre portefeuille ci-dessus et se débloque au versement des fonds de chaque événement. Les montants gagnés avant le lancement des portefeuilles sont réglés directement avec vous par l’organisateur.",
    defaultOrganizerName: 'Organisateur',
    defaultEventTitle: 'Événement',
  },
  ht: {
    eyebrow: 'Pòtay pwomotè',
    title: 'Tout sa w ap fè pwomosyon pou li',
    commissionEarned: (count) => `Komisyon ou fè · ${count} tikè`,
    emptyTitle: 'Poko gen anyen isit la.',
    emptyDesc:
      'Lè yon òganizatè fè w vin pwomotè, li voye ba ou yon lyen estatistik pèsonèl. Ouvri li epi chwazi "ajoute nan kont mwen", l ap parèt isit la.',
    owesYou: 'dwe ou',
    active: 'Aktif',
    paused: 'Sispann',
    tickets: 'Tikè',
    sales: 'Vant',
    commission: 'Komisyon',
    openStatsPage: 'Ouvri paj estatistik la',
    footerNote:
      'Nouvo komisyon rasanble nan wolèt ou anwo a epi li debloke lè lajan chak evènman voye. Kòb ou te fè anvan wolèt yo te la, òganizatè a rekonèt sa dirèkteman avè w.',
    defaultOrganizerName: 'Òganizatè',
    defaultEventTitle: 'Evènman',
  },
}

async function resolveLang(): Promise<Lang> {
  const supported: Lang[] = ['en', 'fr', 'ht']
  const fromCookie = (await cookies()).get('i18nextLng')?.value?.slice(0, 2)
  if (supported.includes(fromCookie as Lang)) return fromCookie as Lang
  return 'en'
}

export default async function PromoterPortalPage() {
  const { user, error } = await requireAuth()
  if (error || !user) redirect('/auth/login?redirect=/promoter')

  const lang = await resolveLang()
  const copy = COPY[lang]

  const snap = await adminDb
    .collection('event_promoters')
    .where('claimed_by_uid', '==', user.id)
    .orderBy('created_at', 'desc')
    .limit(100)
    .get()

  const host = (await headers()).get('host')
  const origin = host ? `https://${host}` : process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'

  const totalsByCurrency: Record<string, { commissionCents: number; ticketsSold: number }> = {}
  const records = await Promise.all(
    snap.docs.map(async (d: any) => {
      const p = d.data()
      const currency = String(p.currency || 'HTG').toUpperCase()
      const bucket = (totalsByCurrency[currency] ||= { commissionCents: 0, ticketsSold: 0 })
      bucket.commissionCents += Number(p.commission_cents) || 0
      bucket.ticketsSold += Number(p.tickets_sold) || 0

      const eventDoc = await adminDb.collection('events').doc(String(p.event_id)).get()
      const event = eventDoc.exists ? (eventDoc.data() as any) : null
      return {
        id: d.id,
        organizerId: String(p.organizer_id || event?.organizer_id || ''),
        eventTitle: String(event?.title || copy.defaultEventTitle),
        code: String(p.code || ''),
        isActive: p.is_active !== false,
        ticketsSold: Number(p.tickets_sold) || 0,
        grossCents: Number(p.gross_cents) || 0,
        commissionCents: Number(p.commission_cents) || 0,
        currency,
        shareUrl: `${origin}/events/${p.event_id}?ref=${encodeURIComponent(String(p.code || ''))}`,
        statsUrl: `/promoter/${encodeURIComponent(promoterTokenFor(String(p.stats_key || '')))}`,
      }
    })
  )

  // Commission is settled PER ORGANIZER, so the portal groups by who owes what.
  // Names come from users/{organizer_id} — event docs don't reliably carry one.
  const organizerIds = Array.from(new Set(records.map((r) => r.organizerId).filter(Boolean)))
  const organizerNames = new Map<string, string>()
  await Promise.all(
    organizerIds.map(async (id) => {
      const doc = await adminDb.collection('users').doc(id).get()
      const u = doc.exists ? (doc.data() as any) : null
      organizerNames.set(id, String(u?.full_name || u?.display_name || u?.email || copy.defaultOrganizerName))
    })
  )

  const byOrganizer = organizerIds.map((id) => {
    const rows = records.filter((r) => r.organizerId === id)
    const owedByCurrency: Record<string, number> = {}
    for (const r of rows) {
      owedByCurrency[r.currency] = (owedByCurrency[r.currency] || 0) + r.commissionCents
    }
    return { id, name: organizerNames.get(id) || copy.defaultOrganizerName, rows, owedByCurrency }
  })
  // Records whose organizer could not be resolved still render, at the end.
  const orphanRows = records.filter((r) => !r.organizerId)
  if (orphanRows.length > 0) {
    byOrganizer.push({ id: 'unknown', name: copy.defaultOrganizerName, rows: orphanRows, owedByCurrency: {} })
  }

  return (
    <div className="min-h-screen bg-black">
      <Navbar user={user as any} isAdmin={false} />

      <main className="max-w-2xl mx-auto px-4 py-8 pb-mobile-nav md:pb-16">
        <header className="mb-8">
          <p className="label-mono text-[11px] uppercase tracking-widest text-white/50 mb-2">
            {copy.eyebrow}
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">
            {copy.title}
          </h1>
        </header>

        <PromoterWalletCard />

        {/* Lifetime totals */}
        {Object.keys(totalsByCurrency).length > 0 && (
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(totalsByCurrency).map(([currency, t]) => (
              <div key={currency} className="rounded-2xl bg-white/[0.055] p-4">
                <p className="text-lg font-bold text-white">{fmtMoney(t.commissionCents, currency)}</p>
                <p className="text-[11px] uppercase tracking-wider text-white/50 mt-1">
                  {copy.commissionEarned(t.ticketsSold)}
                </p>
              </div>
            ))}
          </div>
        )}

        {records.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.055] p-6 text-center">
            <p className="text-white font-semibold">{copy.emptyTitle}</p>
            <p className="text-sm text-white/60 mt-2 leading-relaxed">{copy.emptyDesc}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {byOrganizer.map((group) => (
              <section key={group.id}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-white font-semibold truncate">{group.name}</h2>
                  {Object.keys(group.owedByCurrency).length > 0 && (
                    <p className="text-sm text-white/60 shrink-0">
                      {copy.owesYou}{' '}
                      <span className="text-white font-semibold">
                        {Object.entries(group.owedByCurrency)
                          .map(([currency, cents]) => fmtMoney(cents, currency))
                          .join(' + ')}
                      </span>
                    </p>
                  )}
                </div>
                <div className="space-y-4">
                  {group.rows.map((r) => (
                    <div key={r.id} className="rounded-2xl bg-white/[0.055] p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white font-semibold truncate">{r.eventTitle}</p>
                          <p className="text-xs text-white/50 mt-0.5 font-mono">{r.code}</p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/50 shrink-0">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${r.isActive ? 'bg-emerald-400' : 'bg-white/30'}`}
                          />
                          {r.isActive ? copy.active : copy.paused}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-white font-bold">{r.ticketsSold}</p>
                          <p className="text-[11px] uppercase tracking-wider text-white/50 mt-0.5">{copy.tickets}</p>
                        </div>
                        <div>
                          <p className="text-white font-bold">{fmtMoney(r.grossCents, r.currency)}</p>
                          <p className="text-[11px] uppercase tracking-wider text-white/50 mt-0.5">{copy.sales}</p>
                        </div>
                        <div>
                          <p className="text-white font-bold">{fmtMoney(r.commissionCents, r.currency)}</p>
                          <p className="text-[11px] uppercase tracking-wider text-white/50 mt-0.5">{copy.commission}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex gap-2">
                        <Link
                          href={r.statsUrl}
                          className="flex-1 text-center rounded-full bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/[0.12] transition-colors"
                        >
                          {copy.openStatsPage}
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-white/40 text-center leading-relaxed">{copy.footerNote}</p>
      </main>

      <MobileNavWrapper />
    </div>
  )
}
