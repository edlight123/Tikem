// "I bought a ticket but I can't find it."
//
// A guest has no account to log into, so the recovery path is: prove you own an email
// or a phone number by RECEIVING the link at it. This page never reports whether a
// match exists — see app/api/tickets/guest/lookup/route.ts.

import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import FindTicketsForm from './FindTicketsForm'

export const metadata = {
  title: 'Find my tickets · Tikèm',
}

export default function FindTicketsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Navbar user={null} isAdmin={false} />

      <main className="max-w-md mx-auto px-4 py-12 pb-mobile-nav md:pb-16">
        <h1 className="font-display lowercase !text-[34px] !leading-none text-white">Find my tickets</h1>
        <p className="text-white/60 mt-2 leading-relaxed">
          Bought without an account? Enter the email address or phone number you used at
          checkout and we&apos;ll send your ticket link straight back to it.
        </p>

        <div className="mt-8">
          <FindTicketsForm />
        </div>

        <p className="mt-8 text-xs text-white/40 text-center">
          Have an account?{' '}
          <a href="/auth/login" className="text-brand-400 underline underline-offset-2">
            Sign in
          </a>{' '}
          and your tickets are under My Tickets.
        </p>
      </main>

      <MobileNavWrapper />
    </div>
  )
}
