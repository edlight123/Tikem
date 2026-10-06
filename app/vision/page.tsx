import Link from 'next/link'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import Reveal from '@/components/ui/Reveal'

export const metadata: Metadata = {
  title: 'Vision | Tikèm',
  description:
    'Why Tikèm exists: one place for how Haiti goes out, in Haiti and everywhere Haitians are.',
}

export const dynamic = 'force-dynamic'

// Server component, so no react-i18next hooks. Resolve the reader's language
// the way app/layout.tsx does and read from a local dictionary, matching how
// app/platform/page.tsx handles its own copy.
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

type Copy = {
  heroEyebrow: string
  heroTitle1: string
  heroTitle2: string
  heroSub: string
  ctaExplore: string
  ctaCreate: string
  /** The thing that is wrong today, stated plainly. */
  problemHead: string
  problemBody: string[]
  principlesEyebrow: string
  /** Each carries its Kreyòl name, because that is the point of them. */
  principles: { kreyol: string; gloss: string; body: string }[]
  citiesHead: string
  citiesBody: string
  cities: string[]
  closingKreyol: string
  closingGloss: string
  closingBody: string
}

const DICT: Record<Lng, Copy> = {
  en: {
    heroEyebrow: 'Our vision',
    heroTitle1: 'One place',
    heroTitle2: 'for how Haiti goes out.',
    heroSub: 'an Ayiti, ak toupatou Ayisyen ye.',
    ctaExplore: 'See what’s on',
    ctaCreate: 'Put on an event',
    problemHead: 'the flyer disappears',
    problemBody: [
      'A night in Pétion-Ville lives as a JPEG in a WhatsApp status. It is beautiful, it is everywhere for about a day, and then it is gone. If you missed it, you missed it.',
      'Cash changes hands at the door and nobody has a record of it. The promoter who filled the room cannot prove she filled it. The cousin in Montréal never knew the night existed.',
      'None of that is a technology problem waiting for a foreign platform to notice Haiti. It is a problem that has to be built for from the inside.',
    ],
    principlesEyebrow: 'What we hold to',
    principles: [
      {
        kreyol: 'Kreyòl se pa yon tradiksyon',
        gloss: 'Kreyòl is not a translation',
        body: 'Most software arrives in Haiti in English, with French offered as a courtesy and Kreyòl not offered at all. Tikèm is written in three languages from one source. Every screen, every email, every ticket. Kreyòl is a first language of this product, not a setting.',
      },
      {
        kreyol: 'Nou peye jan Ayiti peye',
        gloss: 'We pay the way Haiti pays',
        body: 'Cards are not how most of Haiti buys anything. MonCash is. A platform that starts from a card processor and bolts the rest on will always treat the gourde as an exception. We started at MonCash and the gourde, and added cards for the diaspora, in that order.',
      },
      {
        kreyol: 'Lakay ak dyaspora sou menm kat la',
        gloss: 'Home and the diaspora on one map',
        body: 'A night at Yanvalou in Pacot and a night in Little Haiti belong in the same feed. The diaspora is not a separate market to be sold to later. It is the same people, the same music, one weekend apart, and a platform for Haiti that ignores Miami is not a platform for Haiti.',
      },
      {
        kreyol: 'Lajan an se pou òganizatè a',
        gloss: 'The money belongs to the organizer',
        body: 'A fee you can read before you publish, and a cap per ticket so a gala does not pay a percentage forever. You see what you will receive, in your own currency, while you are still setting the price. Nothing about getting paid should be a surprise.',
      },
      {
        kreyol: 'Kilti a se pwodwi a',
        gloss: 'The culture is the product',
        body: 'Not "events" in the abstract. Konpa, rasin, rabòday, twoubadou, kilti, espò. We named the categories the way people name their night out, in Kreyòl, because a category list is a small claim about whose world this is built for.',
      },
    ],
    citiesHead: 'where that is',
    citiesBody:
      'Six cities to start, chosen because they are where Haitians already are on a Friday night.',
    cities: ['Port-au-Prince', 'Cap-Haïtien', 'Miami', 'New York', 'Montréal', 'Paris'],
    closingKreyol: 'Nou wè aswè a.',
    closingGloss: 'see you tonight',
    closingBody:
      'If you run nights, we would rather build this with you than at you. Put on an event and tell us what is missing.',
  },
  fr: {
    heroEyebrow: 'Notre vision',
    heroTitle1: 'Un seul endroit',
    heroTitle2: 'pour la façon dont Haïti sort.',
    heroSub: 'an Ayiti, ak toupatou Ayisyen ye.',
    ctaExplore: 'Voir ce qui se passe',
    ctaCreate: 'Organiser un événement',
    problemHead: 'l’affiche disparaît',
    problemBody: [
      'Une soirée à Pétion-Ville vit sous forme de JPEG dans un statut WhatsApp. Elle est belle, elle est partout pendant une journée, puis elle n’existe plus. Si vous l’avez manquée, c’est manqué.',
      'L’argent passe de main en main à l’entrée et personne n’en garde la trace. La promotrice qui a rempli la salle ne peut pas le prouver. Le cousin à Montréal n’a jamais su que la soirée existait.',
      'Rien de tout cela n’est un problème technique qui attend qu’une plateforme étrangère remarque Haïti. C’est un problème qu’il faut construire de l’intérieur.',
    ],
    principlesEyebrow: 'Ce à quoi nous tenons',
    principles: [
      {
        kreyol: 'Kreyòl se pa yon tradiksyon',
        gloss: 'Le kreyòl n’est pas une traduction',
        body: 'La plupart des logiciels arrivent en Haïti en anglais, le français offert par politesse et le kreyòl pas du tout. Tikèm est écrit en trois langues depuis une seule source. Chaque écran, chaque email, chaque billet. Le kreyòl est une langue première de ce produit, pas un réglage.',
      },
      {
        kreyol: 'Nou peye jan Ayiti peye',
        gloss: 'Nous payons comme Haïti paie',
        body: 'La carte bancaire n’est pas la façon dont la majorité d’Haïti achète quoi que ce soit. MonCash l’est. Une plateforme qui part d’un processeur de cartes traitera toujours la gourde comme une exception. Nous avons commencé par MonCash et la gourde, puis ajouté les cartes pour la diaspora, dans cet ordre.',
      },
      {
        kreyol: 'Lakay ak dyaspora sou menm kat la',
        gloss: 'Le pays et la diaspora sur une même carte',
        body: 'Une soirée au Yanvalou à Pacot et une soirée à Little Haiti appartiennent au même fil. La diaspora n’est pas un marché séparé à vendre plus tard. C’est le même peuple, la même musique, à un week-end d’écart, et une plateforme pour Haïti qui ignore Miami n’est pas une plateforme pour Haïti.',
      },
      {
        kreyol: 'Lajan an se pou òganizatè a',
        gloss: 'L’argent appartient à l’organisateur',
        body: 'Des frais lisibles avant de publier, et un plafond par billet pour qu’un gala ne paie pas un pourcentage à l’infini. Vous voyez ce que vous recevrez, dans votre monnaie, pendant que vous fixez encore le prix. Rien, dans le fait d’être payé, ne devrait surprendre.',
      },
      {
        kreyol: 'Kilti a se pwodwi a',
        gloss: 'La culture est le produit',
        body: 'Pas « les événements » dans l’abstrait. Konpa, rasin, rabòday, twoubadou, kilti, espò. Nous avons nommé les catégories comme on nomme sa soirée, en kreyòl, parce qu’une liste de catégories dit déjà pour qui tout cela est construit.',
      },
    ],
    citiesHead: 'où cela se passe',
    citiesBody:
      'Six villes pour commencer, choisies parce que c’est là que les Haïtiens sont déjà un vendredi soir.',
    cities: ['Port-au-Prince', 'Cap-Haïtien', 'Miami', 'New York', 'Montréal', 'Paris'],
    closingKreyol: 'Nou wè aswè a.',
    closingGloss: 'à ce soir',
    closingBody:
      'Si vous organisez des soirées, nous préférons construire ceci avec vous. Organisez un événement et dites-nous ce qui manque.',
  },
  ht: {
    heroEyebrow: 'Vizyon nou',
    heroTitle1: 'Yon sèl kote',
    heroTitle2: 'pou jan Ayiti soti.',
    heroSub: 'an Ayiti, ak toupatou Ayisyen ye.',
    ctaExplore: 'Gade sa k ap fèt',
    ctaCreate: 'Fè yon evènman',
    problemHead: 'afich la disparèt',
    problemBody: [
      'Yon sware Petyonvil ap viv kòm yon JPEG nan yon estati WhatsApp. Li bèl, li toupatou pandan yon jounen, epi li ale. Si w te rate l, ou rate l.',
      'Lajan pase men ak men nan pòt la epi pèsonn pa gen yon trak li. Pwomotè ki te plen sal la pa ka pwouve li te plen l. Kouzen an Monreyal pa t janm konnen sware a te egziste.',
      'Anyen nan sa a pa yon pwoblèm teknoloji k ap tann yon platfòm etranje remake Ayiti. Se yon pwoblèm ou dwe bati depi anndan.',
    ],
    principlesEyebrow: 'Sa nou kenbe',
    principles: [
      {
        kreyol: 'Kreyòl se pa yon tradiksyon',
        gloss: 'Kreyòl is not a translation',
        body: 'Pifò lojisyèl rive ann Ayiti an anglè, franse bay kòm yon politès, epi kreyòl pa bay menm. Tikèm ekri nan twa lang depi yon sèl sous. Chak ekran, chak imel, chak tikè. Kreyòl se yon premye lang pwodwi sa a, se pa yon paramèt.',
      },
      {
        kreyol: 'Nou peye jan Ayiti peye',
        gloss: 'We pay the way Haiti pays',
        body: 'Kat bankè se pa jan pifò moun ann Ayiti achte anyen. MonCash se sa. Yon platfòm ki kòmanse ak yon pwosesè kat ap toujou trete goud la tankou yon eksepsyon. Nou kòmanse ak MonCash ak goud la, epi nou ajoute kat pou dyaspora a, nan lòd sa a.',
      },
      {
        kreyol: 'Lakay ak dyaspora sou menm kat la',
        gloss: 'Home and the diaspora on one map',
        body: 'Yon sware nan Yanvalou Pacot ak yon sware nan Little Haiti nan menm fil la. Dyaspora a se pa yon mache apa pou vann pita. Se menm pèp la, menm mizik la, yon wikenn apa, epi yon platfòm pou Ayiti ki inyore Miami se pa yon platfòm pou Ayiti.',
      },
      {
        kreyol: 'Lajan an se pou òganizatè a',
        gloss: 'The money belongs to the organizer',
        body: 'Yon frè ou ka li anvan w pibliye, ak yon plafon pa tikè pou yon gala pa peye yon pousantaj san rete. Ou wè sa w ap resevwa, nan pwòp lajan w, pandan w ap toujou mete pri a. Anyen nan touche lajan w pa ta dwe yon sipriz.',
      },
      {
        kreyol: 'Kilti a se pwodwi a',
        gloss: 'The culture is the product',
        body: 'Se pa "evènman" nan abstrè. Konpa, rasin, rabòday, twoubadou, kilti, espò. Nou nonmen kategori yo jan moun nonmen sware yo, an kreyòl, paske yon lis kategori se deja yon ti deklarasyon sou pou kiyès bagay sa a bati.',
      },
    ],
    citiesHead: 'kote sa ye',
    citiesBody:
      'Sis vil pou kòmanse, chwazi paske se la Ayisyen deja ye yon vandredi swa.',
    cities: ['Pòtoprens', 'Okap', 'Miami', 'New York', 'Monreyal', 'Pari'],
    closingKreyol: 'Nou wè aswè a.',
    closingGloss: 'see you tonight',
    closingBody:
      'Si w fè sware, nou pito bati sa a avèk ou pase sou ou. Fè yon evènman epi di nou sa ki manke.',
  },
}

