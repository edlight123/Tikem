/**
 * Expo push: building the messages and reading Expo's answers. Pure, so it is
 * unit-tested (__tests__/push-expo-messages.test.ts); the sending and token
 * pruning live in lib/push/expo.ts.
 *
 * Ported from Tikra (cfee2ccc, c2bcb528) after its Android testers got local
 * alerts but never a message push:
 *   - messages go out at priority 'high': Expo's default maps to FCM "normal"
 *     on Android, which Doze may hold until the phone wakes;
 *   - a failure Expo reports later, in the RECEIPTS (InvalidCredentials when
 *     the project has no FCM V1 key on EAS, MismatchSenderId when
 *     google-services.json is another Firebase project's), was never read;
 *     it is now logged with what it means, and DeviceNotRegistered is pruned
 *     from receipts too, not only from tickets;
 *   - logs never carry a whole push token (a device address): only a prefix,
 *     including inside Expo's own error text.
 */

export type ExpoPushMessage = {
  to: string
  title?: string
  body?: string
  sound?: 'default' | null
  priority?: 'default' | 'normal' | 'high'
  data?: Record<string, any>
}

export type ExpoPushTicket = {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: Record<string, any>
}

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[') && token.endsWith(']')
}

export function buildExpoMessages(params: {
  tokens: string[]
  title: string
  body: string
  url?: string
  data?: Record<string, any>
  userId: string
}): ExpoPushMessage[] {
  // No channelId: Android delivers to the 'default' channel, which the app
  // creates at HIGH importance (mobile/lib/pushNotifications). Naming a
  // channel an older install never created would drop the notification there.
  return params.tokens.filter(isExpoPushToken).map((token) => ({
    to: token,
    title: params.title,
    body: params.body,
    sound: 'default',
    priority: 'high',
    data: {
      ...(params.data || {}),
      url: params.url || '/',
      userId: params.userId,
    },
  }))
}

/** What a failure code means, for whoever reads the logs. */
export function explainExpoPushError(code: string | undefined): string {
  switch (code) {
    case 'DeviceNotRegistered':
      return 'token no longer valid (app uninstalled or notifications reset); pruned'
    case 'InvalidCredentials':
      return 'push credentials missing or invalid: upload the FCM V1 service account key (Android) or APNs key (iOS) to EAS for this project'
    case 'MismatchSenderId':
      return "the app's google-services.json is from a different Firebase project than the FCM key uploaded to EAS"
    case 'MessageTooBig':
      return 'payload over 4096 bytes'
    case 'MessageRateExceeded':
      return 'too many pushes to this device; back off'
    default:
      return code || 'unknown error'
  }
}

/** A token for a log line: the first characters only. */
export function redactToken(token: string): string {
  const inner = String(token || '').replace(/^Expo(nent)?PushToken\[/, '').replace(/\]$/, '')
  return `ExponentPushToken[${inner.slice(0, 6)}…]`
}

/** Any text (Expo's error messages quote the token) with every push token shortened. */
export function scrubTokens(text: unknown): string {
  return String(text ?? '').replace(/Expo(nent)?PushToken\[[^\]]*\]/g, (m) => redactToken(m))
}

/** Any JSON-able value (Expo's error body) with every push token shortened, for a log line. */
export function scrubForLog(value: unknown): unknown {
  try {
    return JSON.parse(scrubTokens(JSON.stringify(value ?? null)))
  } catch {
    return null
  }
}

export interface PushFailure {
  token: string
  code: string
  message: string
}

export interface TicketOutcome {
  /** Tokens Expo says are dead: remove them from the user. */
  prune: string[]
  /** Every failed ticket, for the logs. */
  errors: PushFailure[]
  /** Accepted messages: Expo's receipt id and the token it went to. */
  receipts: Array<{ id: string; token: string }>
}

/** Read Expo's send tickets (same order as the messages sent). */
export function readExpoTickets(sent: ExpoPushMessage[], tickets: ExpoPushTicket[]): TicketOutcome {
  const out: TicketOutcome = { prune: [], errors: [], receipts: [] }
  tickets.forEach((t, i) => {
    const token = sent[i]?.to
    if (!token || !t) return
    if (t.status === 'ok') {
      if (t.id) out.receipts.push({ id: String(t.id), token })
      return
    }
    const code = String(t.details?.error || 'unknown')
    out.errors.push({ token, code, message: String(t.message || '') })
    if (code === 'DeviceNotRegistered') out.prune.push(token)
  })
  return out
}

/** Read Expo's receipts ({ data: { [receiptId]: { status, details } } }). */
export function readExpoReceipts(
  receipts: Record<string, ExpoPushTicket> | null | undefined,
  sent: Array<{ id: string; token: string }>
): { prune: string[]; errors: PushFailure[] } {
  const prune: string[] = []
  const errors: PushFailure[] = []
  for (const { id, token } of sent) {
    const r = receipts?.[id]
    if (!r || r.status !== 'error') continue
    const code = String(r.details?.error || 'unknown')
    errors.push({ token, code, message: String(r.message || '') })
    if (code === 'DeviceNotRegistered') prune.push(token)
  }
  return { prune, errors }
}

/** One log record for a failed push: no full token anywhere in it. */
export function failureLog(userId: string, e: PushFailure) {
  return { userId, token: redactToken(e.token), code: e.code, why: explainExpoPushError(e.code), message: scrubTokens(e.message) }
}
