/**
 * Delivery of one-time codes.
 *
 *   OtpSender            the one interface the service talks to
 *   WhatsAppCloudSender  Meta WhatsApp Cloud API, AUTHENTICATION template with
 *                        a copy-code button (production). No Twilio anywhere
 *                        in this path.
 *   DevLogSender         logs the code and keeps it in memory (local + tests);
 *                        refuses to exist in a production build
 *   SmsSender            placeholder for a future SMS fallback; no provider is
 *                        wired, so it is never selected
 *
 * Template language: WhatsApp has no Haitian Creole template language, so `ht`
 * is sent as French unless configured otherwise. See
 * docs/WHATSAPP_PHONE_AUTH_SETUP.md for every env var.
 */

export type OtpLocale = 'en' | 'fr' | 'ht'

export interface OtpSender {
  readonly name: string
  send(to: string, code: string, locale: OtpLocale): Promise<void>
}

/**
 * Why a send failed, coarse enough for the service to act on:
 *   not_on_whatsapp  the number has no WhatsApp account (tell the person)
 *   rate_limited     Meta is throttling us or this recipient (retry later)
 *   misconfigured    token, template, number id or params are wrong (ops)
 *   rejected         any other Meta refusal
 *   network/timeout  the request never got an answer
 */
export type OtpSendFailure =
  | 'not_on_whatsapp'
  | 'rate_limited'
  | 'misconfigured'
  | 'rejected'
  | 'network'
  | 'timeout'

export class OtpSendError extends Error {
  readonly reason: OtpSendFailure
  constructor(message: string, readonly detail?: unknown, reason: OtpSendFailure = 'rejected') {
    super(message)
    this.name = 'OtpSendError'
    this.reason = reason
  }
}

export function normalizeLocale(raw: unknown): OtpLocale {
  const v = typeof raw === 'string' ? raw.toLowerCase().slice(0, 2) : ''
  return v === 'fr' || v === 'ht' ? v : 'en'
}

type Env = Record<string, string | undefined>

export const DEFAULT_TEMPLATE_NAME = 'tikem_login_code'
export const DEFAULT_GRAPH_VERSION = 'v25.0'
export const SEND_TIMEOUT_MS = 10_000

/**
 * Template language per app locale. `ht` has no WhatsApp template language,
 * so it rides on whatever French resolves to.
 */
export const DEFAULT_TEMPLATE_LANGS: Readonly<Record<OtpLocale, string>> = {
  en: 'en',
  fr: 'fr',
  ht: 'fr',
}

function templateLangMap(env: Env): Partial<Record<OtpLocale, string>> {
  const raw = env.WHATSAPP_OTP_TEMPLATE_LANGS?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<OtpLocale, string>> = {}
    for (const k of ['en', 'fr', 'ht'] as const) {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
    return out
  } catch {
    console.error('[otp] WHATSAPP_OTP_TEMPLATE_LANGS is not valid JSON; using defaults')
    return {}
  }
}

/**
 * Template language code for a locale. Exported for tests and the setup doc.
 * Precedence: WHATSAPP_TEMPLATE_LANG_<EN|FR|HT>, then the
 * WHATSAPP_OTP_TEMPLATE_LANGS JSON map, then DEFAULT_TEMPLATE_LANGS. An `ht`
 * with no explicit setting follows French.
 */
export function templateLanguage(locale: OtpLocale, env: Env = process.env): string {
  const map = templateLangMap(env)
  const fr = env.WHATSAPP_TEMPLATE_LANG_FR || map.fr || DEFAULT_TEMPLATE_LANGS.fr
  if (locale === 'fr') return fr
  if (locale === 'ht') return env.WHATSAPP_TEMPLATE_LANG_HT || map.ht || fr
  return env.WHATSAPP_TEMPLATE_LANG_EN || map.en || DEFAULT_TEMPLATE_LANGS.en
}

export interface WhatsAppConfig {
  accessToken: string
  phoneNumberId: string
  templateName: string
  apiVersion: string
  /** Send the copy-code button component (authentication templates need it). */
  hasButton?: boolean
}

function flagEnv(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v.trim() === '') return fallback
  return !/^(false|0|no|off)$/i.test(v.trim())
}

export function whatsAppConfigFromEnv(env: Env = process.env): WhatsAppConfig | null {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  if (!accessToken || !phoneNumberId) return null
  const v = (env.WHATSAPP_GRAPH_VERSION || env.WHATSAPP_API_VERSION || DEFAULT_GRAPH_VERSION).trim()
  return {
    accessToken,
    phoneNumberId,
    templateName: (env.WHATSAPP_OTP_TEMPLATE || env.WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME).trim(),
    apiVersion: v.startsWith('v') ? v : `v${v}`,
    hasButton: flagEnv(env.WHATSAPP_OTP_HAS_BUTTON, true),
  }
}

/**
 * The Graph API body for an authentication template with a copy-code button.
 * The code goes in twice: once as the body's {{1}} and once as the button's
 * parameter (that is what the copy button copies). Per Meta's docs the button
 * component is `sub_type: "url"`, index 0, even for copy-code buttons. A
 * template approved without a button must not get the button component
 * (Meta rejects the parameter count), hence `hasButton`.
 */
export function buildWhatsAppTemplatePayload(
  to: string,
  code: string,
  language: string,
  templateName: string,
  hasButton = true
) {
  const components: Array<Record<string, unknown>> = [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
  ]
  if (hasButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: code }],
    })
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  }
}