export default async function VisionPage() {
  const lng = await resolveLanguage()
  const c = DICT[lng]
  const user = await getCurrentUser()

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      {/* ── Hero. One claim, in the grotesk, with the Kreyòl line underneath in
             the editorial serif. Teal appears once on this page, on the rule
             below the eyebrow, and nowhere else. ── */}
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24 lg:px-8">
        <p className="!text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
          {c.heroEyebrow}
        </p>
        <span aria-hidden className="mt-3 block h-px w-10 bg-brand-400" />
        <h1 className="mt-6 max-w-4xl font-grotesk font-bold uppercase !text-[clamp(38px,7vw,84px)] !leading-[1.01] tracking-tight text-white">
          {c.heroTitle1}
          <br />
          {c.heroTitle2}
        </h1>
        <p className="mt-6 font-display lowercase italic !text-[clamp(18px,2.6vw,26px)] !leading-snug text-white/60">
          {c.heroSub}
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/discover"
            className="inline-flex min-h-11 items-center rounded-xl bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90"
          >
            {c.ctaExplore}
          </Link>
          <Link
            href="/create"
            className="inline-flex min-h-11 items-center rounded-xl border border-white/12 px-6 py-3 text-sm font-normal text-white/80 transition-colors hover:bg-white/[0.05] hover:text-white"
          >
            {c.ctaCreate}
          </Link>
        </div>
      </section>

      {/* ── The problem, said plainly and without a diagram. ── */}
      <Reveal>
        <section className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display lowercase italic !text-[clamp(26px,4vw,40px)] !leading-[1.05] text-white/90">
              {c.problemHead}
            </h2>
            <div className="mt-7 max-w-[62ch] space-y-5">
              {c.problemBody.map((p, i) => (
                <p
                  key={i}
                  className={
                    i === 0
                      ? '!text-[17px] !leading-relaxed text-white/75 sm:!text-[19px]'
                      : '!text-[15px] !leading-relaxed text-white/55'
                  }
                >
                  {p}
                </p>
              ))}
            </div>
          </div>
        </section>
      </Reveal>

      {/* ── The principles. Each one leads with its Kreyòl name, because that
             is the substance of the claim, not decoration on top of it. ── */}
      <Reveal>
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <p className="!text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
            {c.principlesEyebrow}
          </p>
          {/* Reveal is NOT used per item here: it renders a <div>, and
              <ol><div><li> is invalid nesting. The section reveals as a whole
              instead. */}
          <ol className="mt-10 space-y-px overflow-hidden rounded-2xl bg-white/[0.03]">
            {c.principles.map((p, i) => (
              <li key={p.kreyol} className="border-b border-white/[0.06] p-6 last:border-b-0 sm:p-8">
                  <div className="flex gap-5 sm:gap-8">
                    <span
                      aria-hidden
                      className="shrink-0 pt-1 font-mono text-[12px] tabular-nums text-white/25"
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-grotesk !text-[19px] font-bold leading-tight text-white sm:!text-[22px]">
                        {p.kreyol}
                      </h3>
                      {/* The gloss sits under the Kreyòl, quieter, so a reader
                          who needs it has it and a reader who doesn't isn't
                          talked down to. */}
                      <p className="mt-1 font-display lowercase italic !text-[15px] text-white/45">
                        {p.gloss}
                      </p>
                      <p className="mt-4 max-w-[60ch] !text-[15px] !leading-relaxed text-white/60">
                        {p.body}
                      </p>
                    </div>
                  </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      </Reveal>

      {/* ── Where. Six names, set large, no map graphic. ── */}
      <Reveal>
        <section className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display lowercase italic !text-[clamp(26px,4vw,40px)] !leading-[1.05] text-white/90">
              {c.citiesHead}
            </h2>
            <p className="mt-4 max-w-[58ch] !text-[15px] !leading-relaxed text-white/55">
              {c.citiesBody}
            </p>
            <ul className="mt-9 flex flex-wrap gap-x-8 gap-y-3">
              {c.cities.map((city) => (
                <li
                  key={city}
                  className="font-grotesk !text-[clamp(20px,3.4vw,34px)] font-bold uppercase !leading-none tracking-tight text-white/80"
                >
                  {city}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </Reveal>

      {/* ── Close on the sign-off the rest of the site uses. ── */}
      <Reveal>
        <section className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <h2 className="font-grotesk font-bold uppercase !text-[clamp(30px,5.5vw,60px)] !leading-[1.02] tracking-tight text-white">
              {c.closingKreyol}
            </h2>
            <p className="mt-3 font-display lowercase italic !text-[17px] text-white/45">
              {c.closingGloss}
            </p>
            <p className="mt-7 max-w-[56ch] !text-[15px] !leading-relaxed text-white/60">
              {c.closingBody}
            </p>
            <Link
              href="/create"
              className="mt-9 inline-flex min-h-11 items-center rounded-xl bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              {c.ctaCreate}
            </Link>
          </div>
        </section>
      </Reveal>

      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
