/**
 * Shared HTTP handler for POST /api/events/[id]/report and
 * POST /api/organizers/[id]/report. Auth is the session cookie (web) or the
 * mobile app's Bearer token — both resolve through getCurrentUser().
 *
 * Responses (codes are what clients localize from, never the English text):
 *   200 { ok, reportId }                     created
 *   200 { ok, reportId, duplicate: true }    already an open report from this user (idempotent)
 *   400 invalid_reason | details_too_long | bad_request | self_report
 *   401 unauthorized    404 not_found    429 rate_limited
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { fileReport, parseReportBody, type ReportTargetKind } from './reports'
import { notifyAdminsOfReport } from './notify-admins'

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
}

export async function handleReportRequest(
  kind: ReportTargetKind,
  request: Request,
  targetId: string
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser()
    if (!user) return fail('Sign in to report content.', 'unauthorized', 401)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('Malformed request body.', 'bad_request', 400)
    }
    const parsed = parseReportBody(body)
    if (!parsed.ok) return fail(parsed.error, parsed.code, 400)

    const id = String(targetId || '').trim()
    if (!id) return fail('Not found.', 'not_found', 404)

    const result = await fileReport({
      kind,
      targetId: id,
      reporterUid: user.id,
      reason: parsed.reason,
      details: parsed.details,
    })

    switch (result.status) {
      case 'not_found':
        return fail('Not found.', 'not_found', 404)
      case 'self':
        return fail('You cannot report yourself.', 'self_report', 400)
      case 'rate_limited':
        return fail('You have sent a lot of reports. Try again later.', 'rate_limited', 429)
      case 'duplicate':
        return NextResponse.json({ ok: true, reportId: result.reportId, duplicate: true })
      case 'created':
      default:
        await notifyAdminsOfReport({
          kind,
          targetId: id,
          targetTitle: result.targetTitle,
          reason: parsed.reason,
          details: parsed.details,
          openCount: result.openCount,
          autoHidden: result.autoHidden,
        })
        return NextResponse.json({ ok: true, reportId: result.reportId })
    }
  } catch (error) {
    console.error(`[report:${kind}] failed`, error)
    return fail('Could not send your report. Try again.', 'internal_error', 500)
  }
}
