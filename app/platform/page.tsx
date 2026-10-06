import Link from 'next/link'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import PosterFilmStrip from '@/components/home/PosterFilmStrip'
import HeroPosterFan from '@/components/platform/HeroPosterFan'
import Reveal from '@/components/ui/Reveal'
import {
  EventPageVignette,
  DiscoverVignette,
  DashboardVignette,
} from '@/components/platform/Vignettes'
import { getCinemaArtworkEvents } from '@/lib/data/events'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'

export const metadata: Metadata = {
  title: 'Platform | Tikèm',
  description:
    'Everything you need to create, promote and sell out events across Haiti and the diaspora, built for organizers.',
}

// Reads auth cookies for the navbar context.
export const dynamic = 'force-dynamic'

// Server component: no react-i18next hooks here. Resolve the reader's
// language the same way app/layout.tsx does (i18nextLng cookie → 2-letter
// code, falling back to Accept-Language then 'en') and pull strings from a
// local dictionary whose shape mirrors the `platform.*` i18n keys.
type Lng = 'en' | 'fr' | 'ht'
async function resolveLanguage(): Promise<Lng> {
  const supported = ['en', 'fr', 'ht'] as const
  const fromCookie = (await cookies()).get('i18nextLng')?.value?.slice(0, 2)
  if (supported.includes(fromCookie as any)) return fromCookie as Lng
  const accept = (await headers()).get('accept-language') || ''
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase()
    if (supported.includes(code as any)) return code as Lng
  }
  return 'en'
}

const DICT: Record<
  Lng,
  {
    heroEyebrow: string
    heroTitle1: string
    heroTitle2: string
    heroSub: string
    ctaStart: string
    ctaDashboard: string
    fanAria: string
    props: { label: string; sub: string }[]
    sections: {
      index: string
      title: string
      blurb: string
      points: { title: string; body: string }[]
    }[]
    signoffTitle: string
    signoffSub: string
    verified: string
    ctaExplore: string
  }
