/**
 * Delivery of one-time codes.
 *
 *   OtpSender            the one interface the service talks to
 *   WhatsAppCloudSender  Meta WhatsApp Cloud API, AUTHENTICATION template with
 *                        a copy-code button (production)
 *   DevLogSender         logs the code and keeps it in memory (local + tests);
 *                        refuses to exist in a production build
 *   SmsSender            placeholder for a future SMS fallback; no provider is
 *                        wired, so it is never selected
 *
 * Template language: WhatsApp has no Haitian Creole template language, so `ht`
 * is sent as French unless WHATSAPP_TEMPLATE_LANG_HT names a language the
 * template was approved in. See docs/WHATSAPP_PHONE_AUTH_SETUP.md.
 */

import { maskPhone } from './phone'

export type OtpLocale = 'en' | 'fr' | 'ht'

export interface OtpSender {
  readonly name: string
  send(to: string, code: string, locale: OtpLocale): Promise<void>
}

export class OtpSendError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message)
    this.name = 'OtpSendError'
  }
}

export function normalizeLocale(raw: unknown): OtpLocale {
  const v = typeof raw === 'string' ? raw.toLowerCase().slice(0, 2) : ''
  return v === 'fr' || v === 'ht' ? v : 'en'
}

type Env = Record<string, string | undefined>

export const DEFAULT_TEMPLATE_NAME = 'tikem_login_code'
export const DEFAULT_GRAPH_VERSION = 'v25.0'

/** Template language code for a locale. Exported for tests and the setup doc. */
export function templateLanguage(locale: OtpLocale, env: Env = process.env): string {
  if (locale === 'fr') return env.WHATSAPP_TEMPLATE_LANG_FR || 'fr'
  if (locale === 'ht') return env.WHATSAPP_TEMPLATE_LANG_HT || env.WHATSAPP_TEMPLATE_LANG_FR || 'fr'
  return env.WHATSAPP_TEMPLATE_LANG_EN || 'en'
}

export interface WhatsAppConfig {
  accessToken: string
  phoneNumberId: string
  templateName: string
  apiVersion: string
}

export function whatsAppConfigFromEnv(env: Env = process.env): WhatsAppConfig | null {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  if (!accessToken || !phoneNumberId) return null
  const v = (env.WHATSAPP_API_VERSION || DEFAULT_GRAPH_VERSION).trim()
  return {
    accessToken,
    phoneNumberId,
    templateName: (env.WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME).trim(),
    apiVersion: v.startsWith('v') ? v : `v${v}`,
  }
}

/**
 * The Graph API body for an authentication template with a copy-code button.
 * The code goes in twice: once as the body's {{1}} and once as the button's
 * parameter (that is what the copy button copies). Per Meta's docs the button
 * component is `sub_type: "url"`, index 0, even for copy-code buttons.
 */
export function buildWhatsAppTemplatePayload(
  to: string,
  code: string,
  language: string,
  templateName: string
) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    },
  }
}

export class WhatsAppCloudSender implements OtpSender {
  readonly name = 'whatsapp'

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly env: Env = process.env,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(to: string, code: string, locale: OtpLocale): Promise<void> {
    const { accessToken, phoneNumberId, templateName, apiVersion } = this.config
    const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`
    const body = buildWhatsAppTemplatePayload(to, code, templateLanguage(locale, this.env), templateName)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
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
      throw new OtpSendError('whatsapp_network', err)
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      // Meta's error object (code, error_subcode, fbtrace_id) is safe to log;
      // it never echoes the code back. The number is masked.
      const detail = await res.json().catch(() => null)
      console.error('[otp] WhatsApp send failed', {
        status: res.status,
        to: maskPhone(to),
        error: (detail as any)?.error ?? null,
      })
      throw new OtpSendError('whatsapp_rejected', detail)
    }
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
 * slot to fill (Twilio Verify or similar) without touching the service.
 */
export class SmsSender implements OtpSender {
  readonly name = 'sms'
  async send(): Promise<void> {
    throw new OtpSendError('sms_not_configured')
  }
}

/**
 * Which sender to use.
 *   - Production: WhatsApp when configured, otherwise none (the route answers
 *     503 and nothing is sent or charged).
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