// Meta error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const NOT_ON_WHATSAPP = new Set([131026])
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056, 133016])
const MISCONFIG_CODES = new Set([
  0, 3, 10, 100, 190, 200, 131005, 131008, 131009, 131021, 131031, 131047, 132000, 132001, 132005,
  132007, 132012, 132015, 132016, 133010,
])

/** Map a Graph API error (HTTP status + error.code) to a failure reason. Exported for tests. */
export function classifyMetaError(status: number, code: unknown): OtpSendFailure {
  const n = typeof code === 'number' ? code : Number(code)
  if (NOT_ON_WHATSAPP.has(n)) return 'not_on_whatsapp'
  if (RATE_LIMIT_CODES.has(n) || status === 429) return 'rate_limited'
  if (MISCONFIG_CODES.has(n) || status === 401 || status === 403) return 'misconfigured'
  return 'rejected'
}

/** "…3456": enough to correlate a log line with a complaint, nothing more. */
function lastFour(e164: string): string {
  return `…${e164.replace(/\D/g, '').slice(-4)}`
}

export class WhatsAppCloudSender implements OtpSender {
  readonly name = 'whatsapp'
  readonly provider = 'meta-whatsapp'

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly env: Env = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = SEND_TIMEOUT_MS
  ) {}

  async send(to: string, code: string, locale: OtpLocale): Promise<void> {
    const { accessToken, phoneNumberId, templateName, apiVersion } = this.config
    const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`
    const body = buildWhatsAppTemplatePayload(
      to,
      code,
      templateLanguage(locale, this.env),
      templateName,
      this.config.hasButton !== false
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      const timedOut = controller.signal.aborted || (err as Error)?.name === 'AbortError'
      const reason: OtpSendFailure = timedOut ? 'timeout' : 'network'
      console.error('[otp] WhatsApp send failed', { provider: this.provider, to: lastFour(to), reason })
      throw new OtpSendError(`whatsapp_${reason}`, undefined, reason)
    } finally {
      clearTimeout(timer)
    }

    const data = (await res.json().catch(() => null)) as any
    if (!res.ok) {
      // Only Meta's error code/subcode/trace id are logged: never the token,
      // never the code, never more than the last four digits of the number.
      const error = data?.error ?? null
      const reason = classifyMetaError(res.status, error?.code)
      console.error('[otp] WhatsApp send failed', {
        provider: this.provider,
        status: res.status,
        to: lastFour(to),
        reason,
        errorCode: error?.code ?? null,
        errorSubcode: error?.error_subcode ?? null,
        fbtraceId: error?.fbtrace_id ?? null,
      })
      throw new OtpSendError(`whatsapp_${reason}`, error ? { code: error.code, subcode: error.error_subcode } : null, reason)
    }

    // warn, not info: next.config's removeConsole strips everything but
    // error/warn from the build, and this line is the delivery audit trail.
    console.warn('[otp] WhatsApp code sent', {
      provider: this.provider,
      to: lastFour(to),
      messageId: data?.messages?.[0]?.id ?? null,
    })
  }
}

/**
 * Local development and tests. The last code per number is kept in memory so
 * a test (or a curious developer) can read it back; it is also logged.
 */
export class DevLogSender implements OtpSender {
  readonly name = 'dev-log'
  static readonly sent = new Map<string, { code: string; locale: OtpLocale; at: number }>()

  constructor(env: Env = process.env) {
    if (env.NODE_ENV === 'production') {
      throw new Error('DevLogSender must never run in production')
    }
  }

  async send(to: string, code: string, locale: OtpLocale): Promise<void> {
    DevLogSender.sent.set(to, { code, locale, at: Date.now() })
    if (process.env.NODE_ENV !== 'test') {
      console.info(`[otp:dev] code for ${to} (${locale}): ${code}`)
    }
  }

  static lastCode(to: string): string | null {
    return DevLogSender.sent.get(to)?.code ?? null
  }
}

/**
 * Future SMS fallback. Deliberately unwired: no provider, never selected, and
 * calling it throws. Exists so the selection logic and the docs have a named
 * slot to fill without touching the service. (The owner has ruled out Twilio.)
 */
export class SmsSender implements OtpSender {
  readonly name = 'sms'
  async send(): Promise<void> {
    throw new OtpSendError('sms_not_configured')
  }
}

/**
 * Which sender to use.
 *   - Production: Meta WhatsApp Cloud API when WHATSAPP_ACCESS_TOKEN and
 *     WHATSAPP_PHONE_NUMBER_ID are set, otherwise none (status answers 404,
 *     start answers 503, and nothing is sent or charged). There is no Twilio
 *     fallback by design.
 *   - Elsewhere: DevLogSender, unless OTP_SENDER=whatsapp asks for the real
 *     thing (e.g. testing against Meta's free test number).
 */
export function selectOtpSender(env: Env = process.env): OtpSender | null {
  const wa = whatsAppConfigFromEnv(env)
  if (env.NODE_ENV === 'production') {
    return wa ? new WhatsAppCloudSender(wa, env) : null
  }
  if (env.OTP_SENDER === 'whatsapp') {
    return wa ? new WhatsAppCloudSender(wa, env) : null
  }
  return new DevLogSender(env)
}