> = {
  en: {
    heroEyebrow: 'For organizers',
    heroTitle1: 'Your event.',
    heroTitle2: 'Sold out.',
    heroSub: 'create the page, reach the crowd, get paid, in Haiti and the diaspora.',
    ctaStart: 'Start organizing',
    ctaDashboard: 'Organizer dashboard',
    fanAria: 'Posters from events on Tikèm',
    props: [
      { label: 'No setup fees', sub: 'Publish your first event free' },
      { label: 'HTG & USD', sub: 'Sell at home and in the diaspora' },
      { label: 'Fast payouts', sub: 'Get paid after your event' },
    ],
    sections: [
      {
        index: '01 Create',
        title: 'a page worthy of the poster',
        blurb:
          'Build a beautiful event page in minutes. Upload the artwork and Tikèm lets it shine. Your event, your look.',
        points: [
          {
            title: 'Flexible tickets',
            body: 'Free RSVPs, paid tiers, early-bird and VIP. Price it however the night calls for.',
          },
          {
            title: 'Built for the culture',
            body: 'Concerts, fêtes, conferences, watch parties. tikèm fits how Haiti goes out.',
          },
          {
            title: 'Live in minutes',
            body: 'No setup fees, no waiting. Publish tonight and start selling tonight.',
          },
        ],
      },
      {
        index: '02 Sell',
        title: 'reach your people',
        blurb:
          'Your event lands on the home feed and in Discover, next to the nights everyone is already watching.',
        points: [
          {
            title: 'Home & diaspora',
            body: 'Get discovered by attendees in Haiti and Haitians abroad, from Miami to New York, Montréal and Paris, in one place.',
          },
          {
            title: 'Made for mobile',
            body: 'Most people buy on their phone. tikèm is fast and clean on every screen.',
          },
          {
            title: 'Social proof',
            body: 'Friends-going and attendee counts help fence-sitters commit and buy.',
          },
        ],
      },
      {
        index: '03 Get paid',
        title: 'money in your account',
        blurb:
          'Sell tickets, scan guests at the door and track every gourde live, then cash out with confidence.',
        points: [
          {
            title: 'Collect payments',
            body: 'Take card and local payments for your tickets, with fees that make sense.',
          },
          {
            title: 'Clear payouts',
            body: 'See exactly what you’ve earned and request a payout after the event settles.',
          },
          {
            title: 'Live dashboard',
            body: 'Track sales, check-ins and your best channels in real time as the night unfolds.',
          },
        ],
      },
    ],
    signoffTitle: 'ready to throw your event?',
    signoffSub: 'Set up your organizer profile and publish your first event today.',
    verified: 'Verified organizers, trusted by attendees',
    ctaExplore: 'Explore events',
  },
  fr: {
    heroEyebrow: 'Pour les organisateurs',
    heroTitle1: 'Votre événement.',
    heroTitle2: 'Complet.',
    heroSub: 'créez la page, touchez le public, encaissez, en Haïti et dans la diaspora.',
    ctaStart: 'Commencer à organiser',
    ctaDashboard: 'Tableau de bord organisateur',
    fanAria: 'Affiches d’événements sur Tikèm',
    props: [
      { label: 'Aucuns frais de départ', sub: 'Publiez votre premier événement gratuitement' },
      { label: 'HTG & USD', sub: 'Vendez au pays et dans la diaspora' },
      { label: 'Paiements rapides', sub: 'Recevez votre argent après l’événement' },
    ],
    sections: [
      {
        index: '01 Créer',
        title: 'une page à la hauteur de l’affiche',
        blurb:
          'Créez une belle page d’événement en quelques minutes. Téléversez votre visuel et Tikèm le met en valeur. Votre événement, votre style.',
        points: [
          {
            title: 'Des billets flexibles',
            body: 'RSVP gratuits, tarifs payants, early-bird et VIP. Fixez les prix comme la soirée l’exige.',
          },
          {
            title: 'Pensé pour la culture',
            body: 'Concerts, fêtes, conférences, soirées d’écoute. Tikèm épouse la façon dont Haïti sort.',
          },
          {
            title: 'En ligne en quelques minutes',
            body: 'Aucuns frais, aucune attente. Publiez ce soir et vendez ce soir.',
          },
        ],
      },
      {
        index: '02 Vendre',
        title: 'touchez votre public',
        blurb:
          'Votre événement apparaît sur le fil d’accueil et dans Découvrir, aux côtés des soirées que tout le monde suit déjà.',
        points: [
          {
            title: 'Au pays et dans la diaspora',
            body: 'Faites-vous découvrir par le public en Haïti et les Haïtiens à l’étranger, de Miami à New York, Montréal et Paris, au même endroit.',
          },
          {
            title: 'Conçu pour le mobile',
            body: 'La plupart des gens achètent sur leur téléphone. tikèm est rapide et net sur chaque écran.',
          },
          {
            title: 'Preuve sociale',
            body: 'Les amis qui y vont et le nombre de participants aident les indécis à se décider et à acheter.',
          },
        ],
      },
      {
        index: '03 Encaisser',
        title: 'l’argent sur votre compte',
        blurb:
          'Vendez des billets, scannez les invités à l’entrée et suivez chaque gourde en direct, puis encaissez en toute confiance.',
        points: [
          {
            title: 'Encaissez les paiements',
            body: 'Acceptez les paiements par carte et locaux pour vos billets, avec des frais qui ont du sens.',
          },
          {
            title: 'Des versements clairs',
            body: 'Voyez exactement ce que vous avez gagné et demandez un versement une fois l’événement clôturé.',
          },
          {
            title: 'Tableau de bord en direct',
            body: 'Suivez les ventes, les entrées et vos meilleurs canaux en temps réel au fil de la soirée.',
          },
        ],
      },
    ],
    signoffTitle: 'prêt à lancer votre événement ?',
    signoffSub: 'Créez votre profil organisateur et publiez votre premier événement dès aujourd’hui.',
    verified: 'Des organisateurs vérifiés, la confiance des participants',
    ctaExplore: 'Explorer les événements',
  },
  ht: {
    heroEyebrow: 'Pou òganizatè yo',
    heroTitle1: 'Evènman ou.',
    heroTitle2: 'Vann nèt.',
    heroSub: 'kreye paj la, rive sou foul la, touche lajan ou, ann Ayiti ak nan dyaspora a.',
    ctaStart: 'Kòmanse òganize',
    ctaDashboard: 'Dashbòd òganizatè',
    fanAria: 'Afich evènman ki sou Tikèm',
    props: [
      { label: 'San frè pou kòmanse', sub: 'Pibliye premye evènman ou gratis' },
      { label: 'HTG & USD', sub: 'Vann lakay ak nan dyaspora a' },
      { label: 'Peman rapid', sub: 'Touche lajan ou apre evènman ou' },
    ],
    sections: [
      {
        index: '01 Kreye',
        title: 'yon paj ki merite afich la',
        blurb:
          'Bati yon bèl paj evènman nan kèk minit. Mete afich ou epi Tikèm fè l briye. Evènman ou, stil ou.',
        points: [
          {
            title: 'Tikè fleksib',
            body: 'RSVP gratis, tikè peye, early-bird ak VIP. Mete pri a jan sware a mande l.',
          },
          {
            title: 'Fèt pou kilti a',
            body: 'Konsè, fèt, konferans, watch party. Tikèm mache jan Ayiti soti.',
          },
          {
            title: 'Anliy nan kèk minit',
            body: 'San frè, san tann. Pibliye aswè a epi kòmanse vann aswè a.',
          },
        ],
      },
      {
        index: '02 Vann',
        title: 'rive sou moun ou yo',
        blurb:
          'Evènman ou parèt sou fil akèy la ak nan Dekouvri, bò kote sware tout moun deja ap gade.',
        points: [
          {
            title: 'Lakay ak dyaspora',
            body: 'Fè moun ann Ayiti ak Ayisyen aletranje jwenn ou, depi Miami rive New York, Monreyal ak Pari, yon sèl kote.',
          },
          {
            title: 'Fèt pou telefòn',
            body: 'Pifò moun achte sou telefòn yo. tikèm rapid e pwòp sou tout ekran.',
          },
          {
            title: 'Prèv sosyal',
            body: 'Zanmi k ap ale ak kantite patisipan ede moun ki ezite deside epi achte.',
          },
        ],
      },
      {
        index: '03 Touche lajan',
        title: 'lajan sou kont ou',
        blurb:
          'Vann tikè, eskane envite yo nan pòt la epi swiv chak goud an dirèk, apre sa retire lajan ou ak konfyans.',
        points: [
          {
            title: 'Kolekte peman',
            body: 'Aksepte kat ak peman lokal pou tikè ou, ak frè ki fè sans.',
          },
          {
            title: 'Peman klè',
            body: 'Wè egzakteman sa ou fè epi mande yon vèsman apre evènman an fini.',
          },
          {
            title: 'Dashbòd an dirèk',
            body: 'Swiv lavant, antre yo ak pi bon kanal ou an tan reyèl pandan sware a ap dewoule.',
          },
        ],
      },
    ],
    signoffTitle: 'pare pou fè evènman ou?',
    signoffSub: 'Mete pwofil òganizatè ou epi pibliye premye evènman ou jodi a.',
    verified: 'Òganizatè verifye, patisipan yo fè yo konfyans',
    ctaExplore: 'Gade evènman yo',
  },
}

