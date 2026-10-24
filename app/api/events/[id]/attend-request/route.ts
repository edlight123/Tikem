// A guest's own request to attend an approval-list event
// (docs/specs/approval-lists-and-plus-ones.md). Signed-in only: the request is
// keyed on the caller's uid, so nobody can see or cancel anyone else's.

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { cancelOwnRequest, createAttendRequest, getOwnRequest } from '@/lib/attend-requests/server'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function unauthorized() {
  return NextResponse.json({ error: 'Sign in to request a spot.', code: 'auth_required' }, { status: 401 })
}

function fromRefusal(r: { status: number; error: string; code: string }) {
  return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) return unauthorized()
    const result = await getOwnRequest(String(id), user)
    if (!result.ok) return fromRefusal(result)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[attend-request] GET failed', error?.message)
    return NextResponse.json({ error: 'Could not load your request.', code: 'server_error' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) return unauthorized()
    const body = await request.json().catch(() => ({}))
    const result = await createAttendRequest(String(id), user, {
      plusOnes: body?.plusOnes,
      note: body?.note,
    })
    if (!result.ok) return fromRefusal(result)
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error: any) {
    console.error('[attend-request] POST failed', error?.message)
    return NextResponse.json({ error: 'Could not send your request.', code: 'server_error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) return unauthorized()
    const result = await cancelOwnRequest(String(id), user)
    if (!result.ok) return fromRefusal(result)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[attend-request] DELETE failed', error?.message)
    return NextResponse.json({ error: 'Could not cancel your request.', code: 'server_error' }, { status: 500 })
  }
}
