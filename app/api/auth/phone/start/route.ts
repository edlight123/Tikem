// Phone (WhatsApp one-time code) sign-in. Off unless PHONE_AUTH_ENABLED and
// the config/auth remote switch are both on; answers 404 otherwise.
// Logic lives in lib/auth/otp/handlers.ts.
import { handleStart } from '@/lib/auth/otp/handlers'
import { productionPhoneAuthDeps } from '@/lib/auth/otp/deps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleStart(req, productionPhoneAuthDeps())
}
