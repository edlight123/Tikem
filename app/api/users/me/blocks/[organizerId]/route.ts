/**
 * POST   /api/users/me/blocks/[organizerId] — block an organizer.
 * DELETE /api/users/me/blocks/[organizerId] — unblock.
 * See lib/moderation/blocks.ts for what a block hides.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { blockOrganizer, unblockOrganizer } from '@/lib/moderation/blocks'

export const runtime = 'nodejs'

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
}

type Ctx = { params: Promise<{ organizerId: string }> }

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser()
    if (!user) return fail('Sign in to block an organizer.', 'unauthorized', 401)
    const organizerId = String((await params).organizerId || '').trim()
    if (!organizerId) return fail('Not found.', 'not_found', 404)
    if (organizerId === user.id) return fail('You cannot block yourself.', 'self_block', 400)

    const target = await adminDb.collection('users').doc(organizerId).get()
    if (!target.exists) return fail('Not found.', 'not_found', 404)

    await blockOrganizer(user.id, organizerId)
    return NextResponse.json({ ok: true, blocked: true })
  } catch (error) {
    console.error('[blocks] block failed', error)
    return fail('Could not block this organizer. Try again.', 'internal_error', 500)
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser()
    if (!user) return fail('Sign in first.', 'unauthorized', 401)
    const organizerId = String((await params).organizerId || '').trim()
    if (!organizerId) return fail('Not found.', 'not_found', 404)

    await unblockOrganizer(user.id, organizerId)
    return NextResponse.json({ ok: true, blocked: false })
  } catch (error) {
    console.error('[blocks] unblock failed', error)
    return fail('Could not unblock this organizer. Try again.', 'internal_error', 500)
  }
}
