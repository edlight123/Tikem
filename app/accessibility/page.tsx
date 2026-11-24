import Link from 'next/link'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'

export const dynamic = 'force-dynamic'

/** Date of the last review of this statement. */
const LAST_REVIEWED = '2026-11-23'
const SUPPORT_EMAIL = 'support@tikem.co'

// Server component, so no react-i18next hooks: the reader's language is read
// the way app/layout.tsx does and the copy comes from a local dictionary, as
// on app/vision/page.tsx.
type Lng = 'en' | 'fr' | 'ht'
async function resolveLanguage(): Promise<Lng> {
  const supported = ['en', 'fr', 'ht'] as const
  const fromCookie = (await cookies()).get('i18nextLng')?.value?.slice(0, 2)
  if (supported.includes(fromCookie as Lng)) return fromCookie as Lng
  const accept = (await headers()).get('accept-language') || ''
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase()
    if (supported.includes(code as Lng)) return code as Lng
  }
  return 'en'
}

type Copy = {
  metaTitle: string
  metaDescription: string
  title: string
  intro: string
  worksH: string
  works: string[]
  gapsH: string
  gaps: string[]
  reportH: string
  report: string
  reportForm: string
  reportEmail: string
  reviewed: string
  locale: string
}

const DICT: Record<Lng, Copy> = {
  en: {
    metaTitle: 'Accessibility | Tikèm',
    metaDescription: 'How Tikèm works with screen readers, keyboards, larger text and reduced motion, and how to tell us when something does not.',
    title: 'accessibility',
    intro:
      'Everyone should be able to find an event, buy a ticket and get through the door. We aim for WCAG 2.1 AA on the website and the same standard in the app.',
    worksH: 'What works today',
    works: [
      'Screen readers: every event flyer has a description, written by the organizer or built from the date, place and price.',
      'Keyboard: a skip-to-content link, visible focus, and dialogs that keep focus inside and close with Escape.',
      'Larger text: pages follow your browser zoom and the app follows your phone’s text size, wrapping instead of cutting words off.',
      'Reduced motion: animations calm down when your device asks for less motion.',
      'In the app, Profile > Accessibility adds reduce motion, bolder text and higher contrast.',
    ],
    gapsH: 'Known gaps',
    gaps: [
      'Older flyers are read from their facts, not their artwork.',
      'Maps, embedded videos and card payment forms come from other services and follow their own accessibility.',
    ],
    reportH: 'Tell us',
    report: 'If something gets in your way, tell us what you were trying to do and on which device. We reply within two business days.',
    reportForm: 'Contact support',
    reportEmail: 'or write to',
    reviewed: 'Last reviewed',
    locale: 'en-US',
  },
  fr: {
    metaTitle: 'Accessibilité | Tikèm',
    metaDescription: "Comment Tikèm fonctionne avec les lecteurs d'écran, le clavier, les grands textes et les animations réduites, et comment nous signaler un problème.",
    title: 'accessibilité',
    intro:
      "Tout le monde doit pouvoir trouver un événement, acheter un billet et passer la porte. Nous visons le niveau WCAG 2.1 AA sur le site et la même exigence dans l'app.",
    worksH: "Ce qui fonctionne aujourd'hui",
    works: [
      "Lecteurs d'écran : chaque affiche a une description, écrite par l'organisateur ou construite à partir de la date, du lieu et du prix.",
      'Clavier : un lien pour aller au contenu, un focus visible, et des fenêtres qui gardent le focus et se ferment avec Échap.',
      "Texte agrandi : les pages suivent le zoom du navigateur et l'app suit la taille du texte de votre téléphone, sans couper les mots.",
      'Animations réduites : les animations se calment quand votre appareil demande moins de mouvement.',
      "Dans l'app, Profil > Accessibilité ajoute la réduction des animations, un texte plus gras et un contraste renforcé.",
    ],
    gapsH: 'Limites connues',
    gaps: [
      'Les anciennes affiches sont lues à partir des informations de l’événement, pas de leur image.',
      "Les cartes, les vidéos intégrées et les formulaires de paiement par carte viennent d'autres services et suivent leur propre accessibilité.",
    ],
    reportH: 'Dites-le-nous',
    report: "Si quelque chose vous bloque, dites-nous ce que vous essayiez de faire et sur quel appareil. Nous répondons sous deux jours ouvrés.",
    reportForm: 'Contacter le support',
    reportEmail: 'ou écrivez à',
    reviewed: 'Dernière révision',
    locale: 'fr-FR',
  },
  ht: {
    metaTitle: 'Aksesibilite | Tikèm',
    metaDescription: 'Kijan Tikèm mache ak lektè ekran, klavye, gwo tèks ak mwens animasyon, epi kijan pou di nou lè yon bagay pa mache.',
    title: 'aksesibilite',
    intro:
      'Tout moun dwe kapab jwenn yon evènman, achte yon tikè epi antre. Nou vize nivo WCAG 2.1 AA sou sit la ak menm nivo a nan aplikasyon an.',
    worksH: 'Sa ki mache jodi a',
    works: [
      'Lektè ekran: chak afich gen yon deskripsyon, òganizatè a ekri l oswa nou fè l ak dat la, kote a ak pri a.',
      'Klavye: yon lyen pou ale dirèkteman nan kontni an, yon fokis ou ka wè, ak fenèt ki kenbe fokis la epi ki fèmen ak Escape.',
      'Gwo tèks: paj yo swiv zoom navigatè w la, epi aplikasyon an swiv gwosè tèks telefòn ou, san li pa koupe mo yo.',
      'Mwens animasyon: animasyon yo kalme lè aparèy ou mande mwens mouvman.',
      'Nan aplikasyon an, Pwofil > Aksesibilite ajoute mwens animasyon, tèks pi gra ak plis kontras.',
    ],
    gapsH: 'Limit nou konnen',
    gaps: [
      'Ansyen afich yo li ak enfòmasyon evènman an, pa ak imaj la.',
      'Kat yo, videyo ki entegre yo ak fòm peman kat yo soti nan lòt sèvis epi yo swiv pwòp aksesibilite pa yo.',
    ],
    reportH: 'Di nou',
    report: 'Si yon bagay bloke w, di nou sa w t ap eseye fè ak sou ki aparèy. Nou reponn nan de jou travay.',
    reportForm: 'Kontakte sipò',
    reportEmail: 'oswa ekri nan',
    reviewed: 'Dènye revizyon',
    locale: 'fr-HT',
  },
}

