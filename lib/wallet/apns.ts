/**
 * APNs pushes that tell iOS "a pass changed, fetch it".
 *
 * Wallet pushes are deliberately content-free: an empty JSON body to
 * /3/device/<pushToken> with `apns-topic` = the Pass Type ID, authenticated by
 * TLS with the SAME Pass Type ID certificate + key that signs the passes
 * (lib/wallet/config.ts, from env). The device then asks the web service which
 * serials changed and downloads them (lib/wallet/apple-web-service.ts).
 *
 * The sender is injectable so tests never open a socket.
 */

import type { AppleWalletConfig } from './config'

const APNS_ORIGIN = 'https://api.push.apple.com'

/** Sends one push; resolves with the HTTP status APNs answered. */
export type ApnsSender = (pushToken: string) => Promise<number>

export type ApnsResult = { token: string; status: number }

/** An HTTP/2 sender over one TLS session with the pass certificate. */
export async function createApnsSender(
  config: AppleWalletConfig
): Promise<{ send: ApnsSender; close: () => void }> {
  const http2 = await import('node:http2')
  const session = http2.connect(APNS_ORIGIN, {
    cert: config.signerCert,
    key: config.signerKey,
    ...(config.signerKeyPassphrase ? { passphrase: config.signerKeyPassphrase } : {}),
  })
  // A failed handshake must not crash the process; each request reports it.
  session.on('error', (error) => {
    console.warn('[wallet] apns session error', { message: (error as any)?.message })
  })

  const send: ApnsSender = (pushToken) =>
    new Promise<number>((resolve) => {
      try {
        const req = session.request({
          ':method': 'POST',
          ':path': `/3/device/${encodeURIComponent(pushToken)}`,
          'apns-topic': config.passTypeIdentifier,
          'content-type': 'application/json',
        })
        let status = 0
        req.setTimeout(8000, () => {
          req.close()
          resolve(status || 0)
        })
        req.on('response', (headers) => {
          status = Number(headers[':status'] || 0)
        })
        req.on('data', () => {})
        req.on('end', () => resolve(status))
        req.on('error', () => resolve(status || 0))
        req.end('{}')
      } catch {
        resolve(0)
      }
    })

  return { send, close: () => session.close() }
}

/**
 * Push every token once. Never throws: a wallet update is best-effort and
 * must never fail the transfer that triggered it. 410 = the device dropped
 * the pass, which the caller uses to prune the registration.
 */
export async function pushPassUpdates(
  pushTokens: string[],
  config: AppleWalletConfig,
  sender?: ApnsSender
): Promise<ApnsResult[]> {
  const tokens = Array.from(new Set(pushTokens.filter(Boolean)))
  if (tokens.length === 0) return []

  let close: (() => void) | null = null
  let send = sender
  try {
    if (!send) {
      const created = await createApnsSender(config)
      send = created.send
      close = created.close
    }
    const results: ApnsResult[] = []
    for (const token of tokens) {
      let status = 0
      try {
        status = await send(token)
      } catch {
        status = 0
      }
      results.push({ token, status })
    }
    return results
  } catch (error) {
    console.warn('[wallet] apns push failed', { message: (error as any)?.message })
    return tokens.map((token) => ({ token, status: 0 }))
  } finally {
    try {
      close?.()
    } catch {
      // already closed
    }
  }
}
