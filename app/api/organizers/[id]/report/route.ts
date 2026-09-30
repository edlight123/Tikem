/**
 * POST /api/organizers/[id]/report — flag an organizer profile.
 * Same body and responses as /api/events/[id]/report; writes organizer_reports.
 */
import { handleReportRequest } from '@/lib/moderation/report-route'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleReportRequest('organizer', request, id)
}