export async function generateMetadata(): Promise<Metadata> {
  const c = DICT[await resolveLanguage()]
  return { title: c.metaTitle, description: c.metaDescription, alternates: { canonical: '/accessibility' } }
}

export default async function AccessibilityPage() {
  const [lng, user] = await Promise.all([resolveLanguage(), getCurrentUser()])
  const c = DICT[lng]
  const admin = isAdmin((user as { email_verified?: boolean } | null)?.email_verified ? user?.email : null)
  let reviewed = LAST_REVIEWED
  try {
    reviewed = new Intl.DateTimeFormat(c.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${LAST_REVIEWED}T12:00:00Z`)
    )
  } catch {
    // An engine without that locale keeps the ISO date.
  }

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={admin} />
      <main id="main-content" className="mx-auto max-w-2xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="font-display text-hero italic leading-tight text-fg">{c.title}</h1>
        <p className="mt-4 text-body leading-relaxed text-fg-muted">{c.intro}</p>

        <section aria-labelledby="a11y-works" className="mt-10">
          <h2 id="a11y-works" className="text-lead font-semibold text-fg">
            {c.worksH}
          </h2>
          <ul className="mt-3 list-disc space-y-2 ps-5 text-body leading-relaxed text-fg-muted">
            {c.works.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="a11y-gaps" className="mt-10">
          <h2 id="a11y-gaps" className="text-lead font-semibold text-fg">
            {c.gapsH}
          </h2>
          <ul className="mt-3 list-disc space-y-2 ps-5 text-body leading-relaxed text-fg-muted">
            {c.gaps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="a11y-report" className="mt-10">
          <h2 id="a11y-report" className="text-lead font-semibold text-fg">
            {c.reportH}
          </h2>
          <p className="mt-3 text-body leading-relaxed text-fg-muted">{c.report}</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-fg-muted">
            <Link
              href="/support/request"
              className="inline-flex h-10 items-center rounded bg-inverse px-4 text-meta font-semibold text-on-inverse transition-colors hover:bg-inverse-hover"
            >
              {c.reportForm}
            </Link>
            <span>{c.reportEmail}</span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-fg underline underline-offset-4">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>

        <p className="mt-12 text-meta text-fg-subtle">
          {c.reviewed}: <time dateTime={LAST_REVIEWED}>{reviewed}</time>
        </p>
      </main>
      <MobileNavWrapper user={user} isAdmin={admin} />
    </div>
  )
}
