// A promoter's own stats page, reachable ONLY with their signed stats token.
//
// This is the link the organizer hands each promoter. Deliberately self-contained:
// no session is consulted, because a promoter needs no account. The URL is the
// credential — `{statsKey}.{HMAC}` — verified before a single document is read
// (lib/promoters.ts). Same discipline as guest ticket pages.

import { notFound } from 'next/navigation'
import { headers, cookies } from 'next/headers'
import { adminDb } from '@/lib/firebase/admin'
import { getPromoterByStatsKey, verifyPromoterToken } from '@/lib/promoters'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import PromoterAccountOffer from './PromoterAccountOffer'
import PromoterShareActions from './PromoterShareActions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Not a page search engines or social previews should ever hold on to.
export const metadata = {
  title: 'Your promoter page · Tikèm',
  robots: { index: false, follow: false },
}

function fmtMoney(cents: number, currency: string): string {
  return `${(Math.round(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

function toIso(value: any): string | null {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  return String(value)
}

// Server component — no useTranslation() hook, so the reader's language is
// resolved from the i18nextLng cookie (see app/layout.tsx) and copy is
// picked from a small inline map. Kreyòl has no dedicated Intl locale tag
// that changes month-name output here, so 'ht' borrows the 'fr' tag — the
// closest available date formatting.
type Lang = 'en' | 'fr' | 'ht'

const DATE_LOCALE: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR', ht: 'fr-FR' }

function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(DATE_LOCALE[lang], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

const COPY: Record<Lang, {
  eyebrow: (code: string) => string
  youEarn: (commissionLabel: string) => string
  commissionPercent: (value: number) => string
  commissionFlat: (amount: string) => string
  defaultEventTitle: string
  yourLinkTitle: string
  linkNote: string
  statTicketsSold: string
  statSalesDriven: string
  statYourCommission: string
  pausedNotice: string
  footerNote: string
}> = {
  en: {
    eyebrow: (code) => `Promoter · ${code}`,
    youEarn: (commissionLabel) => `You earn ${commissionLabel}.`,
    commissionPercent: (value) => `${value}% of sales`,
    commissionFlat: (amount) => `${amount} per ticket`,
    defaultEventTitle: 'Event',
    yourLinkTitle: 'Your personal link',
    linkNote:
      'Every ticket bought through this link counts for you, even when the buyer pays later in the same visit.',
    statTicketsSold: 'Tickets sold',
    statSalesDriven: 'Sales you drove',
    statYourCommission: 'Your commission',
    pausedNotice:
      'This link is currently paused by the organizer. Sales made through it are not being counted right now.',
    footerNote:
      "Your commission collects in a Tikèm wallet and unlocks when the event's funds release. Add this page to a free account to withdraw it to MonCash. Keep this link: it is your personal page, and its numbers update with every sale.",
  },
  fr: {
    eyebrow: (code) => `Promoteur · ${code}`,
    youEarn: (commissionLabel) => `Vous gagnez ${commissionLabel}.`,
    commissionPercent: (value) => `${value} % des ventes`,
    commissionFlat: (amount) => `${amount} par billet`,
    defaultEventTitle: 'Événement',
    yourLinkTitle: 'Votre lien personnel',
    linkNote:
      'Chaque billet acheté via ce lien compte pour vous, même quand l’acheteur paie plus tard au cours de la même visite.',
    statTicketsSold: 'Billets vendus',
    statSalesDriven: 'Ventes générées',
    statYourCommission: 'Votre commission',
    pausedNotice:
      'Ce lien est actuellement en pause par l’organisateur. Les ventes faites via ce lien ne sont pas comptabilisées en ce moment.',
    footerNote:
      "Votre commission se rassemble dans un portefeuille Tikèm et se débloque au versement des fonds de l’événement. Ajoutez cette page à un compte gratuit pour la retirer vers MonCash. Gardez ce lien : c’est votre page personnelle, et ses chiffres se mettent à jour à chaque vente.",
  },
  ht: {
    eyebrow: (code) => `Pwomotè · ${code}`,
    youEarn: (commissionLabel) => `Ou fè ${commissionLabel}.`,
    commissionPercent: (value) => `${value}% nan vant yo`,
    commissionFlat: (amount) => `${amount} pou chak tikè`,
    defaultEventTitle: 'Evènman',
    yourLinkTitle: 'Lyen pèsonèl ou',
    linkNote:
      'Chak tikè ki achte atravè lyen sa a konte pou ou, menm lè achtè a peye pita nan menm vizit la.',
    statTicketsSold: 'Tikè vann',
    statSalesDriven: 'Vant ou fè rive',
    statYourCommission: 'Komisyon ou',
    pausedNotice: 'Òganizatè a sispann lyen sa a kounye a. Vant ki fèt atravè li pa konte kounye a.',
    footerNote:
      'Komisyon ou rasanble nan yon wolèt Tikèm epi li debloke lè lajan evènman an voye. Ajoute paj sa a nan yon kont gratis pou retire l nan MonCash. Konsève lyen sa a: se paj pèsonèl ou, epi chif li yo mete ajou ak chak vant.',
  },
}

async function resolveLang(): Promise<Lang> {
  const supported: Lang[] = ['en', 'fr', 'ht']
  const fromCookie = (await cookies()).get('i18nextLng')?.value?.slice(0, 2)
  if (supported.includes(fromCookie as Lang)) return fromCookie as Lang
  return 'en'
}

export default async function PromoterStatsPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const lang = await resolveLang()
  const copy = COPY[lang]
  const statsKey = verifyPromoterToken(decodeURIComponent(token))
  // A bad signature and a missing record are indistinguishable to the visitor.
  if (!statsKey) notFound()

  const promoter = await getPromoterByStatsKey(statsKey)
  if (!promoter) notFound()

  const eventSnap = await adminDb.collection('events').doc(String(promoter.event_id)).get()
  const event = eventSnap.exists ? (eventSnap.data() as any) : null

  // Build absolute links on the REQUEST host: the apex 308s to www and in-app
  // browsers are unforgiving about cross-host hops.
  const host = (await headers()).get('host')
  const origin = host ? `https://${host}` : process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const shareUrl = `${origin}/events/${promoter.event_id}?ref=${encodeURIComponent(promoter.code)}`

  const currency = String(promoter.currency || event?.currency || 'HTG').toUpperCase()
  const commissionLabel =
    promoter.commission_type === 'flat_per_ticket'
      ? copy.commissionFlat(fmtMoney(Number(promoter.commission_value) || 0, currency))
      : copy.commissionPercent(Number(promoter.commission_value) || 0)

  const stats = [
    { label: copy.statTicketsSold, value: String(Number(promoter.tickets_sold) || 0) },
    { label: copy.statSalesDriven, value: fmtMoney(Number(promoter.gross_cents) || 0, currency) },
    { label: copy.statYourCommission, value: fmtMoney(Number(promoter.commission_cents) || 0, currency) },
  ]

  return (
    <div className="min-h-screen bg-black">
      <Navbar user={null} isAdmin={false} />

      <main className="max-w-2xl mx-auto px-4 py-8 pb-mobile-nav md:pb-16">
        <header className="mb-8">
          <p className="label-mono text-[11px] uppercase tracking-widest text-white/50 mb-2">
            {copy.eyebrow(promoter.code)}
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">
            {promoter.name}
          </h1>
          <p className="text-white/60 mt-2">
            {event?.title || copy.defaultEventTitle}
            {formatDate(toIso(event?.start_datetime), lang) ? `, ${formatDate(toIso(event?.start_datetime), lang)}` : ''}
          </p>
          <p className="text-white/50 text-sm mt-1">{copy.youEarn(commissionLabel)}</p>
        </header>

        {/* The link — the promoter's whole toolkit. */}
        <div className="rounded-2xl bg-white/[0.055] p-5">
          <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{copy.yourLinkTitle}</h2>
          <p className="mt-2 truncate rounded-xl bg-white/[0.07] px-4 py-3 text-sm text-white/70 font-mono">
            {shareUrl}
          </p>
          <PromoterShareActions shareUrl={shareUrl} eventTitle={String(event?.title || copy.defaultEventTitle)} />
          <p className="mt-3 text-xs text-white/40 leading-relaxed">{copy.linkNote}</p>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/[0.055] p-4 text-center">
              <p className="text-lg md:text-xl font-bold text-white">{s.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-white/50 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {promoter.is_active === false && (
          <div className="mt-5 rounded-2xl bg-amber-500/10 px-5 py-4">
            <p className="text-amber-300 text-sm">{copy.pausedNotice}</p>
          </div>
        )}

        <PromoterAccountOffer
          token={decodeURIComponent(token)}
          alreadyClaimed={Boolean(promoter.claimed_by_uid)}
        />

        <p className="mt-8 text-xs text-white/40 text-center leading-relaxed">{copy.footerNote}</p>
      </main>

      <MobileNavWrapper />
    </div>
  )
}
