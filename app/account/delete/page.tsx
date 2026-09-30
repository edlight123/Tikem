import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { getCurrentUser } from '@/lib/auth'
import { resolveServerLanguage, tServer } from '@/lib/serverT'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Delete your account | Tikèm',
  description:
    'How to delete your Tikèm account in the app or on the web, what is deleted, and what is kept anonymized.',
  alternates: { canonical: '/account/delete' },
}

const SUPPORT_EMAIL = 'support@tikem.co'
/** AccountCard reopens the deletion dialog on ?delete=1. */
const DELETE_PATH = '/profile?delete=1'

/**
 * PUBLIC account-deletion page — the URL App Store Connect and Google Play's
 * "delete account" field point at. Readable signed out; it explains both
 * paths (in-app, web), what goes and what stays, and offers a support-email
 * fallback for people who can no longer sign in.
 */
export default async function AccountDeletePage() {
  const [user, lang] = await Promise.all([getCurrentUser().catch(() => null), resolveServerLanguage()])
  const p = (key: string, fallback: string) => tServer(lang, `account_deletion.page.${key}`, fallback)

  const ctaHref = user ? DELETE_PATH : `/auth/login?redirect=${encodeURIComponent(DELETE_PATH)}`
  const ctaLabel = user ? p('cta_signed_in', 'Delete my account') : p('cta_signed_out', 'Sign in to delete')
  const [supportBefore, supportAfter = ''] = p(
    'support_body',
    "Email {{email}} from the address on your account and we'll delete it for you."
  ).split('{{email}}')

  const sections: Array<{ heading: string; body: string }> = [
    { heading: p('deleted_heading', 'What we delete'), body: p('deleted_body', '') },
    { heading: p('kept_heading', 'What we keep, anonymized'), body: p('kept_body', '') },
    { heading: p('organizers_heading', 'Organizers and promoters'), body: p('organizers_body', '') },
  ]

  return (
    <div className="min-h-screen bg-black pb-mobile-nav">
      <Navbar user={user} />

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="eyebrow text-brand-400">{p('eyebrow', 'Your data')}</p>
        {/* `!` beats the legacy `.mobile-typography h1` rule on a phone. */}
        <h1 className="mt-2 font-display lowercase !text-[clamp(30px,6vw,44px)] !leading-[1.04] text-white">
          {p('title', 'Delete your Tikèm account')}
        </h1>
        <p className="mt-4 !text-[15px] !leading-relaxed text-white/65">{p('lede', '')}</p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/[0.055] p-5">
            <h2 className="!text-[15px] font-semibold text-white">{p('app_heading', 'In the Tikèm app')}</h2>
            <p className="mt-2 !text-[14px] !leading-relaxed text-white/60">{p('app_steps', '')}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.055] p-5">
            <h2 className="!text-[15px] font-semibold text-white">{p('web_heading', 'On the web')}</h2>
            <p className="mt-2 !text-[14px] !leading-relaxed text-white/60">{p('web_steps', '')}</p>
          </div>
        </div>
        <p className="mt-3 !text-[13px] text-white/45">{p('reauth_note', '')}</p>

        <Link
          href={ctaHref}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-[15px] font-bold text-black transition-colors hover:bg-white/85"
        >
          {ctaLabel}
        </Link>

        <div className="mt-12 space-y-8">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="font-display lowercase !text-[22px] !leading-tight text-white">{s.heading}</h2>
              <p className="mt-2 !text-[14px] !leading-relaxed text-white/60">{s.body}</p>
            </section>
          ))}

          <section className="rounded-2xl bg-white/[0.03] p-5">
            <h2 className="!text-[15px] font-semibold text-white">{p('support_heading', "Can't sign in?")}</h2>
            <p className="mt-2 !text-[14px] !leading-relaxed text-white/60">
              {supportBefore}
              <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20deletion`} className="text-white underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>
              {supportAfter}
            </p>
          </section>
        </div>
      </main>

      <MobileNavWrapper user={user} />
    </div>
  )
}
