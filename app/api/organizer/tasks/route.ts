import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '@/lib/organizer/context'
import type { OrgAction } from '@/lib/organizer/teamRoles'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Organization task board (organizers/{orgId}/tasks) for the acting org
 * (lib/organizer/context.ts). Anyone who may view the org reads the board;
 * owners, admins and managers create, update and delete tasks.
 * Server-only (Admin SDK); not client-writable.
 */

const VALID_STATUS = new Set(['todo', 'in_progress', 'done'])

function tasksCol(orgId: string) {
  return adminDb.collection('organizers').doc(orgId).collection('tasks')
}

async function requireOrganizer(action: OrgAction) {
  const org = await requireOrg(action)
  if (!org.ok) return { error: org.response }
  return { user: org.value.user, orgId: org.value.orgId }
}

const iso = (v: any) => v?.toDate?.()?.toISOString?.() ?? v ?? null

export async function GET() {
  const auth = await requireOrganizer('view')
  if (auth.error) return auth.error
  const orgId = auth.orgId!
  try {
    const snap = await tasksCol(orgId).get()
    const tasks = snap.docs
      .map((d: any) => ({ id: d.id, ...d.data(), created_at: iso(d.data()?.created_at), due: iso(d.data()?.due) }))
      .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    return NextResponse.json({ tasks })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load tasks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireOrganizer('manage_events')
  if (auth.error) return auth.error
  const orgId = auth.orgId!
  try {
    const body = await request.json().catch(() => ({}))
    const title = String(body?.title || '').trim()
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    const status = VALID_STATUS.has(String(body?.status)) ? String(body.status) : 'todo'
    const ref = await tasksCol(orgId).add({
      title,
      notes: body?.notes ? String(body.notes).trim() : null,
      assignee_id: body?.assignee_id ? String(body.assignee_id) : null,
      assignee_name: body?.assignee_name ? String(body.assignee_name) : null,
      status,
      due: body?.due ? String(body.due) : null,
      created_by: auth.user!.id,
      created_at: FieldValue.serverTimestamp(),
    })
    return NextResponse.json({ success: true, id: ref.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create task' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireOrganizer('manage_events')
  if (auth.error) return auth.error
  const orgId = auth.orgId!
  try {
    const body = await request.json().catch(() => ({}))
    const taskId = String(body?.taskId || '')
    if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    const ref = tasksCol(orgId).doc(taskId)
    if (!(await ref.get()).exists) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const patch: any = { updated_at: FieldValue.serverTimestamp() }
    if (body?.status !== undefined) {
      if (!VALID_STATUS.has(String(body.status))) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      patch.status = String(body.status)
    }
    if (body?.title !== undefined) patch.title = String(body.title).trim()
    if (body?.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null
    if (body?.assignee_id !== undefined) patch.assignee_id = body.assignee_id ? String(body.assignee_id) : null
    if (body?.assignee_name !== undefined) patch.assignee_name = body.assignee_name ? String(body.assignee_name) : null
    if (body?.due !== undefined) patch.due = body.due ? String(body.due) : null

    await ref.set(patch, { merge: true })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update task' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireOrganizer('manage_events')
  if (auth.error) return auth.error
  const orgId = auth.orgId!
  try {
    const taskId = new URL(request.url).searchParams.get('taskId') || ''
    if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    await tasksCol(orgId).doc(taskId).delete()
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete task' }, { status: 500 })
  }
}
