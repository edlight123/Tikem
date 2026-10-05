import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { getContentPage, resolveLocale } from '@/lib/content-pages'
import ContentPageView from '@/components/ContentPageView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Refund policy | Tikèm',
  description: 'When and how ticket refunds work on Tikèm.',
  alternates: { canonical: '/legal/refunds' },
}

export default async function RefundPolicyPage() {
  // Locale: the language switcher's cookie wins (works for anonymous
  // visitors too), then the signed-in user's saved language, then English.
  const user = await getCurrentUser()
  const cookieLng = (await cookies()).get('i18nextLng')?.value?.slice(0, 2)
  const locale = resolveLocale(cookieLng || (user as { language?: string } | null)?.language)
  const page = await getContentPage('refunds', locale)

  return (
    <ContentPageView page={page} user={user} fallbackTitle="Refund Policy" locale={locale} />
  )
}
