import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import type { getCurrentUser } from '@/lib/auth'
import type { ContentPage, ContentBlock, Locale } from '@/lib/content-pages'

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>

interface ContentPageViewProps {
  /** The page loaded from Firestore, or null when it is missing/unreadable. */
  page: ContentPage | null
  user: CurrentUser
  /** Title to show in the shell when `page` is null. */
  fallbackTitle?: string
  /** Locale the content was resolved for; used to localize the draft note. */
  locale?: Locale
}

/**
 * Localized "this translation is a draft" note. The app's runtime i18n is
 * client-only (react-i18next via localStorage), so a server component can't use
 * it here — we localize this single line inline from the resolved locale.
 */
const DRAFT_NOTE: Record<Locale, string> = {
  en: 'Draft translation, being reviewed. The English version is the reference.',
  fr: 'Traduction provisoire, en cours de révision. La version anglaise fait référence.',
  ht: 'Tradiksyon pwovizwa, n ap revize l. Vèsyon anglè a se referans lan.',
}

/**
 * Render a single content block.
 *
 * Styled here, not by `prose`: the typography plugin isn't installed, so the
 * `prose` classes these pages carried did nothing and every legal page read
 * as one unbroken wall (no heading space, no bullets, lists run into the
 * paragraphs). `!` on sizes: body's .mobile-typography flattens bare
 * h2/p utilities on phones.
 */
const BODY = '!text-[15px] !leading-relaxed text-white/75'
function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 3 ? (
        <h3 className="mb-2 mt-7 !text-[16px] font-semibold text-white">{block.text}</h3>
      ) : (
        <h2 className="mb-3 mt-10 font-grotesk !text-[20px] font-bold tracking-[-0.01em] text-white first:mt-0 sm:!text-[22px]">
          {block.text}
        </h2>
      )
    case 'paragraph':
      return <p className={`mb-4 ${BODY}`}>{block.text}</p>
    case 'list':
      return block.ordered ? (
        <ol className={`mb-5 ml-5 list-decimal space-y-1.5 marker:text-white/40 ${BODY}`}>
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className={`mb-5 ml-5 list-disc space-y-1.5 marker:text-white/40 ${BODY}`}>
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    case 'callout':
      // A fill, not a coloured rule down the side (house rule: fill, not hairline).
      return (
        <div className="mt-8 rounded bg-white/[0.05] p-5 sm:p-6">
          {block.title ? <h3 className="mb-2 !text-[16px] font-semibold text-white">{block.title}</h3> : null}
          {block.items && block.items.length > 0 ? (
            <ul className={`ml-5 list-disc space-y-1.5 marker:text-white/40 ${BODY}`}>
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          {block.text ? <p className={BODY}>{block.text}</p> : null}
        </div>
      )
    default:
      return null
  }
}

/**
 * Shared shell + renderer for legal/help content pages backed by
 * `content_pages/{slug}` in Firestore. Preserves the exact prose layout the
 * pages used inline: dark canvas, navbars, max-width container, an <h1> title
 * with a "Last updated" line, and the bordered `prose prose-teal` content box.
 */
export default function ContentPageView({
  page,
  user,
  fallbackTitle,
  locale = 'en',
}: ContentPageViewProps) {
  const title = page?.title || fallbackTitle || 'Content'

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      <Navbar user={user} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 lg:py-12">
        <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 md:mb-4">
          {title}
        </h1>
        {page?.updated ? (
          <p className="text-[11px] sm:text-[13px] md:text-base text-white/65 mb-4 sm:mb-6 md:mb-8">
            Last updated: {page.updated}
          </p>
        ) : null}

        {page?.draft ? (
          <p className="text-[11px] sm:text-[13px] md:text-sm text-amber-300/90 mb-4 sm:mb-6">
            {DRAFT_NOTE[locale] ?? DRAFT_NOTE.en}
          </p>
        ) : null}

        <div className="rounded bg-white/[0.03] p-5 sm:p-8">
          {page && page.blocks.length > 0 ? (
            page.blocks.map((block, i) => <Block key={i} block={block} />)
          ) : (
            <p className="text-white/65">
              This content is currently unavailable. Please check back shortly or contact{' '}
              <a href="mailto:support@tikem.co">support@tikem.co</a>.
            </p>
          )}
        </div>
      </div>

      <MobileNavWrapper user={user} />
    </div>
  )
}
