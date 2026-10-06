/**
 * The fee rates currently in force.
 *
 * Exists for the mobile app, which cannot read Firestore's platform settings the
 * way a server component can, and would otherwise price every display from the
 * values compiled into the bundle at build time — so an admin changing the rate
 * would leave the app advertising the old figure while checkout charged the new
 * one. The web solves the same problem by seeding the config in the root layout.
 *
 * PUBLIC AND SAFE TO BE: these are the fee terms already printed on the public
 * fees page and shown to every buyer at checkout. Only fee fields are returned —
 * settlement timing and payout thresholds stay out of it, because nothing that
 * displays a price needs them.
 *
 * This is a DISPLAY source. The routes that actually charge a card read Firestore
 * themselves; a client that lied about the config could only mis-draw its own
 * screen, never change what it is charged.
 */

import { NextResponse } from 'next/server'
import { getPlatformFeeSettings } from '@/lib/checkout/fee-config-server'
import { DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'

export const runtime = 'nodejs'

/** Seconds the client (and any CDN) may serve this without asking again. */
const MAX_AGE_SECONDS = 300

function feeFieldsOnly(config: { platformFeePercentage: number }) {
  return {
    platformFeePercentage: config.platformFeePercentage,
    // The per-ticket cap is retired (owner decision, 2026-10-05). Always an EMPTY
    // table, never omitted: mobile builds already in users' hands fall back to
    // their compiled-in caps when the field is missing, but treat an empty table
    // as "no cap", so this is what makes them price the flat rate too.
    platformFeeCapMinorByCurrency: {} as Record<string, number>,
  }
}

export async function GET() {
  // Never fails: a settings read going down must not stop the app pricing tickets,
  // and the defaults are the values the build shipped with anyway.
  const config = (await getPlatformFeeSettings()) || {
    haiti: DEFAULT_PLATFORM_SETTINGS.haiti,
    usCanada: DEFAULT_PLATFORM_SETTINGS.usCanada,
  }

  return NextResponse.json(
    {
      haiti: feeFieldsOnly(config.haiti),
      usCanada: feeFieldsOnly(config.usCanada),
    },
    {
      headers: {
        'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, stale-while-revalidate=3600`,
      },
    }
  )
}
