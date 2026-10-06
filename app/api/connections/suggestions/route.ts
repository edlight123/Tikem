/**
 * GET /api/connections/suggestions: "people you may know" for the signed-in
 * user. Behind config/auth.friend_suggestions (fails closed), rate-limited per
 * uid, Admin SDK only. Privacy rules: lib/social/suggestions.ts.
 */
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import { handleSuggestions, suggestionsRateLimit } from '@/lib/social/handlers'
import { getFriendSuggestions } from '@/lib/social/suggestions-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return handleSuggestions({
    getUserId: async () => (await getCurrentUser())?.id ?? null,
    flagOn: () => isSocialFlagOn('friend_suggestions'),
    rateLimit: suggestionsRateLimit,
    load: (uid) => getFriendSuggestions(uid),
  })
}
