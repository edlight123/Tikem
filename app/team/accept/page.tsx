import { Suspense } from 'react'
import type { Metadata } from 'next'
import AcceptTeamInviteClient from './AcceptTeamInviteClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Join a team | Tikèm',
  robots: { index: false, follow: false },
}

/**
 * /team/accept?invite=&token=  The link in an organization team invite email
 * (app/api/organizer/team POST). Public on purpose: it lives outside
 * /organizer, whose layout gates on having an org, which an invitee does not
 * have yet. The client signs the visitor in if needed and redeems the invite
 * with POST /api/organizer/team/accept.
 */
export default function AcceptTeamInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <AcceptTeamInviteClient />
    </Suspense>
  )
}
