'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  setPlatformFeeConfig,
  type PlatformFeeConfig,
} from '@/lib/checkout/fee-config-store'

/**
 * Seeds the admin-configured fee rates into the pricing layer, so a
 * price the buyer READS is computed from the same settings the server CHARGES
 * from. Without it, display falls back to the compiled-in defaults and an admin
 * changing the rate would leave every advertised price stale.
 *
 * It wraps its children rather than sitting beside them: React finishes a parent's
 * render before it renders that parent's children, so wrapping is what guarantees
 * the config is in place before the first component prices anything. A sibling
 * placed "first" would only happen to work.
 *
 * The seeding runs during render (via useMemo, not an effect) for the same reason
 * — an effect fires AFTER the first paint, which is exactly one paint too late and
 * would produce a hydration mismatch between the server's price and the client's.
 *
 * WHY IT ALSO REFRESHES CLIENT-SIDE: the server value is only as fresh as the
 * render that produced it. A statically generated page carries whatever was true
 * at BUILD time, and a tab left open all day carries whatever was true when it
 * loaded. One cached request after mount covers both, and re-seeding through state
 * is what makes already-rendered prices update rather than silently disagree with
 * checkout.
 */
export function FeeConfigProvider({
  config,
  children,
}: {
  config: PlatformFeeConfig | null
  children: React.ReactNode
}) {
  const [active, setActive] = useState(config)

  useMemo(() => setPlatformFeeConfig(active), [active])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const response = await fetch('/api/platform/fee-config')
        if (!response.ok) return
        const payload = await response.json()
        if (cancelled || !payload?.usCanada) return
        // Only re-render when something actually moved — otherwise every page load
        // would pay for a re-render of the entire tree to reach the same prices.
        if (JSON.stringify(payload) === JSON.stringify(active)) return
        setActive((previous) => ({
          haiti: { ...(previous?.haiti as any), ...payload.haiti },
          usCanada: { ...(previous?.usCanada as any), ...payload.usCanada },
        }))
      } catch {
        // Offline or the endpoint is down: the server-seeded values stand.
      }
    })()

    return () => {
      cancelled = true
    }
    // Runs once per mount: this is a staleness backstop, not a live subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
