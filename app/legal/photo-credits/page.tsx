import type { Metadata } from 'next'
import { PHOTO_CREDITS } from '@/lib/photoCredits'

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
      <h1 className="font-display text-[40px] italic leading-tight text-white">photo credits</h1>
      <ul className="mt-8 divide-y divide-white/10">
        {PHOTO_CREDITS.map((c) => (
          <li key={c.key} className="py-4">
            <a
              href={c.source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[15px] font-semibold text-white hover:underline"
            >
              {c.title}
            </a>
            <p className="mt-1 text-[13px] text-white/60">
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
    </main>
  )
}
