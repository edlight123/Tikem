/**
 * GET /api/admin/community: the community moderation queue (admins only).
 *
 * Pending shares (event_submissions) and pending claims (event_claims), oldest
 * first. A claim's uploaded proof is PRIVATE (claim-proofs/{uid}/, no client
 * read); each one gets a 10-minute signed link minted here, behind
 * requireAdmin, and the raw storage path never leaves the server.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { signClaimProof } from '@/lib/community/claim-proofs'
import { fieldsFromSubmission } from '@/lib/community/submissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { user } = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  const [subs, claims, auto] = await Promise.all([
    adminDb.collection('event_submissions').where('status', '==', 'pending').limit(100).get(),
    adminDb.collection('event_claims').where('status', '==', 'pending').limit(100).get(),
    // Shares that went live on their own (lib/community/publish), newest first.
    adminDb.collection('event_submissions').where('auto_published', '==', true).limit(100).get(),
  ])
  const list = (snap: any) =>
    (snap.docs as any[])
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  const submissions = list(subs).map((s: any) => {
    // The submitter's email stays on the server: the queue shows their uid.
    const { submitted_by_email: _email, ...rest } = s
    return { ...rest, draft: fieldsFromSubmission(s) }
  })
  const pendingClaims = await Promise.all(
    list(claims).map(async (c: any) => {
      const { proof_path, requested_by_email: _email, ...rest } = c
      return { ...rest, has_proof_file: !!proof_path, proof_view_url: proof_path ? await signClaimProof(proof_path) : null }
    })
  )
  const autoPublished = list(auto)
    .filter((s: any) => s.status === 'approved')
    .reverse()
    .slice(0, 30)
    .map((s: any) => {
      const { submitted_by_email: _email, ...rest } = s
      return { ...rest, draft: fieldsFromSubmission(s) }
    })
  return NextResponse.json({ submissions, claims: pendingClaims, autoPublished }, { headers: { 'Cache-Control': 'private, no-store' } })
}
