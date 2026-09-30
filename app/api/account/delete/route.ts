import { handleAccountDeletionRequest } from '@/lib/account/deletion'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/delete — in-app account deletion (mobile + web).
 *
 * Auth: Bearer Firebase ID token (preferred) or the `session` cookie, and the
 * sign-in must be under 10 minutes old (401 `reauth_required` otherwise).
 * See lib/account/deletion.ts for what is deleted, anonymized, or refused.
 */
export async function POST(request: Request) {
  return handleAccountDeletionRequest(request)
}
