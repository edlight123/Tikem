// Account completion / email linking / account merge (lib/auth/account/handlers.ts).
import { handleEmailStart } from '@/lib/auth/account/handlers'
import { productionAccountDeps } from '@/lib/auth/account/deps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleEmailStart(req, productionAccountDeps())
}
