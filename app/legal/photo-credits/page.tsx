import type { Metadata } from 'next'
import { PHOTO_CREDITS } from '@/lib/photoCredits'
import { HOLIDAY_TEMPLATES } from '@/lib/holidayTemplates'

// Each holiday poster photo once (a photo can serve two templates).
const HOLIDAY_CREDITS = [...new Map(HOLIDAY_TEMPLATES.map((t) => [t.photo, t])).values()]

export const metadata: Metadata = {
  title: 'Photo credits · Tikèm',
  description: 'The photographers and licenses behind the photos on Tikèm.',
}

/**
 * Credits for the real photos used across the site and app (places, national
 * days, placeholders). CC BY / CC BY-SA require the author, the license and a
 * link; Unsplash and public-domain photos are listed too, for traceability.
 */
export default function PhotoCreditsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
      <h1 className="font-display text-hero italic leading-tight text-fg">photo credits</h1>
      <ul className="mt-8 divide-y divide-line">
        {PHOTO_CREDITS.map((c) => (
          <li key={c.key} className="py-4">
            <a
              href={c.source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-body font-semibold text-fg hover:underline"
            >
              {c.title}
            </a>
            <p className="mt-1 text-meta text-fg-muted">
              {c.author}
              {' · '}
              {c.licenseUrl ? (
                <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {c.license}
                </a>
              ) : (
                c.license
              )}
            </p>
          </li>
        ))}
      </ul>

      {/* The holiday poster templates' photos (lib/holidayTemplates), all Unsplash License. */}
      <h2 className="mt-14 font-display text-title italic leading-tight text-fg">holiday posters</h2>
      <ul className="mt-4 divide-y divide-line">
        {HOLIDAY_CREDITS.map((t) => (
          <li key={t.photo} className="py-4">
            <a
              href={t.credit.source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-body font-semibold text-fg hover:underline"
            >
              {t.title.en}
            </a>
            <p className="mt-1 text-meta text-fg-muted">
              {t.credit.author}
              {' · '}
              <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer" className="underline">
                Unsplash License
              </a>
            </p>
          </li>
        ))}
      </ul>
    </main>
  )
}
