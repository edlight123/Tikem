/**
 * POST /api/events/[id]/report — flag an event as objectionable.
 * Body: { reason: spam|scam_or_fraud|offensive|violence|sexual|illegal|misleading|other, details?: string (≤1000) }
 * See lib/moderation/reports.ts for dedupe, rate limit and auto-hide.
 */
import { handleReportRequest } from '@/lib/moderation/report-route'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleReportRequest('event', request, id)
}
