import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import { SectionHeader } from '@/components/ui/EditorialRails'
import { isDemoMode } from '@/lib/demo'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { COUNTRY_COOKIE, resolveCountry } from '@/lib/home/country'
import { buildCityIndex, inCity, resolveActiveCity, toHomeEvent, type HomeEvent } from '@/lib/home/feed'
import { NEW_PAGE_MAX, selectNewOnTikem } from '@/lib/home/new-on-tikem'
import { readNewOnTikemDocs } from '@/lib/home/new-on-tikem-server'
import { resolveServerLanguage, tServer } from '@/lib/serverT'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'New on Tikèm',
  description: 'Events organizers added lately, newest first.',
  alternates: { canonical: '/new' },
}

/**
 * Home's "new on Tikèm" rail in full (its "see all" link): the same rule
 * (lib/home/new-on-tikem) for the same country and city, a longer list.
 * From Tikra f45147e6.
 */
export default async function NewOnTikemPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const [user, lang, cookieStore] = await Promise.all([getCurrentUser(), resolveServerLanguage(), cookies()])
  const country = resolveCountry(typeof params.country === 'string' ? params.country : null, cookieStore.get(COUNTRY_COOKIE)?.value)
  const now = Date.now()

  const [docs, blocked] = await Promise.all([
    isDemoMode() ? Promise.resolve([] as Array<Record<string, any>>) : readNewOnTikemDocs(now).catch(() => []),
    getBlockedOrganizerIds(user?.id),
  ])
  const candidates = filterBlockedEvents(docs as any[], blocked)
  // The city the home page was browsing (?city=), resolved the same way.
  const inCountry = candidates
    .map(toHomeEvent)
    .filter((e): e is HomeEvent => !!e && e.country === country)
  const active = resolveActiveCity(buildCityIndex(inCountry), typeof params.city === 'string' ? params.city : undefined, null, null)

  const events: HomeEvent[] = selectNewOnTikem(candidates, {
    now,
    country,
    inArea: (e: any) => inCity({ city: String(e.city || ''), country: String(e.country || 'HT') } as HomeEvent, active?.key ?? null),
    max: NEW_PAGE_MAX,
    min: 1,
  })
    .map(toHomeEvent)
    .filter((e): e is HomeEvent => !!e)
  const adminFlag = isAdmin((user as any)?.email_verified ? user?.email : null)

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={adminFlag} />
      <main id="content" className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <SectionHeader title={tServer(lang, 'home.new_on.title', 'new on Tikèm')} />
        {events.length > 0 ? (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
            {events.map((e) => (
              <li key={e.id}>
                <DiscoverEventCard event={e as any} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">
            {tServer(lang, 'home.new_on.empty', 'Nothing new here yet.')}{' '}
            <Link href="/discover" className="font-semibold text-fg hover:underline">
              {tServer(lang, 'home.new_on.discover', 'See every event')}
            </Link>
          </p>
        )}
      </main>
      <MobileNavWrapper user={user} isAdmin={adminFlag} />
    </div>
  )
}
