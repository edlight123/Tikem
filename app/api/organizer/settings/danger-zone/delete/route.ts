import { handleAccountDeletionRequest } from '@/lib/account/deletion'
import { getCurrentUser } from '@/lib/auth'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const dynamic = 'force-dynamic'

/**
 * Legacy organizer entry point. It used to batch-delete the user doc, the
 * organizer doc and EVERY event the organizer owned — orphaning buyers'
 * tickets and money. It now delegates to the single account-deletion
 * implementation, which refuses while events with sold tickets or unpaid
 * balances remain (409 organizer_has_active_obligations).
 */
export async function POST(request: Request) {
  // Never while acting for someone else's org (owner-only, lib/organizer/ownerOnly.ts).
  const user = await getCurrentUser()
  if (user) {
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner
  }
  return handleAccountDeletionRequest(request)
}
