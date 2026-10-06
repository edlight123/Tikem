/**
 * After a ticket changes hands: void the PREVIOUS holder's wallet passes.
 *
 *   Apple:  push every device registered for the old serial
 *           (lib/wallet/apple-web-service.ts); each one then downloads the
 *           voided, barcode-less pass the web service serves for an old serial.
 *   Google: PATCH the old object INACTIVE with a dead barcode.
 *
 * Both are best-effort and never throw: the transfer has already committed and
 * the door refuses the old code regardless (lib/tickets/qr.ts). Passes issued
 * before passes carried a webServiceURL never registered, so there is nothing
 * to push for them.
 */

import { getAppleWalletConfig, getGoogleWalletConfig } from './config'
import { appleSerialFor, deleteRegistration, registrationsForSerial } from './apple-web-service'
import { pushPassUpdates, type ApnsSender } from './apns'
import { voidGoogleTicketObject } from './google'

export type WalletVoidReport = {
  apple: { serial: string; devices: number; pushed: number; pruned: number } | null
  google: 'voided' | 'not_saved' | 'failed' | null
}

export async function voidPreviousHolderPasses(
  params: { ticketId: string; previousVersion: number },
  deps: { apnsSender?: ApnsSender; fetchImpl?: Parameters<typeof voidGoogleTicketObject>[3] } = {}
): Promise<WalletVoidReport> {
  const report: WalletVoidReport = { apple: null, google: null }

  const apple = getAppleWalletConfig()
  if (apple) {
    const serial = appleSerialFor(params.ticketId, params.previousVersion)
    try {
      const registrations = await registrationsForSerial(serial)
      const results = await pushPassUpdates(
        registrations.map((r) => r.pushToken),
        apple,
        deps.apnsSender
      )
      // 410 = the device removed the pass; stop pushing to it.
      const gone = new Set(results.filter((r) => r.status === 410).map((r) => r.token))
      let pruned = 0
      for (const r of registrations) {
        if (!gone.has(r.pushToken)) continue
        try {
          await deleteRegistration(r.id)
          pruned += 1
        } catch {
          // a stale registration only costs one wasted push next time
        }
      }
      report.apple = {
        serial,
        devices: registrations.length,
        pushed: results.filter((r) => r.status === 200).length,
        pruned,
      }
    } catch (error) {
      console.warn('[wallet] apple void failed', { serial, message: (error as any)?.message })
      report.apple = { serial, devices: 0, pushed: 0, pruned: 0 }
    }
  }

  const google = getGoogleWalletConfig()
  if (google) {
    report.google = await voidGoogleTicketObject(
      google,
      params.ticketId,
      params.previousVersion,
      deps.fetchImpl
    )
  }

  return report
}
