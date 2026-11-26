/**
 * Server-side lookup in the website's `common` dictionaries for a language
 * that is NOT the visitor's (a push to someone else, in THEIR language).
 * Pure: no cookies, no i18next instance. `{{name}}` placeholders are filled
 * from `vars`. Falls back to English, then to the key itself.
 */
import commonEn from '@/public/locales/en/common.json'
import commonFr from '@/public/locales/fr/common.json'
import commonHt from '@/public/locales/ht/common.json'
import { normalizeLang, type EmailLang } from '@/lib/email-kit/i18n'

const DICTS: Record<EmailLang, any> = { en: commonEn, fr: commonFr, ht: commonHt }

function lookup(dict: any, path: string): string | undefined {
  let node = dict
  for (const part of path.split('.')) {
    node = node?.[part]
    if (node === undefined) return undefined
  }
  return typeof node === 'string' ? node : undefined
}

export type CommonT = (key: string, vars?: Record<string, string | number>) => string

export function commonT(lang: unknown): CommonT {
  const l = normalizeLang(lang) || 'en'
  return (key, vars) => {
    const raw = lookup(DICTS[l], key) ?? lookup(DICTS.en, key) ?? key
    return vars ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : raw
  }
}