/* ------------------------------------------------------------------ */
/* Editorial section: serif-lowercase heading, de-iconed bullets, the  */
/* product vignette across from the words. Everything reveals on       */
/* scroll — copy first, bullets staggered, the phone last.             */
/* ------------------------------------------------------------------ */

function Section({
  index,
  title,
  blurb,
  points,
  vignette,
  flip = false,
}: {
  index: string
  title: string
  blurb: string
  points: { title: string; body: string }[]
  vignette: React.ReactNode
  flip?: boolean
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className={flip ? 'lg:order-2' : ''}>
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
              {index}
            </p>
            <h2 className="mt-2 font-display lowercase italic !text-[clamp(28px,4.5vw,44px)] !leading-[1.02] text-white/90">
              {title}
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/55">{blurb}</p>
          </Reveal>
          <div className="mt-9 space-y-6">
            {points.map((p, i) => (
              <Reveal key={p.title} delay={140 + i * 110}>
                <h3 className="font-grotesk text-[15px] font-semibold text-white">{p.title}</h3>
                <p className="mt-1 max-w-md text-[14px] leading-relaxed text-white/55">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
        <div className={flip ? 'lg:order-1' : ''}>
          <Reveal delay={180}>{vignette}</Reveal>
        </div>
      </div>
    </section>
  )
}

export default async function PlatformPage() {
  const user = await getCurrentUser()
  const t = DICT[await resolveLanguage()]

  // Real artwork for the film strip: recent posters already on the platform —
  // the strongest pitch to an organizer is other organizers' work, lit.
  const artwork = isDemoMode() ? (DEMO_EVENTS as any[]) : await getCinemaArtworkEvents(20)
  const posterPool = artwork
    .filter((e: any) => e?.banner_image_url)
    .slice(0, 17)
    .map((e: any) => ({
      id: String(e.id),
      title: String(e.title || ''),
      // The vignette feed cards print the city under the art. It replaced an
      // invented "N going" figure, which stopped being harmless the moment
      // the poster beside it belonged to a real organizer.
      city: String(e.city || ''),
      // Formatted here, on the server, where the currency lives. Undefined
      // when the event has no price — the vignette then prints no price line
      // rather than an invented one.
      price:
        Number(e.ticket_price) > 0
          ? `${Number(e.ticket_price).toLocaleString('en-US')} ${String(e.currency || 'HTG')}`
          : undefined,
      banner_image_url: String(e.banner_image_url),
    }))
  // The hero fan takes the first three posters. With a deep pool the strip
  // runs on the rest so artwork doesn't repeat in one viewport; with thin
  // inventory they share posters — a lit wall beats an empty one.
  const fanEvents = posterPool.slice(0, 3)
  /**
   * The three phone mockups were filled with flat gradient rectangles — the
   * owner's report was that they "show without any posters, they just show the
   * cards". They take real artwork now, from the pool this page already loads.
   *
   * The feed is handed a rotated slice so its ten cards do not open with the
   * same three posters the event-page phone is already showing a screen
   * earlier. With a thin pool they overlap again, which is the same trade the
   * fan and the strip already make above: a lit wall beats an empty one.
   */
  const vignetteEventPosters = posterPool
  const vignetteFeedPosters = [...posterPool.slice(3), ...posterPool.slice(0, 3)]
  const stripEvents =
    posterPool.length >= 7 ? posterPool.slice(3, 17) : posterPool.slice(0, 14)

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      {/* HERO — poster voice (uppercase lives here only) + one serif line,
          with real artwork fanning out across the right half. The copy
          rises in on load, line by line; the fan follows and then floats. */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20 lg:grid-cols-[1.1fr,0.9fr] lg:gap-16 lg:px-8">
        <div>
          <p
            className="plt-enter text-[11px] font-medium uppercase tracking-[0.14em] text-white/40"
            style={{ ['--d' as any]: '0s' }}
          >
            {t.heroEyebrow}
          </p>
          <h1
            className="plt-enter mt-4 font-grotesk font-bold uppercase !leading-[1.02] tracking-tight text-white !text-[clamp(40px,7vw,88px)]"
            style={{ ['--d' as any]: '0.08s' }}
          >
            {t.heroTitle1}
            <br />
            {t.heroTitle2}
          </h1>
          <p
            className="plt-enter mt-5 max-w-xl font-display lowercase italic !text-[clamp(19px,2.6vw,26px)] !leading-snug text-white/70"
            style={{ ['--d' as any]: '0.18s' }}
          >
            {t.heroSub}
          </p>
          <div
            className="plt-enter mt-9 flex flex-wrap items-center gap-3"
            style={{ ['--d' as any]: '0.28s' }}
          >
            <Link
              href="/auth/signup"
              className="inline-flex items-center rounded-xl bg-white px-6 py-3 text-sm font-medium text-black transition-colors duration-200 hover:bg-white/90"
            >
              {t.ctaStart}
            </Link>
            <Link
              href="/organizer"
              className="inline-flex items-center rounded-xl border border-white/12 px-6 py-3 text-sm font-normal text-white/80 transition-colors duration-200 hover:border-white/25 hover:text-white"
            >
              {t.ctaDashboard}
            </Link>
          </div>
        </div>
        {fanEvents.length === 3 && (
          <div className="hidden lg:block">
            <HeroPosterFan events={fanEvents} fanAriaLabel={t.fanAria} />
          </div>
        )}
      </section>

      {/* The room, lit by real organizers' posters — every one links to its
          event. This is the pitch: your artwork belongs on this wall. */}
      <PosterFilmStrip events={stripEvents} />

      {/* Value props — a quiet hairline row, not boxes */}
      <section className="mx-auto max-w-6xl px-4 pb-6 pt-10 sm:px-6 sm:pt-12 lg:px-8">
        <div className="grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3">
          {t.props.map((s, i) => (
            <Reveal key={s.label} delay={i * 110}>
              <p className="font-grotesk text-[17px] font-bold text-white">{s.label}</p>
              <p className="mt-1 text-[13px] text-white/55">{s.sub}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 01 — CREATE */}
      <Section
        index={t.sections[0].index}
        title={t.sections[0].title}
        blurb={t.sections[0].blurb}
        points={t.sections[0].points}
        vignette={<EventPageVignette posters={vignetteEventPosters} />}
      />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="hairline" />
      </div>

      {/* 02 — SELL */}
      <Section
        index={t.sections[1].index}
        title={t.sections[1].title}
        blurb={t.sections[1].blurb}
        points={t.sections[1].points}
        vignette={<DiscoverVignette posters={vignetteFeedPosters} />}
        flip
      />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="hairline" />
      </div>

      {/* 03 — GET PAID */}
      <Section
        index={t.sections[2].index}
        title={t.sections[2].title}
        blurb={t.sections[2].blurb}
        points={t.sections[2].points}
        vignette={<DashboardVignette />}
      />

      {/* SIGN-OFF — de-boxed, the editorial close */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <Reveal>
            <h2 className="font-display lowercase italic !text-[clamp(36px,6vw,72px)] !leading-[1.02] text-white">
              {t.signoffTitle}
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/55">
              {t.signoffSub}
            </p>
            <p className="mt-3 flex items-center gap-2 text-[13px] text-white/50">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t.verified}
            </p>
          </Reveal>
          <Reveal delay={220}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/auth/signup"
                className="inline-flex items-center rounded-xl bg-white px-6 py-3 text-sm font-medium text-black transition-colors duration-200 hover:bg-white/90"
              >
                {t.ctaStart}
              </Link>
              <Link
                href="/discover"
                className="inline-flex items-center rounded-xl border border-white/12 px-6 py-3 text-sm font-normal text-white/80 transition-colors duration-200 hover:border-white/25 hover:text-white"
              >
                {t.ctaExplore}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
